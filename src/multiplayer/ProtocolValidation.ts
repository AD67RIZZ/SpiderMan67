import {
  MAX_MESSAGE_BYTES,
  MAX_PLAYERS,
  POWER_UP_DURATION_MS,
  PROTOCOL_VERSION,
  ROOM_CODE_PATTERN,
  type CourseDescriptor,
  type PlayerMotionState,
  type PlayerSnapshot,
  type PowerUpKind,
  type RaceResult,
  type RoomView,
  type ServerMessage,
  type Vec3,
} from "../shared/protocol";

const ROOM_PHASES = new Set(["lobby", "countdown", "racing", "finishing", "results"]);
const MOTION_ACTIONS = new Set([
  "run",
  "jump",
  "grapple",
  "dash",
  "wall_run",
  "fall",
  "respawn",
  "finished",
]);
const ERROR_CODES = new Set([
  "bad_request",
  "invalid_message",
  "message_too_large",
  "rate_limited",
  "unsupported_protocol",
  "join_required",
  "already_joined",
  "invalid_reservation",
  "invalid_reconnect_token",
  "duplicate_connection",
  "invalid_name",
  "invalid_color",
  "invalid_room_code",
  "room_not_found",
  "room_full",
  "match_started",
  "not_host",
  "wrong_phase",
  "not_enough_players",
  "stale_sequence",
  "implausible_state",
  "invalid_checkpoint",
  "duplicate_event",
  "invalid_power_up",
  "power_up_claimed",
  "internal_error",
]);
const POWER_UP_KINDS = new Set(["overdrive", "shield", "magnet"]);
const POWER_UP_STATES = new Set(["active", "expired", "consumed"]);
const OBJECT_ID_PATTERN = /^[A-Za-z0-9:_-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeSequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isString(value: unknown, maximumLength = 256): value is string {
  return typeof value === "string" && value.length <= maximumLength;
}

function isVec3(value: unknown): value is Vec3 {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.z) &&
    Math.abs(value.x) < 100_000 &&
    Math.abs(value.y) < 100_000 &&
    Math.abs(value.z) < 100_000
  );
}

function isMotion(value: unknown): value is PlayerMotionState {
  return (
    isRecord(value) &&
    isVec3(value.position) &&
    isVec3(value.velocity) &&
    isFiniteNumber(value.yaw) &&
    isFiniteNumber(value.distance) &&
    typeof value.grounded === "boolean" &&
    typeof value.action === "string" &&
    MOTION_ACTIONS.has(value.action)
  );
}

function isCourse(value: unknown): value is CourseDescriptor {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.seed) &&
    Array.isArray(value.chunkIds) &&
    value.chunkIds.length <= 256 &&
    value.chunkIds.every((id) => isString(id, 64)) &&
    Array.isArray(value.checkpointDistances) &&
    value.checkpointDistances.length <= 64 &&
    value.checkpointDistances.every(isFiniteNumber) &&
    isFiniteNumber(value.totalDistance) &&
    isFiniteNumber(value.hazardEpoch)
  );
}

function isRoom(value: unknown): value is RoomView {
  if (
    !isRecord(value) ||
    !isString(value.code, 8) ||
    !ROOM_CODE_PATTERN.test(value.code) ||
    typeof value.private !== "boolean" ||
    typeof value.phase !== "string" ||
    !ROOM_PHASES.has(value.phase) ||
    !Number.isInteger(value.minPlayers) ||
    !Number.isInteger(value.maxPlayers) ||
    !Array.isArray(value.players) ||
    value.players.length > MAX_PLAYERS ||
    !(value.countdownEndsAt === null || isFiniteNumber(value.countdownEndsAt)) ||
    !(value.matchEndsAt === null || isFiniteNumber(value.matchEndsAt))
  ) {
    return false;
  }
  return value.players.every(
    (player) =>
      isRecord(player) &&
      isString(player.id, 64) &&
      isString(player.name, 20) &&
      isString(player.color, 16) &&
      typeof player.ready === "boolean" &&
      typeof player.host === "boolean" &&
      typeof player.connected === "boolean" &&
      (player.pingMs === null || isFiniteNumber(player.pingMs)),
  );
}

function isScore(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return [
    "distance",
    "checkpoints",
    "shards",
    "drones",
    "style",
    "placement",
    "crashPenalty",
    "total",
  ].every((key) => isFiniteNumber(value[key]));
}

function isSnapshot(value: unknown): value is PlayerSnapshot {
  return (
    isRecord(value) &&
    isString(value.id, 64) &&
    isString(value.name, 20) &&
    isString(value.color, 16) &&
    typeof value.connected === "boolean" &&
    isMotion(value.motion) &&
    Number.isInteger(value.checkpointIndex) &&
    Number.isInteger(value.placement) &&
    isFiniteNumber(value.score) &&
    isFiniteNumber(value.combo) &&
    typeof value.finished === "boolean" &&
    (value.finishTimeMs === null || isFiniteNumber(value.finishTimeMs)) &&
    (value.respawningUntil === null || isFiniteNumber(value.respawningUntil)) &&
    (value.protectedUntil === null || isFiniteNumber(value.protectedUntil)) &&
    (value.pingMs === null || isFiniteNumber(value.pingMs))
  );
}

