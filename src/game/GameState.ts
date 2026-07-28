export type GameMode = "solo" | "tutorial" | "multiplayer";

export type GameScreen =
  | "loading"
  | "menu"
  | "multiplayer"
  | "private-room"
  | "lobby"
  | "race"
  | "paused"
  | "results"
  | "settings"
  | "how-to"
  | "connection-lost"
  | "error";

export interface RaceSummary {
  placement: number;
  score: number;
  finishTimeMs: number;
  distance: number;
  maxCombo: number;
  shards: number;
  drones: number;
  crashes: number;
  ping: number;
  rank: string;
}

export interface RuntimeRaceState {
  mode: GameMode;
  seed: number;
  startedAt: number;
  elapsedMs: number;
  remainingMs: number;
  paused: boolean;
  finished: boolean;
  placement: number;
  checkpoint: number;
}

export const createRaceState = (
  mode: GameMode,
  seed = Math.floor(Math.random() * 0x7fffffff),
): RuntimeRaceState => ({
  mode,
  seed,
  startedAt: performance.now(),
  elapsedMs: 0,
  remainingMs: mode === "tutorial" ? 10 * 60_000 : 6 * 60_000,
  paused: false,
  finished: false,
  placement: 1,
  checkpoint: 0,
});

export const rankForScore = (score: number): string => {
  if (score >= 45_000) return "Neon Legend";
  if (score >= 30_000) return "Grapple Master";
  if (score >= 18_000) return "Skyline Ace";
  if (score >= 8_000) return "Runner";
  return "Rookie";
};
