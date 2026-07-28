/**
 * Serializable messages shared by the browser client and Cloudflare Worker.
 *
 * Keep this module dependency-free: it is compiled by both the Vite and Worker
 * TypeScript projects.
 */

export const PROTOCOL_VERSION = 1 as const;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const INPUT_RATE_HZ = 20;
export const SNAPSHOT_RATE_HZ = 15;
export const MATCH_DURATION_MS = 6 * 60 * 1_000;
export const FINISHING_WINDOW_MS = 30_000;
export const RECONNECT_GRACE_MS = 30_000;
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{5,6}$/;
export const MAX_PLAYER_NAME_LENGTH = 20;
export const MAX_MESSAGE_BYTES = 8_192;

export const SAFE_PLAYER_NAMES = [
  "Neon Runner",
  "Pulse Rider",
  "Skyline Fox",
  "Nova Dash",
  "Circuit Ace",
] as const;

export const PLAYER_COLORS = [
  "#00e5ff",
  "#ff3df2",
  "#7cff6b",
  "#ffd447",
  "#8c7bff",
  "#ff7043",
  "#35f2b1",
  "#f06292",
] as const;

export type PlayerColor = (typeof PLAYER_COLORS)[number];
export type PowerUpKind = "overdrive" | "shield" | "magnet";

export const POWER_UP_DURATION_MS: Readonly<Record<PowerUpKind, number>> = {
  overdrive: 8_000,
  shield: 18_000,
  magnet: 10_000,
};

const POWER_UP_KINDS = ["overdrive", "shield", "magnet"] as const;

/**
 * Stable power-up selection shared by authored course generation and the
 * Worker. Returning null means the object ID is not a power-up spawn.
 */
export function deterministicPowerUpKind(
  seed: number,
  objectId: string,
): PowerUpKind | null {
  const match = /^power-(\d{1,3})$/.exec(objectId);
  if (!match?.[1]) return null;
  const chunkIndex = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 255) {
    return null;
  }
  let hash = (seed >>> 0) ^ Math.imul(chunkIndex + 1, 0x9e3779b1);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return POWER_UP_KINDS[hash % POWER_UP_KINDS.length] ?? null;
}

export type RoomPhase =
  | "lobby"
  | "countdown"
  | "racing"
  | "finishing"
  | "results";

export type GameplayEventKind =
  | "shard"
  | "drone"
  | "near_miss"
  | "clean_release"
  | "high_speed"
  | "combo_chain"
  | "risky_route";

export type RespawnReason = "fall" | "hazard" | "stuck";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlayerControls {
  steer: number;
  jump: boolean;
  grapple: boolean;
  dash: boolean;
}

export interface PlayerMotionState {
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  distance: number;
  grounded: boolean;
  action:
    | "run"
    | "jump"
    | "grapple"
    | "dash"
    | "wall_run"
    | "fall"
    | "respawn"
    | "finished";
}

export interface CourseDescriptor {
  seed: number;
  chunkIds: string[];
  checkpointDistances: number[];
  totalDistance: number;
  hazardEpoch: number;
}

export interface ScoreBreakdown {
  distance: number;
  checkpoints: number;
  shards: number;
  drones: number;
  style: number;
  placement: number;
  crashPenalty: number;
  total: number;
}

export interface PlayerLobbyView {
  id: string;
  name: string;
  color: PlayerColor;
  ready: boolean;
  host: boolean;
  connected: boolean;
  pingMs: number | null;
}

export interface RoomView {
  code: string;
  private: boolean;
  phase: RoomPhase;
  minPlayers: number;
  maxPlayers: number;
  players: PlayerLobbyView[];
  countdownEndsAt: number | null;
  matchEndsAt: number | null;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  color: PlayerColor;
  connected: boolean;
  motion: PlayerMotionState;
  /** Exact 0-based CheckpointSpec index; checkpoint 0 is the starting gate. */
  checkpointIndex: number;
  placement: number;
  score: number;
  combo: number;
  finished: boolean;
  finishTimeMs: number | null;
  respawningUntil: number | null;
  protectedUntil: number | null;
  pingMs: number | null;
}

export interface RaceResult {
  playerId: string;
  name: string;
  color: PlayerColor;
  placement: number;
  finished: boolean;
  finishTimeMs: number | null;
  distance: number;
  /** Exact 0-based CheckpointSpec index; checkpoint 0 is the starting gate. */
  checkpointIndex: number;
  maximumCombo: number;
  shardsCollected: number;
  dronesDestroyed: number;
  crashes: number;
  pingQuality: "great" | "good" | "fair" | "poor" | "unknown";
  score: ScoreBreakdown;
}

export type ServerErrorCode =
  | "bad_request"
  | "invalid_message"
  | "message_too_large"
  | "rate_limited"
  | "unsupported_protocol"
  | "join_required"
  | "already_joined"
  | "invalid_reservation"
  | "invalid_reconnect_token"
  | "duplicate_connection"
  | "invalid_name"
  | "invalid_color"
  | "invalid_room_code"
  | "room_not_found"
  | "room_full"
  | "match_started"
  | "not_host"
  | "wrong_phase"
  | "not_enough_players"
  | "stale_sequence"
  | "implausible_state"
  | "invalid_checkpoint"
  | "duplicate_event"
  | "invalid_power_up"
  | "power_up_claimed"
  | "internal_error";

