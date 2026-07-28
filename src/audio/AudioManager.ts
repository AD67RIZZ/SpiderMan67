import { loadSettings, type GameSettings } from "../utils/Storage";
import { SynthSounds, type AmbienceHandle, type SoundCue } from "./SynthSounds";

export type AudioStatus = "locked" | "ready" | "suspended" | "unavailable" | "closed";

export interface AudioManagerOptions {
  onStatusChange?: (status: AudioStatus) => void;
  settings?: GameSettings;
}

/**
 * Lazy Web Audio coordinator. No AudioContext is created until unlock() runs
 * from a user gesture, and every browser/audio failure degrades to silence.
 */
export class AudioManager {
  private context?: AudioContext;
  private masterGain?: GainNode;
  private musicGain?: GainNode;
  private sfxGain?: GainNode;
  private sounds?: SynthSounds;
  private ambience?: AmbienceHandle;
  private settings: GameSettings;
  private statusValue: AudioStatus = "locked";
  private wantsAmbience = false;
  private gestureTarget?: Document | HTMLElement;
  private disposed = false;

  public constructor(private readonly options: AudioManagerOptions = {}) {
    this.settings = { ...(options.settings ?? loadSettings()) };
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    navigator.mediaDevices?.addEventListener?.("devicechange", this.onDeviceChange);
  }

  public get status(): AudioStatus {
    return this.statusValue;
  }

  public get available(): boolean {
    return this.statusValue === "ready" || this.statusValue === "suspended";
  }

  public attachGestureUnlock(target: Document | HTMLElement = document): () => void {
    this.detachGestureUnlock();
    this.gestureTarget = target;
    target.addEventListener("pointerdown", this.onFirstGesture, { capture: true, once: true });
    target.addEventListener("keydown", this.onFirstGesture, { capture: true, once: true });
    return () => this.detachGestureUnlock();
  }

  public async unlock(): Promise<boolean> {
    if (this.disposed || this.statusValue === "unavailable" || this.statusValue === "closed") return false;
    try {
      if (!this.context) this.createGraph();
      if (!this.context) return false;
      if (this.context.state === "suspended") await this.context.resume();
      if (this.context.state !== "running") {
        this.setStatus("suspended");
        return false;
      }
      this.setStatus("ready");
      this.applyVolumes();
      if (this.wantsAmbience && !this.ambience) this.startAmbienceNow();
      return true;
    } catch {
      this.setStatus("unavailable");
      return false;
    }
  }

  public play(cue: SoundCue, intensity = 1): boolean {
    if (this.disposed) return false;
    if (!this.context) {
      // Creating here is safe only if play() was called from an input handler;
      // blocked contexts simply stay silent until attachGestureUnlock fires.
      try {
        this.createGraph();
      } catch {
        this.setStatus("unavailable");
        return false;
      }
    }
    const context = this.context;
    const sounds = this.sounds;
    if (!sounds || !context || context.state === "closed") return false;
    if (context.state === "suspended") void this.unlock();
    sounds.play(cue, intensity);
    return context.state === "running";
  }

  public startAmbience(): void {
    this.wantsAmbience = true;
    if (this.statusValue === "ready" && !this.ambience) this.startAmbienceNow();
  }

  public stopAmbience(): void {
    this.wantsAmbience = false;
    this.ambience?.stop();
    this.ambience = undefined;
  }

  public updateSettings(settings: GameSettings): void {
    this.settings = { ...settings };
    this.applyVolumes();
  }

  public setVolumes(master: number, music: number, sfx: number): void {
    this.settings.masterVolume = clampVolume(master);
    this.settings.musicVolume = clampVolume(music);
    this.settings.sfxVolume = clampVolume(sfx);
    this.applyVolumes();
  }

  public async suspend(): Promise<void> {
    if (!this.context || this.context.state !== "running") return;
    try {
      await this.context.suspend();
      this.setStatus("suspended");
    } catch {
      // Some browsers reject suspension during page transitions.
    }
  }

  public async resume(): Promise<boolean> {
    return this.unlock();
  }

  private createGraph(): void {
    if (this.context || this.disposed) return;
    const AudioContextClass =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      this.setStatus("unavailable");
      return;
    }
    const context = new AudioContextClass({ latencyHint: "interactive" });
    const master = context.createGain();
    const music = context.createGain();
    const sfx = context.createGain();
    music.connect(master);
    sfx.connect(master);
    master.connect(context.destination);
    this.context = context;
    this.masterGain = master;
    this.musicGain = music;
    this.sfxGain = sfx;
    this.sounds = new SynthSounds(context, sfx);
    this.applyVolumes();
    this.setStatus(context.state === "running" ? "ready" : "locked");
  }

  private startAmbienceNow(): void {
    if (!this.context || !this.musicGain || this.ambience || this.context.state !== "running") return;
    try {
      const synth = new SynthSounds(this.context, this.musicGain);
      this.ambience = synth.startAmbience();
    } catch {
      // Atmosphere is optional.
    }
  }

  private applyVolumes(): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.masterGain?.gain.setTargetAtTime(clampVolume(this.settings.masterVolume), now, 0.025);
    this.musicGain?.gain.setTargetAtTime(clampVolume(this.settings.musicVolume), now, 0.04);
    this.sfxGain?.gain.setTargetAtTime(clampVolume(this.settings.sfxVolume), now, 0.02);
  }

  private setStatus(status: AudioStatus): void {
    if (this.statusValue === status) return;
    this.statusValue = status;
    this.options.onStatusChange?.(status);
  }

  private readonly onFirstGesture = (): void => {
    this.detachGestureUnlock();
    void this.unlock();
  };

  private detachGestureUnlock(): void {
    if (!this.gestureTarget) return;
    this.gestureTarget.removeEventListener("pointerdown", this.onFirstGesture, { capture: true });
    this.gestureTarget.removeEventListener("keydown", this.onFirstGesture, { capture: true });
    this.gestureTarget = undefined;
  }

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      void this.suspend();
    } else if (this.context && this.statusValue !== "unavailable") {
      void this.resume();
    }
  };

  private readonly onDeviceChange = (): void => {
    if (this.context?.state === "suspended" && !document.hidden) void this.resume();
  };

  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.detachGestureUnlock();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    navigator.mediaDevices?.removeEventListener?.("devicechange", this.onDeviceChange);
    this.stopAmbience();
    if (this.context && this.context.state !== "closed") {
      try {
        await this.context.close();
      } catch {
        // Closing audio is best-effort during page teardown.
      }
    }
    this.context = undefined;
    this.sounds = undefined;
    this.setStatus("closed");
  }

  public destroy(): void {
    void this.dispose();
  }
}

function clampVolume(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
