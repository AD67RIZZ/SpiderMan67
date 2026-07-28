import {
  MAX_PLAYER_NAME_LENGTH,
  PLAYER_COLORS,
  PROTOCOL_VERSION,
  ROOM_CODE_PATTERN,
  type ClientMessage,
  type GameplayEventKind,
  type PlayerColor,
  type PlayerMotionState,
  type PowerUpKind,
  type RespawnReason,
} from "./protocol";

export interface ValidationSuccess<T> {
  ok: true;
  value: T;
}

export interface ValidationFailure {
  ok: false;
  reason: string;
}

export type ValidationResult<T> =
  | ValidationSuccess<T>
  | ValidationFailure;

const ACTIONS = new Set([
  "run",
  "jump",
  "grapple",
  "dash",
  "wall_run",
  "fall",
  "respawn",
  "finished",
]);

const GAMEPLAY_EVENTS = new Set<GameplayEventKind>([
  "shard",
  "drone",
  "near_miss",
  "clean_release",
  "high_speed",
  "combo_chain",
  "risky_route",
]);

const RESPAWN_REASONS = new Set<RespawnReason>([
  "fall",
  "hazard",
  "stuck",
]);

const POWER_UP_KINDS = new Set<PowerUpKind>([
  "overdrive",
  "shield",
  "magnet",
]);

const OBJECT_ID_PATTERN = /^[A-Za-z0-9:_-]{1,64}$/;
const POWER_UP_ID_PATTERN = /^power-\d{1,3}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,96}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sequence(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    typeof value === "number" &&
    value >= 0 &&
    value <= 2_147_483_647
  );
}

function boolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function optionalToken(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && TOKEN_PATTERN.test(value));
}

export function normalizeRoomCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}

export function normalizePlayerName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  const length = Array.from(normalized).length;
  if (length < 1 || length > MAX_PLAYER_NAME_LENGTH) return null;
  if (/[\u0000-\u001f\u007f<>]/u.test(normalized)) return null;
  return normalized;
}

export function isPlayerColor(value: unknown): value is PlayerColor {
  return (
    typeof value === "string" &&
    (PLAYER_COLORS as readonly string[]).includes(value.toLowerCase())
  );
}

function isMotionState(value: unknown): value is PlayerMotionState {
  if (!record(value) || !record(value.position) || !record(value.velocity)) {
    return false;
  }

  const { position, velocity } = value;
  if (
    !finite(position.x) ||
    !finite(position.y) ||
    !finite(position.z) ||
    !finite(velocity.x) ||
    !finite(velocity.y) ||
    !finite(velocity.z) ||
    !finite(value.yaw) ||
    !finite(value.distance) ||
    !boolean(value.grounded) ||
    typeof value.action !== "string" ||
    !ACTIONS.has(value.action)
  ) {
    return false;
  }

  return (
    Math.abs(position.x) <= 5_000 &&
    position.y >= -2_000 &&
    position.y <= 3_000 &&
    Math.abs(position.z) <= 12_000 &&
    Math.abs(value.yaw) <= Math.PI * 32 &&
    value.distance >= 0 &&
    value.distance <= 20_000
  );
}