export interface JoinMessage {
  type: "join";
  protocol: typeof PROTOCOL_VERSION;
  name: string;
  color: string;
  reservationToken?: string;
  reconnectToken?: string;
}

export interface ReadyMessage {
  type: "ready";
  ready: boolean;
}

export interface InputMessage {
  type: "input";
  seq: number;
  clientTime: number;
  controls: PlayerControls;
  motion: PlayerMotionState;
}

export interface CheckpointMessage {
  type: "checkpoint";
  seq: number;
  /** Exact 0-based CheckpointSpec index from the deterministic course. */
  checkpointIndex: number;
}

export interface GameplayEventMessage {
  type: "gameplay_event";
  seq: number;
  event: GameplayEventKind;
  objectId: string;
}

export interface RespawnMessage {
  type: "respawn";
  seq: number;
  reason: RespawnReason;
}

export interface FinishMessage {
  type: "finish";
  seq: number;
}

export interface PowerUpCollectMessage {
  type: "power_up_collect";
  seq: number;
  objectId: string;
  kind: PowerUpKind;
}

export interface PingMessage {
  type: "ping";
  nonce: string;
  clientTime: number;
  /** RTT measured from the previous pong, used only for ping display/summary. */
  rttMs?: number;
}

export interface LeaveMessage {
  type: "leave";
}

export interface PlayAgainMessage {
  type: "play_again";
}

export type ClientMessage =
  | JoinMessage
  | ReadyMessage
  | InputMessage
  | CheckpointMessage
  | GameplayEventMessage
  | RespawnMessage
  | FinishMessage
  | PowerUpCollectMessage
  | PingMessage
  | LeaveMessage
  | PlayAgainMessage;

export interface ConnectedMessage {
  type: "connected";
  protocol: typeof PROTOCOL_VERSION;
  roomCode: string;
  serverTime: number;
}

export interface WelcomeMessage {
  type: "welcome";
  protocol: typeof PROTOCOL_VERSION;
  playerId: string;
  reconnectToken: string;
  reconnected: boolean;
  serverTime: number;
  inputRateHz: number;
  snapshotRateHz: number;
  room: RoomView;
  course: CourseDescriptor;
}

export interface RoomMessage {
  type: "room";
  room: RoomView;
}

export interface CountdownMessage {
  type: "countdown";
  startsAt: number;
  course: CourseDescriptor;
}

export interface StartMessage {
  type: "start";
  startedAt: number;
  endsAt: number;
  course: CourseDescriptor;
}

export interface SnapshotMessage {
  type: "snapshot";
  seq: number;
  serverTime: number;
  phase: RoomPhase;
  timeRemainingMs: number;
  players: PlayerSnapshot[];
}

export interface CheckpointServerMessage {
  type: "checkpoint";
  playerId: string;
  checkpointIndex: number;
  placement: number;
  score: ScoreBreakdown;
}

export interface RespawnServerMessage {
  type: "respawn";
  playerId: string;
  reason: RespawnReason;
  checkpointIndex: number;
  position: Vec3;
  respawnAt: number;
  protectedUntil: number;
  penalty: number;
}

export interface FinishServerMessage {
  type: "finish";
  playerId: string;
  placement: number;
  finishTimeMs: number;
  finishingEndsAt: number;
}

export interface PowerUpStateMessage {
  type: "power_up_state";
  playerId: string;
  objectId: string;
  kind: PowerUpKind;
  state: "active" | "expired" | "consumed";
  startsAt: number;
  endsAt: number;
  serverTime: number;
}

export interface ResultsMessage {
  type: "results";
  endedAt: number;
  reason: "all_finished" | "finishing_window" | "timer" | "empty";
  results: RaceResult[];
}

export interface PongMessage {
  type: "pong";
  nonce: string;
  clientTime: number;
  serverTime: number;
}

export interface ErrorMessage {
  type: "error";
  code: ServerErrorCode;
  message: string;
  retryable: boolean;
}

export type ServerMessage =
  | ConnectedMessage
  | WelcomeMessage
  | RoomMessage
  | CountdownMessage
  | StartMessage
  | SnapshotMessage
  | CheckpointServerMessage
  | RespawnServerMessage
  | FinishServerMessage
  | PowerUpStateMessage
  | ResultsMessage
  | PongMessage
  | ErrorMessage;

export interface RoomReservationResponse {
  roomCode: string;
  reservationToken: string;
  reservationExpiresAt: number;
  websocketUrl: string;
}

export interface HealthResponse {
  ok: true;
  service: "neon-grapple-rush-multiplayer";
  protocol: typeof PROTOCOL_VERSION;
  serverTime: number;
}