function isRaceResult(value: unknown): value is RaceResult {
  return (
    isRecord(value) &&
    isString(value.playerId, 64) &&
    isString(value.name, 20) &&
    isString(value.color, 16) &&
    Number.isInteger(value.placement) &&
    typeof value.finished === "boolean" &&
    (value.finishTimeMs === null || isFiniteNumber(value.finishTimeMs)) &&
    isFiniteNumber(value.distance) &&
    Number.isInteger(value.checkpointIndex) &&
    isFiniteNumber(value.maximumCombo) &&
    Number.isInteger(value.shardsCollected) &&
    Number.isInteger(value.dronesDestroyed) &&
    Number.isInteger(value.crashes) &&
    (value.pingQuality === "great" ||
      value.pingQuality === "good" ||
      value.pingQuality === "fair" ||
      value.pingQuality === "poor" ||
      value.pingQuality === "unknown") &&
    isScore(value.score)
  );
}

/** Parse and validate an untrusted WebSocket payload into the shared union. */
export function parseServerMessage(payload: unknown): ServerMessage | null {
  let value: unknown = payload;
  if (typeof payload === "string") {
    if (new TextEncoder().encode(payload).byteLength > MAX_MESSAGE_BYTES) return null;
    try {
      value = JSON.parse(payload) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(value) || typeof value.type !== "string") return null;

  switch (value.type) {
    case "connected":
      if (
        value.protocol !== PROTOCOL_VERSION ||
        !isString(value.roomCode, 8) ||
        !ROOM_CODE_PATTERN.test(value.roomCode) ||
        !isFiniteNumber(value.serverTime)
      ) return null;
      break;
    case "welcome":
      if (
        value.protocol !== PROTOCOL_VERSION ||
        !isString(value.playerId, 64) ||
        !isString(value.reconnectToken, 128) ||
        typeof value.reconnected !== "boolean" ||
        !isFiniteNumber(value.serverTime) ||
        !isFiniteNumber(value.inputRateHz) ||
        !isFiniteNumber(value.snapshotRateHz) ||
        !isRoom(value.room) ||
        !isCourse(value.course)
      ) return null;
      break;
    case "room":
      if (!isRoom(value.room)) return null;
      break;
    case "countdown":
      if (!isFiniteNumber(value.startsAt) || !isCourse(value.course)) return null;
      break;
    case "start":
      if (!isFiniteNumber(value.startedAt) || !isFiniteNumber(value.endsAt) || !isCourse(value.course)) {
        return null;
      }
      break;
    case "snapshot":
      if (
        !isSafeSequence(value.seq) ||
        !isFiniteNumber(value.serverTime) ||
        typeof value.phase !== "string" ||
        !ROOM_PHASES.has(value.phase) ||
        !isFiniteNumber(value.timeRemainingMs) ||
        !Array.isArray(value.players) ||
        value.players.length > MAX_PLAYERS ||
        !value.players.every(isSnapshot)
      ) return null;
      break;
    case "checkpoint":
      if (
        !isString(value.playerId, 64) ||
        !Number.isInteger(value.checkpointIndex) ||
        !Number.isInteger(value.placement) ||
        !isScore(value.score)
      ) return null;
      break;
    case "respawn":
      if (
        !isString(value.playerId, 64) ||
        !(value.reason === "fall" || value.reason === "hazard" || value.reason === "stuck") ||
        !Number.isInteger(value.checkpointIndex) ||
        !isVec3(value.position) ||
        !isFiniteNumber(value.respawnAt) ||
        !isFiniteNumber(value.protectedUntil) ||
        !isFiniteNumber(value.penalty)
      ) return null;
      break;
    case "finish":
      if (
        !isString(value.playerId, 64) ||
        !Number.isInteger(value.placement) ||
        !isFiniteNumber(value.finishTimeMs) ||
        !isFiniteNumber(value.finishingEndsAt)
      ) return null;
      break;
    case "power_up_state":
      if (
        !isString(value.playerId, 64) ||
        !isString(value.objectId, 64) ||
        !OBJECT_ID_PATTERN.test(value.objectId) ||
        typeof value.kind !== "string" ||
        !POWER_UP_KINDS.has(value.kind) ||
        typeof value.state !== "string" ||
        !POWER_UP_STATES.has(value.state) ||
        !isFiniteNumber(value.startsAt) ||
        !isFiniteNumber(value.endsAt) ||
        value.endsAt < value.startsAt ||
        (value.state !== "consumed" &&
          Math.abs(
            value.endsAt -
              value.startsAt -
              POWER_UP_DURATION_MS[value.kind as PowerUpKind],
          ) > 250) ||
        !isFiniteNumber(value.serverTime)
      ) return null;
      break;
    case "results":
      if (
        !isFiniteNumber(value.endedAt) ||
        !(value.reason === "all_finished" ||
          value.reason === "finishing_window" ||
          value.reason === "timer" ||
          value.reason === "empty") ||
        !Array.isArray(value.results) ||
        value.results.length > MAX_PLAYERS ||
        !value.results.every(isRaceResult)
      ) return null;
      break;
    case "pong":
      if (
        !isString(value.nonce, 64) ||
        !isFiniteNumber(value.clientTime) ||
        !isFiniteNumber(value.serverTime)
      ) return null;
      break;
    case "error":
      if (
        typeof value.code !== "string" ||
        !ERROR_CODES.has(value.code) ||
        !isString(value.message, 512) ||
        typeof value.retryable !== "boolean"
      ) return null;
      break;
    default:
      return null;
  }
  return value as unknown as ServerMessage;
}
