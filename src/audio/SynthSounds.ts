export type SoundCue =
  | "grapple-attach"
  | "grapple-release"
  | "jump"
  | "dash"
  | "wall-run"
  | "shard"
  | "drone-destroy"
  | "shield-break"
  | "checkpoint"
  | "countdown"
  | "match-start"
  | "button"
  | "crash"
  | "respawn"
  | "victory"
  | "game-over"
  | "hazard-warning";

interface ToneOptions {
  frequency: number;
  endFrequency?: number;
  duration: number;
  gain: number;
  type?: OscillatorType;
  delay?: number;
  attack?: number;
}

export interface AmbienceHandle {
  stop: () => void;
}

/**
 * Original, procedural arcade sounds. Every cue is built from oscillators and
 * filtered noise, so the game has no external audio-file dependency.
 */
export class SynthSounds {
  private noiseBuffer?: AudioBuffer;

  public constructor(
    private readonly context: AudioContext,
    private readonly destination: AudioNode,
  ) {}

  public play(cue: SoundCue, intensity = 1): void {
    if (this.context.state === "closed") return;
    const scale = Math.max(0, Math.min(1.4, intensity));
    try {
      switch (cue) {
        case "grapple-attach":
          this.tone({ frequency: 170, endFrequency: 760, duration: 0.16, gain: 0.17 * scale, type: "sawtooth" });
          this.tone({ frequency: 900, endFrequency: 1250, duration: 0.09, gain: 0.08 * scale, type: "sine", delay: 0.06 });
          break;
        case "grapple-release":
          this.tone({ frequency: 740, endFrequency: 280, duration: 0.18, gain: 0.11 * scale, type: "triangle" });
          break;
        case "jump":
          this.tone({ frequency: 210, endFrequency: 420, duration: 0.12, gain: 0.13 * scale, type: "square" });
          break;
        case "dash":
          this.noise(0.2, 0.2 * scale, 1500, 0.018);
          this.tone({ frequency: 120, endFrequency: 60, duration: 0.2, gain: 0.22 * scale, type: "sawtooth" });
          this.tone({ frequency: 900, endFrequency: 150, duration: 0.14, gain: 0.08 * scale, type: "sine" });
          break;
        case "wall-run":
          this.noise(0.09, 0.07 * scale, 4800, 0.005);
          this.tone({ frequency: 620, endFrequency: 940, duration: 0.07, gain: 0.04 * scale, type: "square" });
          break;
        case "shard":
          this.tone({ frequency: 880, endFrequency: 1280, duration: 0.09, gain: 0.09 * scale, type: "sine" });
          this.tone({ frequency: 1320, duration: 0.14, gain: 0.06 * scale, type: "triangle", delay: 0.04 });
          break;
        case "drone-destroy":
          this.noise(0.24, 0.2 * scale, 2100, 0.008);
          this.tone({ frequency: 240, endFrequency: 52, duration: 0.28, gain: 0.2 * scale, type: "sawtooth" });
          break;
        case "shield-break":
          this.tone({ frequency: 1100, endFrequency: 90, duration: 0.35, gain: 0.15 * scale, type: "square" });
          this.noise(0.32, 0.12 * scale, 6000, 0.004);
          break;
        case "checkpoint":
          this.chord([440, 660, 880], 0.32, 0.085 * scale, 0.055);
          break;
        case "countdown":
          this.tone({ frequency: 440, duration: 0.11, gain: 0.12 * scale, type: "square" });
          break;
        case "match-start":
          this.chord([330, 494, 740], 0.38, 0.11 * scale, 0.045);
          this.tone({ frequency: 120, endFrequency: 60, duration: 0.32, gain: 0.14 * scale, type: "sine" });
          break;
        case "button":
          this.tone({ frequency: 420, endFrequency: 620, duration: 0.055, gain: 0.055 * scale, type: "triangle" });
          break;
        case "crash":
          this.noise(0.38, 0.25 * scale, 900, 0.003);
          this.tone({ frequency: 95, endFrequency: 38, duration: 0.38, gain: 0.24 * scale, type: "square" });
          break;
        case "respawn":
          this.chord([220, 330, 550], 0.42, 0.075 * scale, 0.09);
          break;
        case "victory":
          this.sequence([523, 659, 784, 1047], 0.13, 0.09 * scale);
          this.chord([523, 659, 784], 0.8, 0.07 * scale, 0.48);
          break;
        case "game-over":
          this.sequence([330, 277, 220, 165], 0.17, 0.09 * scale);
          break;
        case "hazard-warning":
          this.tone({ frequency: 190, duration: 0.12, gain: 0.11 * scale, type: "square" });
          this.tone({ frequency: 190, duration: 0.12, gain: 0.11 * scale, type: "square", delay: 0.17 });
          break;
      }
    } catch {
      // Audio is optional: a failed oscillator must never interrupt gameplay.
    }
  }