export function parseClientMessage(
  value: unknown,
): ValidationResult<ClientMessage> {
  if (!record(value) || typeof value.type !== "string") {
    return { ok: false, reason: "Message must be a JSON object with a type." };
  }

  switch (value.type) {
    case "join": {
      const name = normalizePlayerName(value.name);
      if (value.protocol !== PROTOCOL_VERSION) {
        return { ok: false, reason: "Unsupported protocol version." };
      }
      if (!name) return { ok: false, reason: "Invalid player name." };
      if (!isPlayerColor(value.color)) {
        return { ok: false, reason: "Invalid player colour." };
      }
      if (
        !optionalToken(value.reservationToken) ||
        !optionalToken(value.reconnectToken)
      ) {
        return { ok: false, reason: "Invalid join token." };
      }
      return {
        ok: true,
        value: {
          type: "join",
          protocol: PROTOCOL_VERSION,
          name,
          color: value.color.toLowerCase() as PlayerColor,
          ...(value.reservationToken
            ? { reservationToken: value.reservationToken }
            : {}),
          ...(value.reconnectToken
            ? { reconnectToken: value.reconnectToken }
            : {}),
        },
      };
    }

    case "ready":
      return boolean(value.ready)
        ? { ok: true, value: { type: "ready", ready: value.ready } }
        : { ok: false, reason: "Ready must be a boolean." };

    case "input": {
      if (
        !sequence(value.seq) ||
        !finite(value.clientTime) ||
        !record(value.controls) ||
        !finite(value.controls.steer) ||
        value.controls.steer < -1 ||
        value.controls.steer > 1 ||
        !boolean(value.controls.jump) ||
        !boolean(value.controls.grapple) ||
        !boolean(value.controls.dash) ||
        !isMotionState(value.motion)
      ) {
        return { ok: false, reason: "Invalid input state." };
      }
      return {
        ok: true,
        value: {
          type: "input",
          seq: value.seq,
          clientTime: value.clientTime,
          controls: {
            steer: value.controls.steer,
            jump: value.controls.jump,
            grapple: value.controls.grapple,
            dash: value.controls.dash,
          },
          motion: value.motion,
        },
      };
    }

    case "checkpoint":
      return sequence(value.seq) &&
        Number.isInteger(value.checkpointIndex) &&
        typeof value.checkpointIndex === "number" &&
        value.checkpointIndex >= 0 &&
        value.checkpointIndex <= 64
        ? {
            ok: true,
            value: {
              type: "checkpoint",
              seq: value.seq,
              checkpointIndex: value.checkpointIndex,
            },
          }
        : { ok: false, reason: "Invalid checkpoint message." };

    case "gameplay_event":
      return sequence(value.seq) &&
        typeof value.event === "string" &&
        GAMEPLAY_EVENTS.has(value.event as GameplayEventKind) &&
        typeof value.objectId === "string" &&
        OBJECT_ID_PATTERN.test(value.objectId)
        ? {
            ok: true,
            value: {
              type: "gameplay_event",
              seq: value.seq,
              event: value.event as GameplayEventKind,
              objectId: value.objectId,
            },
          }
        : { ok: false, reason: "Invalid gameplay event." };

    case "respawn":
      return sequence(value.seq) &&
        typeof value.reason === "string" &&
        RESPAWN_REASONS.has(value.reason as RespawnReason)
        ? {
            ok: true,
            value: {
              type: "respawn",
              seq: value.seq,
              reason: value.reason as RespawnReason,
            },
          }
        : { ok: false, reason: "Invalid respawn message." };

    case "finish":
      return sequence(value.seq)
        ? { ok: true, value: { type: "finish", seq: value.seq } }
        : { ok: false, reason: "Invalid finish message." };

    case "power_up_collect":
      return sequence(value.seq) &&
        typeof value.objectId === "string" &&
        POWER_UP_ID_PATTERN.test(value.objectId) &&
        typeof value.kind === "string" &&
        POWER_UP_KINDS.has(value.kind as PowerUpKind)
        ? {
            ok: true,
            value: {
              type: "power_up_collect",
              seq: value.seq,
              objectId: value.objectId,
              kind: value.kind as PowerUpKind,
            },
          }
        : { ok: false, reason: "Invalid power-up collection message." };

    case "ping":
      return typeof value.nonce === "string" &&
        value.nonce.length >= 1 &&
        value.nonce.length <= 64 &&
        finite(value.clientTime) &&
        (value.rttMs === undefined ||
          (finite(value.rttMs) && value.rttMs >= 0 && value.rttMs <= 5_000))
        ? {
            ok: true,
            value: {
              type: "ping",
              nonce: value.nonce,
              clientTime: value.clientTime,
              ...(value.rttMs === undefined ? {} : { rttMs: value.rttMs }),
            },
          }
        : { ok: false, reason: "Invalid ping message." };

    case "leave":
      return { ok: true, value: { type: "leave" } };

    case "play_again":
      return { ok: true, value: { type: "play_again" } };

    default:
      return { ok: false, reason: "Unknown message type." };
  }
}

export function safeJsonParse(text: string): ValidationResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "Malformed JSON." };
  }
}

export function isToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}
