export type GraphicsQuality = "low" | "medium" | "high";

export interface GameSettings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  graphics: GraphicsQuality;
  screenShake: boolean;
  reducedMotion: boolean;
  controlHints: boolean;
  haptics: boolean;
  cameraSensitivity: number;
  playerName: string;
  playerColor: string;
}

export interface PlayerRecords {
  bestSoloScore: number;
  bestMultiplayerScore: number;
  tutorialComplete: boolean;
}

export const DEFAULT_SETTINGS: Readonly<GameSettings> = Object.freeze({
  masterVolume: 0.8,
  musicVolume: 0.45,
  sfxVolume: 0.8,
  graphics: "medium",
  screenShake: true,
  reducedMotion: false,
  controlHints: true,
  haptics: true,
  cameraSensitivity: 1,
  playerName: "Neon Runner",
  playerColor: "#00e5ff",
});

export const DEFAULT_RECORDS: Readonly<PlayerRecords> = Object.freeze({
  bestSoloScore: 0,
  bestMultiplayerScore: 0,
  tutorialComplete: false,
});

export const STORAGE_KEYS = Object.freeze({
  settings: "neon-grapple-rush.settings.v1",
  records: "neon-grapple-rush.records.v1",
  reconnectToken: "neon-grapple-rush.reconnect-token.v1",
});

const SAFE_NAMES = [
  "Neon Runner",
  "Pulse Rider",
  "Skyline Fox",
  "Nova Dash",
  "Circuit Ace",
] as const;

/**
 * localStorage wrapper that permanently falls back to memory if storage is
 * unavailable, blocked, full, or throws in privacy mode.
 */
export class SafeStorage {
  private readonly memory = new Map<string, string>();
  private available: boolean | undefined;

  public isAvailable(): boolean {
    if (this.available !== undefined) return this.available;
    try {
      const testKey = "__neon_storage_test__";
      window.localStorage.setItem(testKey, testKey);
      window.localStorage.removeItem(testKey);
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  public getString(key: string): string | null {
    if (this.isAvailable()) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        this.available = false;
      }
    }
    return this.memory.get(key) ?? null;
  }

  public setString(key: string, value: string): boolean {
    this.memory.set(key, value);
    if (!this.isAvailable()) return false;
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      this.available = false;
      return false;
    }
  }

  public remove(key: string): void {
    this.memory.delete(key);
    if (!this.isAvailable()) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      this.available = false;
    }
  }

  public getJSON<T>(key: string, fallback: T): T {
    const value = this.getString(key);
    if (value === null) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  public setJSON(key: string, value: unknown): boolean {
    try {
      return this.setString(key, JSON.stringify(value));
    } catch {
      return false;
    }
  }
}

export const storage = new SafeStorage();

export function sanitizePlayerName(rawName: unknown): string {
  if (typeof rawName !== "string") return SAFE_NAMES[Math.floor(Math.random() * SAFE_NAMES.length)]!;
  const cleaned = rawName
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);
  return cleaned || SAFE_NAMES[Math.floor(Math.random() * SAFE_NAMES.length)]!;
}

export function sanitizePlayerColor(rawColor: unknown): string {
  if (typeof rawColor !== "string" || !/^#[0-9a-f]{6}$/i.test(rawColor)) {
    return DEFAULT_SETTINGS.playerColor;
  }
  return rawColor.toLowerCase();
}

function finiteUnit(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

export function loadSettings(): GameSettings {
  const candidate = storage.getJSON<Partial<GameSettings>>(STORAGE_KEYS.settings, {});
  const graphics: GraphicsQuality =
    candidate.graphics === "low" || candidate.graphics === "medium" || candidate.graphics === "high"
      ? candidate.graphics
      : DEFAULT_SETTINGS.graphics;
  const sensitivity =
    typeof candidate.cameraSensitivity === "number" && Number.isFinite(candidate.cameraSensitivity)
      ? Math.min(2, Math.max(0.5, candidate.cameraSensitivity))
      : DEFAULT_SETTINGS.cameraSensitivity;

  return {
    masterVolume: finiteUnit(candidate.masterVolume, DEFAULT_SETTINGS.masterVolume),
    musicVolume: finiteUnit(candidate.musicVolume, DEFAULT_SETTINGS.musicVolume),
    sfxVolume: finiteUnit(candidate.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
    graphics,
    screenShake:
      typeof candidate.screenShake === "boolean" ? candidate.screenShake : DEFAULT_SETTINGS.screenShake,
    reducedMotion:
      typeof candidate.reducedMotion === "boolean"
        ? candidate.reducedMotion
        : window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    controlHints:
      typeof candidate.controlHints === "boolean" ? candidate.controlHints : DEFAULT_SETTINGS.controlHints,
    haptics: typeof candidate.haptics === "boolean" ? candidate.haptics : DEFAULT_SETTINGS.haptics,
    cameraSensitivity: sensitivity,
    playerName: sanitizePlayerName(candidate.playerName),
    playerColor: sanitizePlayerColor(candidate.playerColor),
  };
}

export function saveSettings(settings: GameSettings): boolean {
  return storage.setJSON(STORAGE_KEYS.settings, {
    ...settings,
    playerName: sanitizePlayerName(settings.playerName),
    playerColor: sanitizePlayerColor(settings.playerColor),
  });
}

export function loadRecords(): PlayerRecords {
  const candidate = storage.getJSON<Partial<PlayerRecords>>(STORAGE_KEYS.records, {});
  return {
    bestSoloScore:
      typeof candidate.bestSoloScore === "number" && Number.isFinite(candidate.bestSoloScore)
        ? Math.max(0, Math.round(candidate.bestSoloScore))
        : 0,
    bestMultiplayerScore:
      typeof candidate.bestMultiplayerScore === "number" && Number.isFinite(candidate.bestMultiplayerScore)
        ? Math.max(0, Math.round(candidate.bestMultiplayerScore))
        : 0,
    tutorialComplete: candidate.tutorialComplete === true,
  };
}

export function saveRecords(records: PlayerRecords): boolean {
  return storage.setJSON(STORAGE_KEYS.records, records);
}

export function updateBestScore(mode: "solo" | "multiplayer", score: number): PlayerRecords {
  const records = loadRecords();
  const safeScore = Math.max(0, Math.round(score));
  if (mode === "solo") records.bestSoloScore = Math.max(records.bestSoloScore, safeScore);
  else records.bestMultiplayerScore = Math.max(records.bestMultiplayerScore, safeScore);
  saveRecords(records);
  return records;
}

export function setTutorialComplete(complete = true): PlayerRecords {
  const records = loadRecords();
  records.tutorialComplete = complete;
  saveRecords(records);
  return records;
}