  public startAmbience(): AmbienceHandle {
    const now = this.context.currentTime;
    const mix = this.context.createGain();
    mix.gain.setValueAtTime(0.0001, now);
    mix.gain.exponentialRampToValueAtTime(0.075, now + 2.5);

    const lowpass = this.context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 680;
    lowpass.Q.value = 1.4;
    mix.connect(lowpass).connect(this.destination);

    const voices = [
      this.ambientVoice(55, "sine", mix, 0.46),
      this.ambientVoice(82.5, "triangle", mix, 0.24),
      this.ambientVoice(110.4, "sine", mix, 0.13),
    ];

    const lfo = this.context.createOscillator();
    const lfoDepth = this.context.createGain();
    lfo.frequency.value = 0.075;
    lfoDepth.gain.value = 230;
    lfo.connect(lfoDepth).connect(lowpass.frequency);
    lfo.start();

    let stopped = false;
    return {
      stop: () => {
        if (stopped) return;
        stopped = true;
        const stopAt = this.context.currentTime + 0.6;
        try {
          mix.gain.cancelScheduledValues(this.context.currentTime);
          mix.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.15);
          for (const voice of voices) voice.stop(stopAt);
          lfo.stop(stopAt);
          window.setTimeout(() => {
            mix.disconnect();
            lowpass.disconnect();
            lfoDepth.disconnect();
          }, 700);
        } catch {
          // Context may already be closed.
        }
      },
    };
  }

  private ambientVoice(
    frequency: number,
    type: OscillatorType,
    destination: AudioNode,
    gainValue: number,
  ): OscillatorNode {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    oscillator.detune.value = (Math.random() - 0.5) * 4;
    gain.gain.value = gainValue;
    oscillator.connect(gain).connect(destination);
    oscillator.start();
    return oscillator;
  }

  private tone(options: ToneOptions): void {
    const start = this.context.currentTime + (options.delay ?? 0);
    const end = start + options.duration;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = options.type ?? "sine";
    oscillator.frequency.setValueAtTime(Math.max(1, options.frequency), start);
    if (options.endFrequency !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, options.endFrequency), end);
    }
    const attack = Math.min(options.duration * 0.35, options.attack ?? 0.008);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, options.gain), start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain).connect(this.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
    oscillator.addEventListener("ended", () => {
      oscillator.disconnect();
      gain.disconnect();
    }, { once: true });
  }

  private noise(duration: number, volume: number, cutoff: number, attack: number): void {
    const source = this.context.createBufferSource();
    source.buffer = this.getNoiseBuffer();
    const filter = this.context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = cutoff;
    filter.Q.value = 0.7;
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(this.destination);
    source.start(now);
    source.stop(now + duration + 0.02);
    source.addEventListener("ended", () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    }, { once: true });
  }

  private getNoiseBuffer(): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.max(1, Math.floor(this.context.sampleRate * 0.5));
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.72 + white * 0.28;
      channel[index] = previous;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  private chord(
    frequencies: number[],
    duration: number,
    gain: number,
    delay: number,
  ): void {
    frequencies.forEach((frequency, index) => {
      this.tone({
        frequency,
        endFrequency: frequency * 1.01,
        duration,
        gain: gain / Math.sqrt(frequencies.length),
        type: index % 2 === 0 ? "triangle" : "sine",
        delay,
        attack: 0.018,
      });
    });
  }

  private sequence(frequencies: number[], step: number, gain: number): void {
    frequencies.forEach((frequency, index) => {
      this.tone({
        frequency,
        duration: step * 1.35,
        gain,
        type: "triangle",
        delay: index * step,
      });
    });
  }
}

