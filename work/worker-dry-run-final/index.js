var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/shared/protocol.ts
var PROTOCOL_VERSION = 1;
var MIN_PLAYERS = 2;
var MAX_PLAYERS = 8;
var INPUT_RATE_HZ = 20;
var SNAPSHOT_RATE_HZ = 15;
var MATCH_DURATION_MS = 6 * 60 * 1e3;
var FINISHING_WINDOW_MS = 3e4;
var RECONNECT_GRACE_MS = 3e4;
var ROOM_CODE_LENGTH = 6;
var ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{5,6}$/;
var MAX_PLAYER_NAME_LENGTH = 20;
var MAX_MESSAGE_BYTES = 8192;
var PLAYER_COLORS = [
  "#00e5ff",
  "#ff3df2",
  "#7cff6b",
  "#ffd447",
  "#8c7bff",
  "#ff7043",
  "#35f2b1",
  "#f06292"
];
var POWER_UP_DURATION_MS = {
  overdrive: 8e3,
  shield: 18e3,
  magnet: 1e4
};
var POWER_UP_KINDS = ["overdrive", "shield", "magnet"];
function deterministicPowerUpKind(seed, objectId) {
  const match = /^power-(\d{1,3})$/.exec(objectId);
  if (!match?.[1]) return null;
  const chunkIndex = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 255) {
    return null;
  }
  let hash = seed >>> 0 ^ Math.imul(chunkIndex + 1, 2654435761);
  hash = Math.imul(hash ^ hash >>> 16, 2246822507);
  hash = Math.imul(hash ^ hash >>> 13, 3266489909);
  hash = (hash ^ hash >>> 16) >>> 0;
  return POWER_UP_KINDS[hash % POWER_UP_KINDS.length] ?? null;
}
__name(deterministicPowerUpKind, "deterministicPowerUpKind");

// worker/course.ts
var STANDARD_CHUNK_KINDS = [
  "beginner",
  "grapple",
  "split",
  "curved",
  "wall-run",
  "grapple",
  "rail",
  "moving",
  "hazard",
  "grapple",
  "split",
  "curved",
  "wall-run",
  "rail",
  "moving",
  "hazard",
  "split",
  "grapple",
  "curved",
  "wall-run",
  "rail",
  "moving",
  "hazard",
  "grapple",
  "curved",
  "split",
  "wall-run",
  "moving",
  "rail",
  "hazard",
  "split",
  "grapple",
  "wall-run",
  "curved",
  "rail",
  "moving",
  "hazard",
  "grapple",
  "split",
  "curved",
  "wall-run",
  "moving",
  "rail",
  "hazard",
  "grapple",
  "split",
  "moving",
  "hazard",
  "final"
];
var STANDARD_CHUNKS = STANDARD_CHUNK_KINDS.map(
  (kind, index) => `chunk-${index}-${kind}`
);
var CHECKPOINT_DISTANCES = [
  0,
  150,
  411,
  566,
  775,
  878,
  1139,
  1346,
  1451,
  1606,
  1867,
  2022,
  2179,
  2386,
  2439,
  2540
];
var TOTAL_DISTANCE = 2542;
function randomUint32() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] ?? 1;
}
__name(randomUint32, "randomUint32");
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = state + 1831565813 >>> 0;
    let result = state;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}
__name(mulberry32, "mulberry32");
function createCourse(now = Date.now()) {
  const seed = randomUint32();
  const random = mulberry32(seed);
  return {
    seed,
    chunkIds: [...STANDARD_CHUNKS],
    checkpointDistances: [...CHECKPOINT_DISTANCES],
    totalDistance: TOTAL_DISTANCE,
    // Clients derive all periodic hazard phases from this shared epoch.
    hazardEpoch: now + 4e3 + Math.floor(random() * 2e3)
  };
}
__name(createCourse, "createCourse");
function checkpointPosition(course, checkpointIndex) {
  if (checkpointIndex < 0) return { x: 0, y: 32.25, z: 2 };
  const distance = course.checkpointDistances[checkpointIndex] ?? 0;
  return { x: 0, y: 32.2, z: distance - 2 };
}
__name(checkpointPosition, "checkpointPosition");

// worker/scoring.ts
function scoreBreakdown(player) {
  const distance = Math.max(0, Math.floor(player.motion.distance * 2));
  const checkpoints = Math.max(0, player.checkpointIndex * 1e3);
  const shards = Math.max(0, player.shardsCollected * 100);
  const drones = Math.max(0, player.dronesDestroyed * 300);
  const style = Math.max(0, Math.floor(player.stylePoints));
  const placement = Math.max(0, Math.floor(player.placementBonus));
  const crashPenalty = Math.max(0, player.crashes * 200);
  const total = Math.max(
    0,
    distance + checkpoints + shards + drones + style + placement - crashPenalty
  );
  return {
    distance,
    checkpoints,
    shards,
    drones,
    style,
    placement,
    crashPenalty,
    total
  };
}
__name(scoreBreakdown, "scoreBreakdown");

// worker/validation.ts
var ACTIONS = /* @__PURE__ */ new Set([
  "run",
  "jump",
  "grapple",
  "dash",
  "wall_run",
  "fall",
  "respawn",
  "finished"
]);
var GAMEPLAY_EVENTS = /* @__PURE__ */ new Set([
  "shard",
  "drone",
  "near_miss",
  "clean_release",
  "high_speed",
  "combo_chain",
  "risky_route"
]);
var RESPAWN_REASONS = /* @__PURE__ */ new Set([
  "fall",
  "hazard",
  "stuck"
]);
var POWER_UP_KINDS2 = /* @__PURE__ */ new Set([
  "overdrive",
  "shield",
  "magnet"
]);
var OBJECT_ID_PATTERN = /^[A-Za-z0-9:_-]{1,64}$/;
var POWER_UP_ID_PATTERN = /^power-\d{1,3}$/;
var TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,96}$/;
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
__name(record, "record");
function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}
__name(finite, "finite");
function sequence(value) {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0 && value <= 2147483647;
}
__name(sequence, "sequence");
function boolean(value) {
  return typeof value === "boolean";
}
__name(boolean, "boolean");
function optionalToken(value) {
  return value === void 0 || typeof value === "string" && TOKEN_PATTERN.test(value);
}
__name(optionalToken, "optionalToken");
function normalizeRoomCode(value) {
  const code = value.trim().toUpperCase();
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}
__name(normalizeRoomCode, "normalizeRoomCode");
function normalizePlayerName(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  const length = Array.from(normalized).length;
  if (length < 1 || length > MAX_PLAYER_NAME_LENGTH) return null;
  if (/[\u0000-\u001f\u007f<>]/u.test(normalized)) return null;
  return normalized;
}
__name(normalizePlayerName, "normalizePlayerName");
function isPlayerColor(value) {
  return typeof value === "string" && PLAYER_COLORS.includes(value.toLowerCase());
}
__name(isPlayerColor, "isPlayerColor");
function isMotionState(value) {
  if (!record(value) || !record(value.position) || !record(value.velocity)) {
    return false;
  }
  const { position, velocity } = value;
  if (!finite(position.x) || !finite(position.y) || !finite(position.z) || !finite(velocity.x) || !finite(velocity.y) || !finite(velocity.z) || !finite(value.yaw) || !finite(value.distance) || !boolean(value.grounded) || typeof value.action !== "string" || !ACTIONS.has(value.action)) {
    return false;
  }
  return Math.abs(position.x) <= 5e3 && position.y >= -2e3 && position.y <= 3e3 && Math.abs(position.z) <= 12e3 && Math.abs(value.yaw) <= Math.PI * 32 && value.distance >= 0 && value.distance <= 2e4;
}
__name(isMotionState, "isMotionState");
function parseClientMessage(value) {
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
      if (!optionalToken(value.reservationToken) || !optionalToken(value.reconnectToken)) {
        return { ok: false, reason: "Invalid join token." };
      }
      return {
        ok: true,
        value: {
          type: "join",
          protocol: PROTOCOL_VERSION,
          name,
          color: value.color.toLowerCase(),
          ...value.reservationToken ? { reservationToken: value.reservationToken } : {},
          ...value.reconnectToken ? { reconnectToken: value.reconnectToken } : {}
        }
      };
    }
    case "ready":
      return boolean(value.ready) ? { ok: true, value: { type: "ready", ready: value.ready } } : { ok: false, reason: "Ready must be a boolean." };
    case "input": {
      if (!sequence(value.seq) || !finite(value.clientTime) || !record(value.controls) || !finite(value.controls.steer) || value.controls.steer < -1 || value.controls.steer > 1 || !boolean(value.controls.jump) || !boolean(value.controls.grapple) || !boolean(value.controls.dash) || !isMotionState(value.motion)) {
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
            dash: value.controls.dash
          },
          motion: value.motion
        }
      };
    }
    case "checkpoint":
      return sequence(value.seq) && Number.isInteger(value.checkpointIndex) && typeof value.checkpointIndex === "number" && value.checkpointIndex >= 0 && value.checkpointIndex <= 64 ? {
        ok: true,
        value: {
          type: "checkpoint",
          seq: value.seq,
          checkpointIndex: value.checkpointIndex
        }
      } : { ok: false, reason: "Invalid checkpoint message." };
    case "gameplay_event":
      return sequence(value.seq) && typeof value.event === "string" && GAMEPLAY_EVENTS.has(value.event) && typeof value.objectId === "string" && OBJECT_ID_PATTERN.test(value.objectId) ? {
        ok: true,
        value: {
          type: "gameplay_event",
          seq: value.seq,
          event: value.event,
          objectId: value.objectId
        }
      } : { ok: false, reason: "Invalid gameplay event." };
    case "respawn":
      return sequence(value.seq) && typeof value.reason === "string" && RESPAWN_REASONS.has(value.reason) ? {
        ok: true,
        value: {
          type: "respawn",
          seq: value.seq,
          reason: value.reason
        }
      } : { ok: false, reason: "Invalid respawn message." };
    case "finish":
      return sequence(value.seq) ? { ok: true, value: { type: "finish", seq: value.seq } } : { ok: false, reason: "Invalid finish message." };
    case "power_up_collect":
      return sequence(value.seq) && typeof value.objectId === "string" && POWER_UP_ID_PATTERN.test(value.objectId) && typeof value.kind === "string" && POWER_UP_KINDS2.has(value.kind) ? {
        ok: true,
        value: {
          type: "power_up_collect",
          seq: value.seq,
          objectId: value.objectId,
          kind: value.kind
        }
      } : { ok: false, reason: "Invalid power-up collection message." };
    case "ping":
      return typeof value.nonce === "string" && value.nonce.length >= 1 && value.nonce.length <= 64 && finite(value.clientTime) && (value.rttMs === void 0 || finite(value.rttMs) && value.rttMs >= 0 && value.rttMs <= 5e3) ? {
        ok: true,
        value: {
          type: "ping",
          nonce: value.nonce,
          clientTime: value.clientTime,
          ...value.rttMs === void 0 ? {} : { rttMs: value.rttMs }
        }
      } : { ok: false, reason: "Invalid ping message." };
    case "leave":
      return { ok: true, value: { type: "leave" } };
    case "play_again":
      return { ok: true, value: { type: "play_again" } };
    default:
      return { ok: false, reason: "Unknown message type." };
  }
}
__name(parseClientMessage, "parseClientMessage");
function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "Malformed JSON." };
  }
}
__name(safeJsonParse, "safeJsonParse");
function isToken(value) {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}
__name(isToken, "isToken");

// worker/MatchRoom.ts
var STORAGE_KEY = "room";
var RESERVATION_TTL_MS = 2e4;
var COUNTDOWN_MS = 5e3;
var QUICK_AUTO_START_MS = 2e4;
var SOCKET_INACTIVITY_MS = 3e4;
var EMPTY_ROOM_TTL_MS = 5 * 6e4;
var LOBBY_TTL_MS = 30 * 6e4;
var RESULTS_TTL_MS = 10 * 6e4;
var RESPAWN_DELAY_MS = 1500;
var RESPAWN_PROTECTION_MS = 3e3;
var MAX_LINEAR_SPEED = 120;
var MAX_VELOCITY = 135;
var POSITION_TOLERANCE = 24;
var CHECKPOINT_DISTANCE_TOLERANCE = 35;
var FINISH_DISTANCE_TOLERANCE = 8;
var POWER_UP_PICKUP_PROGRESS_TOLERANCE = 42;
var POWER_UP_PICKUP_COOLDOWN_MS = 500;
var MAX_TOTAL_MESSAGES_PER_SECOND = 70;
var MAX_INPUT_MESSAGES_PER_SECOND = 35;
var MAX_ACTION_MESSAGES_PER_SECOND = 18;
var PLACEMENT_BONUSES = [3e3, 2e3, 1400, 1e3, 750, 500, 300, 150];
var EVENT_RULES = {
  shard: { cooldownMs: 60, combo: 0.08, style: 0, maximum: 512 },
  drone: { cooldownMs: 450, combo: 0.4, style: 0, maximum: 30 },
  near_miss: { cooldownMs: 700, combo: 0.18, style: 75, maximum: 180 },
  clean_release: { cooldownMs: 300, combo: 0.12, style: 60, maximum: 300 },
  high_speed: { cooldownMs: 900, combo: 0.1, style: 30, maximum: 180 },
  combo_chain: { cooldownMs: 800, combo: 0.2, style: 90, maximum: 180 },
  risky_route: { cooldownMs: 1500, combo: 0.35, style: 150, maximum: 80 }
};
function emptyMotion() {
  return {
    position: { x: 0, y: 32.25, z: 2 },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    distance: 0,
    grounded: true,
    action: "run"
  };
}
__name(emptyMotion, "emptyMotion");
function emptyRoom() {
  const now = Date.now();
  return {
    created: false,
    code: "",
    private: false,
    phase: "lobby",
    createdAt: now,
    lastActivityAt: now,
    reservations: {},
    claimedPowerUps: {},
    players: {},
    course: createCourse(now),
    countdownEndsAt: null,
    countdownReason: null,
    quickAutoStartAt: null,
    startedAt: null,
    matchEndsAt: null,
    finishingEndsAt: null,
    endedAt: null,
    finalReason: null,
    finalResults: null,
    snapshotSeq: 0,
    nextFinishPlacement: 1
  };
}
__name(emptyRoom, "emptyRoom");
function token() {
  return crypto.randomUUID();
}
__name(token, "token");
function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" }
  });
}
__name(json, "json");
function failure(code, message, status) {
  return json({ ok: false, code, message }, status);
}
__name(failure, "failure");
function vectorLength(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}
__name(vectorLength, "vectorLength");
function vectorDistance(left, right) {
  return Math.hypot(
    left.x - right.x,
    left.y - right.y,
    left.z - right.z
  );
}
__name(vectorDistance, "vectorDistance");
function validationErrorCode(reason) {
  if (reason.includes("protocol")) return "unsupported_protocol";
  if (reason.includes("player name")) return "invalid_name";
  if (reason.includes("player colour")) return "invalid_color";
  return "invalid_message";
}
__name(validationErrorCode, "validationErrorCode");
var MatchRoom = class {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    void this.env;
    this.ctx.blockConcurrencyWhile(async () => {
      const [stored, alarm] = await Promise.all([
        this.ctx.storage.get(STORAGE_KEY),
        this.ctx.storage.getAlarm()
      ]);
      if (stored) {
        this.room = stored;
        this.room.claimedPowerUps ??= {};
        for (const player of Object.values(this.room.players)) {
          player.activePowerUps ??= {};
          player.lastPowerUpAt ??= 0;
        }
      }
      this.scheduledAlarm = alarm;
      this.lastPersistAt = Date.now();
    });
  }
  ctx;
  env;
  static {
    __name(this, "MatchRoom");
  }
  room = emptyRoom();
  lastPersistAt = 0;
  nextSnapshotAt = 0;
  scheduledAlarm = null;
  advancing = false;
  async fetch(request) {
    const url = new URL(request.url);
    const now = Date.now();
    await this.advance(now);
    if (url.pathname === "/internal/create" && request.method === "POST") {
      if (this.room.created) {
        return failure("bad_request", "Room code is already in use.", 409);
      }
      const body = await request.json().catch(() => null);
      const code = body && typeof body.code === "string" ? normalizeRoomCode(body.code) : null;
      if (!code || typeof body?.private !== "boolean") {
        return failure("bad_request", "Invalid room creation request.", 400);
      }
      this.room = {
        ...emptyRoom(),
        created: true,
        code,
        private: body.private,
        createdAt: now,
        lastActivityAt: now,
        course: createCourse(now)
      };
      const reservation = this.issueReservation(now);
      await this.persist(true);
      await this.scheduleAlarm(now);
      return json({ ok: true, roomCode: code, ...reservation }, 201);
    }
    if (url.pathname === "/internal/reserve" && request.method === "POST") {
      if (!this.room.created) {
        return failure("room_not_found", "Room not found.", 404);
      }
      if (this.room.phase !== "lobby" && this.room.phase !== "countdown") {
        return failure("match_started", "This match has already started.", 409);
      }
      this.removeExpiredReservations(now);
      const occupied = this.activePlayerCount() + this.reservationCount();
      if (occupied >= MAX_PLAYERS) {
        return failure("room_full", "This room is full.", 409);
      }
      const reservation = this.issueReservation(now);
      await this.persist(true);
      await this.scheduleAlarm(now);
      return json({ ok: true, roomCode: this.room.code, ...reservation });
    }
    if (url.pathname === "/internal/status" && request.method === "GET") {
      if (!this.room.created) {
        return failure("room_not_found", "Room not found.", 404);
      }
      return json({
        ok: true,
        room: this.roomView(),
        reservable: (this.room.phase === "lobby" || this.room.phase === "countdown") && this.activePlayerCount() + this.reservationCount() < MAX_PLAYERS
      });
    }
    if (url.pathname === "/ws" && request.method === "GET") {
      if (!this.room.created) {
        return failure("room_not_found", "Room not found.", 404);
      }
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return failure("bad_request", "Expected a WebSocket upgrade.", 426);
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      const attachment = {
        connectionId: token(),
        joined: false,
        playerId: null,
        windowStartedAt: now,
        totalMessages: 0,
        inputMessages: 0,
        actionMessages: 0,
        invalidMessages: 0
      };
      server.serializeAttachment(attachment);
      this.ctx.acceptWebSocket(server);
      this.send(server, {
        type: "connected",
        protocol: PROTOCOL_VERSION,
        roomCode: this.room.code,
        serverTime: now
      });
      return new Response(null, { status: 101, webSocket: client });
    }
    return json({ ok: false, message: "Not found." }, 404);
  }
  async webSocketMessage(socket, data) {
    const now = Date.now();
    const attachment = this.attachment(socket, now);
    if (typeof data !== "string") {
      this.sendError(socket, "invalid_message", "Binary messages are not supported.");
      attachment.invalidMessages += 1;
      socket.serializeAttachment(attachment);
      if (attachment.invalidMessages >= 3) socket.close(1003, "Text JSON required");
      return;
    }
    if (new TextEncoder().encode(data).byteLength > MAX_MESSAGE_BYTES) {
      this.sendError(socket, "message_too_large", "Message is too large.");
      socket.close(1009, "Message too large");
      return;
    }
    if (!this.consumeRateLimit(attachment, data, now)) {
      this.sendError(socket, "rate_limited", "Too many messages.", true);
      socket.serializeAttachment(attachment);
      if (attachment.totalMessages > MAX_TOTAL_MESSAGES_PER_SECOND * 2) {
        socket.close(1008, "Rate limit");
      }
      return;
    }
    const parsedJson = safeJsonParse(data);
    if (!parsedJson.ok) {
      this.invalidMessage(socket, attachment, parsedJson.reason);
      return;
    }
    const parsed = parseClientMessage(parsedJson.value);
    if (!parsed.ok) {
      this.invalidMessage(
        socket,
        attachment,
        parsed.reason,
        validationErrorCode(parsed.reason)
      );
      return;
    }
    await this.advance(now);
    await this.handleMessage(socket, attachment, parsed.value, now);
    socket.serializeAttachment(attachment);
    await this.scheduleAlarm(now);
  }
  async webSocketClose(socket, _code, _reason, _wasClean) {
    await this.disconnectSocket(socket, Date.now());
  }
  async webSocketError(socket, _error) {
    await this.disconnectSocket(socket, Date.now());
  }
  async alarm() {
    const now = Date.now();
    this.scheduledAlarm = null;
    await this.advance(now);
    if (this.room.created && this.ctx.getWebSockets().length > 0) {
      this.emitSnapshot(now, true);
    }
    await this.persist(true);
    await this.scheduleAlarm(now);
  }
  async handleMessage(socket, attachment, message, now) {
    if (message.type === "join") {
      if (attachment.joined) {
        this.sendError(socket, "already_joined", "This socket already joined.");
        return;
      }
      await this.handleJoin(socket, attachment, message, now);
      return;
    }
    if (!attachment.joined || !attachment.playerId) {
      this.sendError(socket, "join_required", "Join the room first.");
      return;
    }
    const player = this.room.players[attachment.playerId];
    if (!player || player.connectionId !== attachment.connectionId) {
      attachment.joined = false;
      attachment.playerId = null;
      this.sendError(socket, "join_required", "The player session is no longer active.");
      return;
    }
    player.lastSeenAt = now;
    this.room.lastActivityAt = now;
    switch (message.type) {
      case "ready":
        await this.handleReady(socket, player, message.ready, now);
        break;
      case "input":
        await this.handleInput(socket, player, message, now);
        break;
      case "checkpoint":
        await this.handleCheckpoint(
          socket,
          player,
          message.seq,
          message.checkpointIndex,
          now
        );
        break;
      case "gameplay_event":
        await this.handleGameplayEvent(socket, player, message, now);
        break;
      case "respawn":
        await this.handleRespawn(socket, player, message.seq, message.reason, now);
        break;
      case "finish":
        await this.handleFinish(socket, player, message.seq, now);
        break;
      case "power_up_collect":
        await this.handlePowerUpCollect(socket, player, message, now);
        break;
      case "ping":
        this.handlePing(
          socket,
          player,
          message.nonce,
          message.clientTime,
          message.rttMs,
          now
        );
        await this.persist(false);
        break;
      case "leave":
        await this.handleLeave(player, now);
        attachment.joined = false;
        attachment.playerId = null;
        socket.close(1e3, "Left room");
        break;
      case "play_again":
        await this.handlePlayAgain(socket, player, now);
        break;
    }
  }
  async handleJoin(socket, attachment, message, now) {
    if (!this.room.created) {
      this.sendError(socket, "room_not_found", "Room not found.");
      socket.close(1008, "Room not found");
      return;
    }
    if (message.reconnectToken) {
      const player2 = Object.values(this.room.players).find(
        (candidate) => candidate.reconnectToken === message.reconnectToken
      );
      if (!player2 || player2.abandoned) {
        this.sendError(
          socket,
          "invalid_reconnect_token",
          "That reconnect token is not valid."
        );
        return;
      }
      if (player2.connected && this.findSocketForPlayer(player2.id, attachment.connectionId)) {
        this.sendError(
          socket,
          "duplicate_connection",
          "That player is already connected."
        );
        return;
      }
      if (!player2.connected && player2.graceUntil !== null && player2.graceUntil < now) {
        this.sendError(
          socket,
          "invalid_reconnect_token",
          "The reconnect window has expired."
        );
        return;
      }
      player2.connected = true;
      player2.connectionId = attachment.connectionId;
      player2.disconnectedAt = null;
      player2.graceUntil = null;
      player2.lastSeenAt = now;
      player2.reconnectToken = token();
      player2.lastInputSeq = -1;
      player2.lastActionSeq = -1;
      player2.lastMotionAt = now;
      attachment.joined = true;
      attachment.playerId = player2.id;
      this.ensureHost();
      this.sendWelcome(socket, player2, true, now);
      this.sendActivePowerUps(socket, now);
      if (this.room.phase === "results" && this.room.finalResults) {
        this.send(socket, {
          type: "results",
          endedAt: this.room.endedAt ?? now,
          reason: this.room.finalReason ?? "timer",
          results: this.room.finalResults
        });
      }
      this.broadcastRoom();
      this.emitSnapshot(now, true);
      await this.persist(true);
      return;
    }
    if (this.room.phase !== "lobby" && this.room.phase !== "countdown") {
      this.sendError(socket, "match_started", "This match has already started.");
      return;
    }
    if (!message.reservationToken || !isToken(message.reservationToken)) {
      this.sendError(
        socket,
        "invalid_reservation",
        "Reserve a place before joining."
      );
      return;
    }
    this.removeExpiredReservations(now);
    const reservation = this.room.reservations[message.reservationToken];
    if (!reservation || reservation.expiresAt < now) {
      this.sendError(
        socket,
        "invalid_reservation",
        "The room reservation is missing or expired.",
        true
      );
      return;
    }
    delete this.room.reservations[message.reservationToken];
    if (this.activePlayerCount() >= MAX_PLAYERS) {
      this.sendError(socket, "room_full", "This room is full.");
      return;
    }
    const id = token();
    const player = {
      id,
      name: message.name,
      color: message.color,
      ready: false,
      host: Object.keys(this.room.players).length === 0,
      connected: true,
      connectionId: attachment.connectionId,
      reconnectToken: token(),
      joinedAt: now,
      lastSeenAt: now,
      disconnectedAt: null,
      graceUntil: null,
      abandoned: false,
      motion: emptyMotion(),
      checkpointIndex: 0,
      lastCheckpointAt: now,
      checkpointRespawnPosition: checkpointPosition(this.room.course, 0),
      shardsCollected: 0,
      dronesDestroyed: 0,
      stylePoints: 0,
      placementBonus: 0,
      crashes: 0,
      combo: 1,
      maximumCombo: 1,
      lastComboAt: now,
      finishPlacement: null,
      finishTimeMs: null,
      respawningUntil: null,
      protectedUntil: null,
      lastRespawnAt: 0,
      lastPowerUpAt: 0,
      activePowerUps: {},
      lastReadyAt: 0,
      lastInputSeq: -1,
      lastActionSeq: -1,
      lastMotionAt: now,
      plausibilityStrikes: 0,
      seenObjectIds: [],
      lastEventAt: {},
      eventCounts: {},
      pingMs: null,
      pingSamples: 0
    };
    this.room.players[id] = player;
    attachment.joined = true;
    attachment.playerId = id;
    this.room.lastActivityAt = now;
    this.ensureHost();
    this.sendWelcome(socket, player, false, now);
    this.sendActivePowerUps(socket, now);
    this.broadcastRoom();
    await this.maybeStartCountdown(now);
    this.emitSnapshot(now, true);
    await this.persist(true);
  }
  async handleReady(socket, player, ready, now) {
    if (this.room.phase !== "lobby" && this.room.phase !== "countdown") {
      this.sendError(socket, "wrong_phase", "Ready-up is only available in the lobby.");
      return;
    }
    if (now - player.lastReadyAt < 500) {
      this.sendError(socket, "rate_limited", "Please wait before changing ready state.");
      return;
    }
    player.lastReadyAt = now;
    player.ready = ready;
    if (this.room.phase === "countdown" && this.room.countdownReason === "ready" && !this.allConnectedPlayersReady()) {
      this.cancelCountdown();
    }
    this.broadcastRoom();
    await this.maybeStartCountdown(now);
    await this.persist(true);
  }
  async handleInput(socket, player, message, now) {
    if (this.room.phase !== "racing" && this.room.phase !== "finishing") return;
    if (player.finishPlacement !== null) return;
    if (message.seq <= player.lastInputSeq) {
      this.sendError(socket, "stale_sequence", "Stale input sequence.");
      return;
    }
    player.lastInputSeq = message.seq;
    if (player.respawningUntil !== null && player.respawningUntil > now) {
      return;
    }
    const elapsedSeconds = Math.max(
      0.01,
      Math.min(2, (now - player.lastMotionAt) / 1e3)
    );
    const allowedMovement = MAX_LINEAR_SPEED * elapsedSeconds + POSITION_TOLERANCE;
    const positionDelta = vectorDistance(
      player.motion.position,
      message.motion.position
    );
    const distanceDelta = message.motion.distance - player.motion.distance;
    const plausible = vectorLength(message.motion.velocity) <= MAX_VELOCITY && positionDelta <= allowedMovement && distanceDelta <= allowedMovement && Math.abs(message.motion.position.z - 2 - message.motion.distance) <= 60 && message.motion.distance <= this.room.course.totalDistance + 250;
    if (!plausible) {
      player.plausibilityStrikes += 1;
      this.sendError(
        socket,
        "implausible_state",
        "Movement update exceeded the server plausibility limit."
      );
      if (player.plausibilityStrikes >= 6) {
        socket.close(1008, "Implausible movement");
      }
      await this.persist(false);
      return;
    }
    player.plausibilityStrikes = Math.max(0, player.plausibilityStrikes - 1);
    player.lastMotionAt = now;
    player.motion = {
      ...message.motion,
      position: { ...message.motion.position },
      velocity: { ...message.motion.velocity },
      distance: Math.max(player.motion.distance, message.motion.distance)
    };
    this.emitSnapshot(now);
    await this.persist(false);
  }
  async handleCheckpoint(socket, player, seq, checkpointIndex, now) {
    if (!this.canPerformRaceAction(socket, player, seq, now)) return;
    const expected = player.checkpointIndex + 1;
    const targetDistance = this.room.course.checkpointDistances[checkpointIndex];
    if (checkpointIndex !== expected || targetDistance === void 0 || player.motion.distance < targetDistance - CHECKPOINT_DISTANCE_TOLERANCE) {
      this.sendError(
        socket,
        "invalid_checkpoint",
        "Checkpoint progress was out of order or too far away."
      );
      return;
    }
    const previousDistance = checkpointIndex === 0 ? 0 : this.room.course.checkpointDistances[checkpointIndex - 1] ?? 0;
    const earliestMs = Math.max(0, (targetDistance - previousDistance) / MAX_LINEAR_SPEED) * 1e3 - 1e3;
    if (now - player.lastCheckpointAt < earliestMs) {
      this.sendError(
        socket,
        "invalid_checkpoint",
        "Checkpoint was reached impossibly quickly."
      );
      return;
    }
    player.checkpointIndex = checkpointIndex;
    player.lastCheckpointAt = now;
    player.checkpointRespawnPosition = {
      x: player.motion.position.x,
      y: player.motion.position.y,
      // Authored checkpoint respawns are four world units behind the gate.
      z: targetDistance - 2
    };
    this.bumpCombo(player, 0.25, now);
    player.stylePoints += 100 * player.combo;
    const placement = this.placements().get(player.id) ?? 1;
    this.broadcast({
      type: "checkpoint",
      playerId: player.id,
      checkpointIndex,
      placement,
      score: scoreBreakdown(player)
    });
    this.emitSnapshot(now, true);
    await this.persist(true);
  }
  async handleGameplayEvent(socket, player, message, now) {
    if (!this.canPerformRaceAction(socket, player, message.seq, now)) return;
    if (!this.gameplayObjectIsPlausible(player, message.event, message.objectId)) {
      this.sendError(
        socket,
        "invalid_message",
        "Gameplay object does not match the shared course state."
      );
      return;
    }
    if (player.seenObjectIds.includes(message.objectId)) {
      this.sendError(socket, "duplicate_event", "That gameplay event was already counted.");
      return;
    }
    const rule = EVENT_RULES[message.event];
    const lastAt = player.lastEventAt[message.event] ?? 0;
    if (now - lastAt < rule.cooldownMs) {
      this.sendError(socket, "rate_limited", "Gameplay event arrived too quickly.");
      return;
    }
    const count = player.eventCounts[message.event] ?? 0;
    if (count >= rule.maximum) {
      this.sendError(socket, "rate_limited", "Gameplay event limit reached.");
      return;
    }
    player.seenObjectIds.push(message.objectId);
    if (player.seenObjectIds.length > 2048) player.seenObjectIds.shift();
    player.lastEventAt[message.event] = now;
    player.eventCounts[message.event] = count + 1;
    if (message.event === "shard") player.shardsCollected += 1;
    if (message.event === "drone") player.dronesDestroyed += 1;
    this.bumpCombo(player, rule.combo, now);
    const overdriveMultiplier = this.powerUpIsActive(
      player,
      "overdrive",
      now
    ) ? 1.35 : 1;
    player.stylePoints += rule.style * player.combo * overdriveMultiplier;
    await this.persist(false);
    this.emitSnapshot(now);
  }
  async handlePowerUpCollect(socket, player, message, now) {
    if (!this.canPerformRaceAction(socket, player, message.seq, now)) return;
    if (now - player.lastPowerUpAt < POWER_UP_PICKUP_COOLDOWN_MS) {
      this.sendError(
        socket,
        "rate_limited",
        "Power-ups cannot be collected that quickly."
      );
      return;
    }
    const match = /^power-(\d{1,3})$/.exec(message.objectId);
    const chunkIndex = match?.[1] ? Number.parseInt(match[1], 10) : -1;
    const chunkId = this.room.course.chunkIds[chunkIndex];
    const expectedKind = deterministicPowerUpKind(
      this.room.course.seed,
      message.objectId
    );
    if (!chunkId?.endsWith("-hazard") || expectedKind === null || expectedKind !== message.kind) {
      this.sendError(
        socket,
        "invalid_power_up",
        "Power-up does not match a deterministic course spawn."
      );
      return;
    }
    const expectedDistance = chunkIndex * 52 + 43;
    if (Math.abs(player.motion.distance - expectedDistance) > POWER_UP_PICKUP_PROGRESS_TOLERANCE) {
      this.sendError(
        socket,
        "invalid_power_up",
        "Player is not close enough to that power-up."
      );
      return;
    }
    if (this.room.claimedPowerUps[message.objectId]) {
      this.sendError(
        socket,
        "power_up_claimed",
        "That power-up has already been collected."
      );
      return;
    }
    const duration = POWER_UP_DURATION_MS[message.kind];
    const active = {
      objectId: message.objectId,
      kind: message.kind,
      startsAt: now,
      endsAt: now + duration
    };
    player.lastPowerUpAt = now;
    player.activePowerUps[message.kind] = active;
    player.stylePoints += 200;
    this.room.claimedPowerUps[message.objectId] = {
      objectId: message.objectId,
      kind: message.kind,
      playerId: player.id,
      claimedAt: now
    };
    this.broadcast({
      type: "power_up_state",
      playerId: player.id,
      objectId: active.objectId,
      kind: active.kind,
      state: "active",
      startsAt: active.startsAt,
      endsAt: active.endsAt,
      serverTime: now
    });
    this.emitSnapshot(now, true);
    await this.persist(true);
  }
  async handleRespawn(socket, player, seq, reason, now) {
    if (!this.canPerformRaceAction(socket, player, seq, now)) return;
    if (now - player.lastRespawnAt < 1e3) {
      this.sendError(socket, "rate_limited", "Respawn requested too quickly.");
      return;
    }
    const position = { ...player.checkpointRespawnPosition };
    const checkpointDistance = player.checkpointIndex <= 0 ? 0 : this.room.course.checkpointDistances[player.checkpointIndex] ?? 0;
    player.lastRespawnAt = now;
    player.crashes += 1;
    player.combo = 1;
    player.lastComboAt = now;
    player.respawningUntil = now + RESPAWN_DELAY_MS;
    player.protectedUntil = player.respawningUntil + RESPAWN_PROTECTION_MS;
    player.motion = {
      ...emptyMotion(),
      position,
      distance: checkpointDistance,
      action: "respawn"
    };
    player.lastMotionAt = player.respawningUntil;
    this.broadcast({
      type: "respawn",
      playerId: player.id,
      reason,
      checkpointIndex: player.checkpointIndex,
      position,
      respawnAt: player.respawningUntil,
      protectedUntil: player.protectedUntil,
      penalty: 200
    });
    this.emitSnapshot(now, true);
    await this.persist(true);
  }
  async handleFinish(socket, player, seq, now) {
    if (!this.canPerformRaceAction(socket, player, seq, now)) return;
    if (player.checkpointIndex !== this.room.course.checkpointDistances.length - 1 || player.motion.distance < this.room.course.totalDistance - FINISH_DISTANCE_TOLERANCE) {
      this.sendError(
        socket,
        "invalid_checkpoint",
        "The final checkpoint has not been completed."
      );
      return;
    }
    player.finishPlacement = this.room.nextFinishPlacement;
    this.room.nextFinishPlacement += 1;
    player.finishTimeMs = Math.max(0, now - (this.room.startedAt ?? now));
    player.motion = { ...player.motion, action: "finished" };
    player.placementBonus = PLACEMENT_BONUSES[player.finishPlacement - 1] ?? 0;
    if (this.room.phase === "racing") {
      this.room.phase = "finishing";
      this.room.finishingEndsAt = Math.min(
        this.room.matchEndsAt ?? now + FINISHING_WINDOW_MS,
        now + FINISHING_WINDOW_MS
      );
    }
    this.broadcast({
      type: "finish",
      playerId: player.id,
      placement: player.finishPlacement,
      finishTimeMs: player.finishTimeMs,
      finishingEndsAt: this.room.finishingEndsAt ?? now
    });
    this.broadcastRoom();
    this.emitSnapshot(now, true);
    if (this.allRemainingPlayersFinished()) {
      await this.concludeMatch("all_finished", now);
    } else {
      await this.persist(true);
    }
  }
  handlePing(socket, player, nonce, clientTime, reportedRttMs, now) {
    const wallClockSample = now - clientTime;
    const sample = reportedRttMs ?? (wallClockSample >= 0 && wallClockSample <= 5e3 ? wallClockSample : null);
    if (sample !== null) {
      const previousSamples = Math.min(player.pingSamples, 19);
      player.pingMs = player.pingMs === null ? Math.round(sample) : Math.round(
        (player.pingMs * previousSamples + sample) / (previousSamples + 1)
      );
      player.pingSamples = previousSamples + 1;
    }
    this.send(socket, {
      type: "pong",
      nonce,
      clientTime,
      serverTime: now
    });
  }
  async handleLeave(player, now) {
    if (this.room.phase === "lobby" || this.room.phase === "countdown" || this.room.phase === "results") {
      delete this.room.players[player.id];
    } else {
      player.connected = false;
      player.connectionId = null;
      player.abandoned = true;
      player.graceUntil = null;
      player.reconnectToken = token();
    }
    this.room.lastActivityAt = now;
    this.ensureHost();
    if (this.connectedPlayerCount() < MIN_PLAYERS && this.room.phase === "countdown") {
      this.cancelCountdown();
    }
    this.broadcastRoom();
    this.emitSnapshot(now, true);
    if (this.room.phase === "finishing" && this.allRemainingPlayersFinished()) {
      await this.concludeMatch("all_finished", now);
    } else if ((this.room.phase === "racing" || this.room.phase === "finishing") && this.recoverablePlayerCount(now) === 0) {
      await this.concludeMatch("empty", now);
    } else {
      await this.persist(true);
    }
  }
  async handlePlayAgain(socket, player, now) {
    if (this.room.phase !== "results") {
      this.sendError(socket, "wrong_phase", "The match is not on the results screen.");
      return;
    }
    if (!player.host) {
      this.sendError(socket, "not_host", "Only the room host can return to the lobby.");
      return;
    }
    for (const candidate of Object.values(this.room.players)) {
      if (!candidate.connected || candidate.abandoned) {
        delete this.room.players[candidate.id];
        continue;
      }
      this.resetPlayerForRace(candidate, now);
      candidate.ready = false;
    }
    this.room.phase = "lobby";
    this.room.course = createCourse(now);
    this.room.countdownEndsAt = null;
    this.room.countdownReason = null;
    this.room.quickAutoStartAt = null;
    this.room.startedAt = null;
    this.room.matchEndsAt = null;
    this.room.finishingEndsAt = null;
    this.room.endedAt = null;
    this.room.finalReason = null;
    this.room.finalResults = null;
    this.room.claimedPowerUps = {};
    this.room.nextFinishPlacement = 1;
    this.room.lastActivityAt = now;
    this.ensureHost();
    this.broadcastRoom();
    this.emitSnapshot(now, true);
    await this.persist(true);
  }
  canPerformRaceAction(socket, player, seq, now) {
    if (this.room.phase !== "racing" && this.room.phase !== "finishing") {
      this.sendError(socket, "wrong_phase", "The race is not active.");
      return false;
    }
    if (seq <= player.lastActionSeq) {
      this.sendError(socket, "stale_sequence", "Stale action sequence.");
      return false;
    }
    player.lastActionSeq = seq;
    if (player.finishPlacement !== null) {
      this.sendError(socket, "wrong_phase", "This player has already finished.");
      return false;
    }
    if (player.respawningUntil !== null && player.respawningUntil > now) {
      this.sendError(socket, "wrong_phase", "Player is currently respawning.");
      return false;
    }
    return true;
  }
  async maybeStartCountdown(now) {
    if (this.room.phase !== "lobby") return;
    const count = this.connectedPlayerCount();
    if (count < MIN_PLAYERS) {
      this.room.quickAutoStartAt = null;
      return;
    }
    if (this.allConnectedPlayersReady()) {
      this.beginCountdown(now, "ready");
      return;
    }
    if (!this.room.private) {
      this.room.quickAutoStartAt ??= now + QUICK_AUTO_START_MS;
      if (this.room.quickAutoStartAt <= now) {
        this.beginCountdown(now, "auto");
      }
    }
  }
  beginCountdown(now, reason) {
    if (this.room.phase !== "lobby") return;
    this.room.phase = "countdown";
    this.room.countdownReason = reason;
    this.room.countdownEndsAt = now + COUNTDOWN_MS;
    this.room.course.hazardEpoch = this.room.countdownEndsAt;
    this.room.quickAutoStartAt = null;
    this.broadcast({
      type: "countdown",
      startsAt: this.room.countdownEndsAt,
      course: this.room.course
    });
    this.broadcastRoom();
  }
  cancelCountdown() {
    if (this.room.phase !== "countdown") return;
    this.room.phase = "lobby";
    this.room.countdownEndsAt = null;
    this.room.countdownReason = null;
    this.room.quickAutoStartAt = null;
    this.broadcastRoom();
  }
  async startMatch(now) {
    for (const player of Object.values(this.room.players)) {
      if (!player.connected) delete this.room.players[player.id];
    }
    if (this.connectedPlayerCount() < MIN_PLAYERS) {
      this.cancelCountdown();
      await this.persist(true);
      return;
    }
    this.room.phase = "racing";
    this.room.startedAt = now;
    this.room.matchEndsAt = now + MATCH_DURATION_MS;
    this.room.finishingEndsAt = null;
    this.room.countdownEndsAt = null;
    this.room.countdownReason = null;
    this.room.quickAutoStartAt = null;
    this.room.nextFinishPlacement = 1;
    this.room.claimedPowerUps = {};
    for (const player of Object.values(this.room.players)) {
      this.resetPlayerForRace(player, now);
    }
    this.broadcast({
      type: "start",
      startedAt: now,
      endsAt: this.room.matchEndsAt,
      course: this.room.course
    });
    this.broadcastRoom();
    this.emitSnapshot(now, true);
    await this.persist(true);
  }
  resetPlayerForRace(player, now) {
    player.ready = false;
    player.abandoned = false;
    player.motion = emptyMotion();
    player.checkpointIndex = 0;
    player.lastCheckpointAt = now;
    player.checkpointRespawnPosition = checkpointPosition(this.room.course, 0);
    player.shardsCollected = 0;
    player.dronesDestroyed = 0;
    player.stylePoints = 0;
    player.placementBonus = 0;
    player.crashes = 0;
    player.combo = 1;
    player.maximumCombo = 1;
    player.lastComboAt = now;
    player.finishPlacement = null;
    player.finishTimeMs = null;
    player.respawningUntil = null;
    player.protectedUntil = null;
    player.lastRespawnAt = 0;
    player.lastPowerUpAt = 0;
    player.activePowerUps = {};
    player.lastInputSeq = -1;
    player.lastActionSeq = -1;
    player.lastMotionAt = now;
    player.plausibilityStrikes = 0;
    player.seenObjectIds = [];
    player.lastEventAt = {};
    player.eventCounts = {};
  }
  async concludeMatch(reason, now) {
    if (this.room.phase === "results") return;
    this.room.phase = "results";
    this.room.endedAt = now;
    this.room.finalReason = reason;
    this.room.matchEndsAt = null;
    this.room.finishingEndsAt = null;
    const ordered = Object.values(this.room.players).sort((left, right) => {
      if (left.finishPlacement !== null && right.finishPlacement !== null) {
        return left.finishPlacement - right.finishPlacement;
      }
      if (left.finishPlacement !== null) return -1;
      if (right.finishPlacement !== null) return 1;
      if (left.checkpointIndex !== right.checkpointIndex) {
        return right.checkpointIndex - left.checkpointIndex;
      }
      if (left.motion.distance !== right.motion.distance) {
        return right.motion.distance - left.motion.distance;
      }
      return scoreBreakdown(right).total - scoreBreakdown(left).total;
    });
    ordered.forEach((player, index) => {
      const placement = player.finishPlacement ?? index + 1;
      player.placementBonus = PLACEMENT_BONUSES[placement - 1] ?? 0;
    });
    this.room.finalResults = ordered.map((player, index) => {
      const placement = player.finishPlacement ?? index + 1;
      return {
        playerId: player.id,
        name: player.name,
        color: player.color,
        placement,
        finished: player.finishPlacement !== null,
        finishTimeMs: player.finishTimeMs,
        distance: Math.round(player.motion.distance),
        checkpointIndex: player.checkpointIndex,
        maximumCombo: Number(player.maximumCombo.toFixed(2)),
        shardsCollected: player.shardsCollected,
        dronesDestroyed: player.dronesDestroyed,
        crashes: player.crashes,
        pingQuality: this.pingQuality(player.pingMs),
        score: scoreBreakdown(player)
      };
    });
    this.broadcast({
      type: "results",
      endedAt: now,
      reason,
      results: this.room.finalResults
    });
    this.broadcastRoom();
    await this.persist(true);
  }
  async advance(now) {
    if (this.advancing || !this.room.created) return;
    this.advancing = true;
    try {
      this.removeExpiredReservations(now);
      const stateChanged = this.expirePowerUps(now);
      let rosterChanged = false;
      for (const player of Object.values(this.room.players)) {
        if (player.connected && now - player.lastSeenAt > SOCKET_INACTIVITY_MS) {
          const socket = this.findSocketForPlayer(player.id);
          if (socket) socket.close(1001, "Inactive");
          this.markDisconnected(player, now);
          rosterChanged = true;
        }
        if (!player.connected && player.graceUntil !== null && player.graceUntil <= now) {
          if (this.room.phase === "racing" || this.room.phase === "finishing") {
            player.abandoned = true;
            player.graceUntil = null;
            player.reconnectToken = token();
          } else {
            delete this.room.players[player.id];
          }
          rosterChanged = true;
        }
      }
      if (rosterChanged) {
        this.ensureHost();
        this.broadcastRoom();
      }
      if (this.room.phase === "lobby") {
        await this.maybeStartCountdown(now);
      } else if (this.room.phase === "countdown") {
        if (this.connectedPlayerCount() < MIN_PLAYERS) {
          this.cancelCountdown();
        } else if (this.room.countdownEndsAt !== null && now >= this.room.countdownEndsAt) {
          await this.startMatch(now);
        }
      } else if (this.room.phase === "racing") {
        if (this.recoverablePlayerCount(now) === 0) {
          await this.concludeMatch("empty", now);
        } else if (this.room.matchEndsAt !== null && now >= this.room.matchEndsAt) {
          await this.concludeMatch("timer", now);
        }
      } else if (this.room.phase === "finishing") {
        if (this.recoverablePlayerCount(now) === 0) {
          await this.concludeMatch("empty", now);
        } else if (this.allRemainingPlayersFinished()) {
          await this.concludeMatch("all_finished", now);
        } else if (this.room.finishingEndsAt !== null && now >= this.room.finishingEndsAt) {
          await this.concludeMatch("finishing_window", now);
        } else if (this.room.matchEndsAt !== null && now >= this.room.matchEndsAt) {
          await this.concludeMatch("timer", now);
        }
      }
      const noRoster = Object.keys(this.room.players).length === 0 && this.reservationCount() === 0;
      const ttl = this.room.phase === "results" ? RESULTS_TTL_MS : this.room.phase === "lobby" ? LOBBY_TTL_MS : EMPTY_ROOM_TTL_MS;
      if (noRoster && now - this.room.lastActivityAt >= Math.min(ttl, EMPTY_ROOM_TTL_MS)) {
        await this.clearRoom();
        return;
      }
      if (this.connectedPlayerCount() === 0 && now - this.room.lastActivityAt >= ttl) {
        await this.clearRoom();
        return;
      }
      if (rosterChanged || stateChanged) {
        this.emitSnapshot(now, true);
        await this.persist(true);
      }
    } finally {
      this.advancing = false;
    }
  }
  issueReservation(now) {
    const reservationToken = token();
    const reservationExpiresAt = now + RESERVATION_TTL_MS;
    this.room.reservations[reservationToken] = {
      token: reservationToken,
      expiresAt: reservationExpiresAt
    };
    this.room.lastActivityAt = now;
    return { reservationToken, reservationExpiresAt };
  }
  removeExpiredReservations(now) {
    for (const [reservationToken, reservation] of Object.entries(
      this.room.reservations
    )) {
      if (reservation.expiresAt <= now) {
        delete this.room.reservations[reservationToken];
      }
    }
  }
  reservationCount() {
    return Object.keys(this.room.reservations).length;
  }
  activePlayerCount() {
    return Object.values(this.room.players).filter(
      (player) => !player.abandoned
    ).length;
  }
  connectedPlayerCount() {
    return Object.values(this.room.players).filter(
      (player) => player.connected && !player.abandoned
    ).length;
  }
  recoverablePlayerCount(now) {
    return Object.values(this.room.players).filter(
      (player) => !player.abandoned && (player.connected || player.graceUntil !== null && player.graceUntil > now)
    ).length;
  }
  allConnectedPlayersReady() {
    const players = Object.values(this.room.players).filter(
      (player) => player.connected && !player.abandoned
    );
    return players.length >= MIN_PLAYERS && players.every((player) => player.ready);
  }
  allRemainingPlayersFinished() {
    const players = Object.values(this.room.players).filter(
      (player) => !player.abandoned
    );
    return players.length > 0 && players.every((player) => player.finishPlacement !== null);
  }
  ensureHost() {
    const players = Object.values(this.room.players);
    const current = players.find((player) => player.host && player.connected);
    if (current) {
      for (const player of players) {
        if (player.id !== current.id) player.host = false;
      }
      return;
    }
    const next = players.filter((player) => player.connected && !player.abandoned).sort((left, right) => left.joinedAt - right.joinedAt)[0];
    for (const player of players) player.host = player.id === next?.id;
  }
  roomView() {
    return {
      code: this.room.code,
      private: this.room.private,
      phase: this.room.phase,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      players: Object.values(this.room.players).filter((player) => !player.abandoned).sort((left, right) => left.joinedAt - right.joinedAt).map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        ready: player.ready,
        host: player.host,
        connected: player.connected,
        pingMs: player.pingMs
      })),
      countdownEndsAt: this.room.countdownEndsAt,
      matchEndsAt: this.room.matchEndsAt
    };
  }
  placements() {
    const sorted = Object.values(this.room.players).filter((player) => !player.abandoned).sort((left, right) => {
      if (left.finishPlacement !== null && right.finishPlacement !== null) {
        return left.finishPlacement - right.finishPlacement;
      }
      if (left.finishPlacement !== null) return -1;
      if (right.finishPlacement !== null) return 1;
      if (left.checkpointIndex !== right.checkpointIndex) {
        return right.checkpointIndex - left.checkpointIndex;
      }
      if (left.motion.distance !== right.motion.distance) {
        return right.motion.distance - left.motion.distance;
      }
      return scoreBreakdown(right).total - scoreBreakdown(left).total;
    });
    return new Map(sorted.map((player, index) => [player.id, index + 1]));
  }
  emitSnapshot(now, force = false) {
    const interval = 1e3 / SNAPSHOT_RATE_HZ;
    if (!force && this.nextSnapshotAt > 0 && now < this.nextSnapshotAt) return;
    if (this.room.phase !== "racing" && this.room.phase !== "finishing" && !force) {
      return;
    }
    if (force || this.nextSnapshotAt <= 0) {
      this.nextSnapshotAt = now + interval;
    } else {
      do {
        this.nextSnapshotAt += interval;
      } while (this.nextSnapshotAt <= now);
    }
    this.room.snapshotSeq += 1;
    const placements = this.placements();
    const players = Object.values(this.room.players).filter((player) => !player.abandoned).map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      connected: player.connected,
      motion: player.motion,
      checkpointIndex: player.checkpointIndex,
      placement: placements.get(player.id) ?? MAX_PLAYERS,
      score: scoreBreakdown(player).total,
      combo: Number(this.comboAt(player, now).toFixed(2)),
      finished: player.finishPlacement !== null,
      finishTimeMs: player.finishTimeMs,
      respawningUntil: player.respawningUntil,
      protectedUntil: player.protectedUntil,
      pingMs: player.pingMs
    }));
    const relevantEnd = this.room.phase === "countdown" ? this.room.countdownEndsAt : this.room.phase === "finishing" ? this.room.finishingEndsAt : this.room.phase === "racing" ? this.room.matchEndsAt : null;
    this.broadcast({
      type: "snapshot",
      seq: this.room.snapshotSeq,
      serverTime: now,
      phase: this.room.phase,
      timeRemainingMs: relevantEnd === null ? 0 : Math.max(0, relevantEnd - now),
      players
    });
  }
  sendWelcome(socket, player, reconnected, now) {
    this.send(socket, {
      type: "welcome",
      protocol: PROTOCOL_VERSION,
      playerId: player.id,
      reconnectToken: player.reconnectToken,
      reconnected,
      serverTime: now,
      inputRateHz: INPUT_RATE_HZ,
      snapshotRateHz: SNAPSHOT_RATE_HZ,
      room: this.roomView(),
      course: this.room.course
    });
  }
  broadcastRoom() {
    this.broadcast({ type: "room", room: this.roomView() });
  }
  broadcast(message) {
    const encoded = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.attachment(socket, Date.now());
      if (!attachment.joined) continue;
      try {
        socket.send(encoded);
      } catch {
      }
    }
  }
  send(socket, message) {
    try {
      socket.send(JSON.stringify(message));
    } catch {
    }
  }
  sendError(socket, code, message, retryable = false) {
    this.send(socket, { type: "error", code, message, retryable });
  }
  invalidMessage(socket, attachment, reason, code = "invalid_message") {
    attachment.invalidMessages += 1;
    this.sendError(socket, code, reason);
    socket.serializeAttachment(attachment);
    if (attachment.invalidMessages >= 6) {
      socket.close(1008, "Too many invalid messages");
    }
  }
  attachment(socket, now) {
    const stored = socket.deserializeAttachment();
    return stored ?? {
      connectionId: token(),
      joined: false,
      playerId: null,
      windowStartedAt: now,
      totalMessages: 0,
      inputMessages: 0,
      actionMessages: 0,
      invalidMessages: 0
    };
  }
  consumeRateLimit(attachment, raw, now) {
    if (now - attachment.windowStartedAt >= 1e3) {
      attachment.windowStartedAt = now;
      attachment.totalMessages = 0;
      attachment.inputMessages = 0;
      attachment.actionMessages = 0;
    }
    attachment.totalMessages += 1;
    if (raw.includes('"type":"input"') || raw.includes('"type": "input"')) {
      attachment.inputMessages += 1;
    } else if (!raw.includes('"type":"ping"') && !raw.includes('"type": "ping"')) {
      attachment.actionMessages += 1;
    }
    return attachment.totalMessages <= MAX_TOTAL_MESSAGES_PER_SECOND && attachment.inputMessages <= MAX_INPUT_MESSAGES_PER_SECOND && attachment.actionMessages <= MAX_ACTION_MESSAGES_PER_SECOND;
  }
  async disconnectSocket(socket, now) {
    const attachment = this.attachment(socket, now);
    if (!attachment.joined || !attachment.playerId) return;
    const player = this.room.players[attachment.playerId];
    if (!player || player.connectionId !== attachment.connectionId) return;
    this.markDisconnected(player, now);
    this.ensureHost();
    this.broadcastRoom();
    this.emitSnapshot(now, true);
    await this.persist(true);
    await this.scheduleAlarm(now);
  }
  markDisconnected(player, now) {
    player.connected = false;
    player.connectionId = null;
    player.disconnectedAt = now;
    player.graceUntil = now + RECONNECT_GRACE_MS;
    if (this.room.phase === "lobby" || this.room.phase === "countdown") {
      player.ready = false;
    }
    this.room.lastActivityAt = now;
  }
  findSocketForPlayer(playerId, exceptConnectionId) {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.attachment(socket, Date.now());
      if (attachment.joined && attachment.playerId === playerId && attachment.connectionId !== exceptConnectionId) {
        return socket;
      }
    }
    return null;
  }
  powerUpIsActive(player, kind, now) {
    const active = player.activePowerUps[kind];
    return active !== void 0 && active.endsAt > now;
  }
  sendActivePowerUps(socket, now) {
    for (const player of Object.values(this.room.players)) {
      for (const active of Object.values(player.activePowerUps)) {
        if (!active || active.endsAt <= now) continue;
        this.send(socket, {
          type: "power_up_state",
          playerId: player.id,
          objectId: active.objectId,
          kind: active.kind,
          state: "active",
          startsAt: active.startsAt,
          endsAt: active.endsAt,
          serverTime: now
        });
      }
    }
  }
  expirePowerUps(now) {
    let changed = false;
    for (const player of Object.values(this.room.players)) {
      for (const active of Object.values(player.activePowerUps)) {
        if (!active || active.endsAt > now) continue;
        delete player.activePowerUps[active.kind];
        this.broadcast({
          type: "power_up_state",
          playerId: player.id,
          objectId: active.objectId,
          kind: active.kind,
          state: "expired",
          startsAt: active.startsAt,
          endsAt: active.endsAt,
          serverTime: now
        });
        changed = true;
      }
    }
    return changed;
  }
  bumpCombo(player, amount, now) {
    this.decayCombo(player, now);
    player.combo = Math.min(5, player.combo + amount);
    player.maximumCombo = Math.max(player.maximumCombo, player.combo);
    player.lastComboAt = now;
  }
  gameplayObjectIsPlausible(player, event, objectId) {
    if (event !== "shard" && event !== "drone") return true;
    const match = event === "shard" ? /^shard-(\d+)-([a-z-]+)-(\d+)$/.exec(objectId) : /^drone-(\d+)$/.exec(objectId);
    const chunkIndex = match?.[1] ? Number.parseInt(match[1], 10) : -1;
    const chunkId = this.room.course.chunkIds[chunkIndex];
    if (!match || !chunkId) return false;
    const currentChunk = Math.floor(player.motion.distance / 52);
    if (Math.abs(chunkIndex - currentChunk) > 1) return false;
    if (event === "drone") return chunkId.endsWith("-hazard");
    const suffix = match[2];
    const itemIndex = match[3] ? Number.parseInt(match[3], 10) : -1;
    const kind = chunkId.slice(`chunk-${chunkIndex}-`.length);
    const allowed = {
      beginner: { warmup: 8 },
      grapple: { arc: 7 },
      split: { safe: 5, risk: 8 },
      curved: { curve: 4 },
      "wall-run": { wall: 7 },
      rail: { rail: 8 },
      moving: { moving: 7 },
      hazard: { "hazard-left": 6, "hazard-right": 6 },
      final: { finish: 9 }
    };
    const maximum = suffix ? allowed[kind]?.[suffix] : void 0;
    return maximum !== void 0 && itemIndex >= 0 && itemIndex < maximum;
  }
  decayCombo(player, now) {
    player.combo = this.comboAt(player, now);
    player.lastComboAt = now;
  }
  comboAt(player, now) {
    const idleMs = Math.max(0, now - player.lastComboAt - 2e3);
    return Math.max(1, player.combo - idleMs / 8e3);
  }
  pingQuality(pingMs) {
    if (pingMs === null) return "unknown";
    if (pingMs < 60) return "great";
    if (pingMs < 120) return "good";
    if (pingMs < 220) return "fair";
    return "poor";
  }
  async persist(force) {
    const now = Date.now();
    if (!force && now - this.lastPersistAt < 1e3) return;
    this.lastPersistAt = now;
    await this.ctx.storage.put(STORAGE_KEY, this.room);
  }
  async scheduleAlarm(now) {
    if (!this.room.created) return;
    const candidates = [];
    for (const reservation of Object.values(this.room.reservations)) {
      candidates.push(reservation.expiresAt);
    }
    for (const player of Object.values(this.room.players)) {
      if (player.connected) candidates.push(player.lastSeenAt + SOCKET_INACTIVITY_MS);
      if (player.graceUntil !== null) candidates.push(player.graceUntil);
      for (const active of Object.values(player.activePowerUps)) {
        if (active) candidates.push(active.endsAt);
      }
    }
    if (this.room.quickAutoStartAt !== null) {
      candidates.push(this.room.quickAutoStartAt);
    }
    if (this.room.countdownEndsAt !== null) candidates.push(this.room.countdownEndsAt);
    if (this.room.matchEndsAt !== null) candidates.push(this.room.matchEndsAt);
    if (this.room.finishingEndsAt !== null) candidates.push(this.room.finishingEndsAt);
    const ttl = this.room.phase === "results" ? RESULTS_TTL_MS : this.room.phase === "lobby" ? LOBBY_TTL_MS : EMPTY_ROOM_TTL_MS;
    candidates.push(this.room.lastActivityAt + ttl);
    if (Object.keys(this.room.players).length === 0 && this.reservationCount() === 0) {
      candidates.push(this.room.lastActivityAt + EMPTY_ROOM_TTL_MS);
    }
    const next = Math.max(
      now + 100,
      Math.min(...candidates.filter((candidate) => Number.isFinite(candidate)))
    );
    if (this.scheduledAlarm !== null && Math.abs(this.scheduledAlarm - next) < 500) {
      return;
    }
    this.scheduledAlarm = next;
    await this.ctx.storage.setAlarm(next);
  }
  async clearRoom() {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.close(1001, "Room expired");
      } catch {
      }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.room = emptyRoom();
    this.scheduledAlarm = null;
  }
};

// worker/Matchmaker.ts
var DIRECTORY_KEY = "directory";
var MAX_TRACKED_QUICK_ROOMS = 64;
var MAX_RECENT_CODES = 2048;
function json2(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" }
  });
}
__name(json2, "json");
function randomRoomCode() {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) {
    code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
  }
  return code;
}
__name(randomRoomCode, "randomRoomCode");
var Matchmaker = class {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get(DIRECTORY_KEY);
      if (stored) this.directory = stored;
    });
  }
  state;
  env;
  static {
    __name(this, "Matchmaker");
  }
  directory = { quickRooms: [], recentCodes: [] };
  operation = Promise.resolve();
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/internal/allocate") {
      return json2({ ok: false, message: "Not found." }, 404);
    }
    let release;
    const previous = this.operation;
    this.operation = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const body = await request.json().catch(() => null);
      if (!body || typeof body.private !== "boolean") {
        return json2(
          { ok: false, code: "bad_request", message: "Invalid allocation." },
          400
        );
      }
      return body.private ? await this.createRoom(true) : await this.allocateQuickRoom();
    } finally {
      release?.();
    }
  }
  async allocateQuickRoom() {
    const candidates = this.directory.quickRooms.slice().reverse();
    const surviving = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const code = candidates[index];
      if (!code) continue;
      const result = await this.reserve(code, "quick");
      if (result.ok) {
        const unvisited = candidates.slice(index + 1).reverse();
        this.directory.quickRooms = [
          .../* @__PURE__ */ new Set([...unvisited, ...surviving, code])
        ].slice(-MAX_TRACKED_QUICK_ROOMS);
        await this.persist();
        return json2(result);
      }
      if (result.code !== "room_full" && result.code !== "match_started" && result.code !== "room_not_found") {
        surviving.push(code);
      }
    }
    this.directory.quickRooms = surviving.slice(-MAX_TRACKED_QUICK_ROOMS);
    return this.createRoom(false);
  }
  async createRoom(isPrivate) {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const code = randomRoomCode();
      if (this.directory.recentCodes.includes(code)) continue;
      const stub = this.env.MATCH_ROOMS.get(
        this.env.MATCH_ROOMS.idFromName(code)
      );
      const response = await stub.fetch(
        "https://room.internal/internal/create",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code,
            private: isPrivate,
            maxPlayers: MAX_PLAYERS
          })
        }
      );
      const result = await response.json();
      if (!result.ok) {
        if (response.status === 409) {
          this.directory.recentCodes.push(code);
          continue;
        }
        return json2(result, response.status);
      }
      this.directory.recentCodes.push(code);
      this.directory.recentCodes = this.directory.recentCodes.slice(
        -MAX_RECENT_CODES
      );
      if (!isPrivate) {
        this.directory.quickRooms.push(code);
        this.directory.quickRooms = this.directory.quickRooms.slice(
          -MAX_TRACKED_QUICK_ROOMS
        );
      }
      await this.persist();
      return json2(result, 201);
    }
    await this.persist();
    return json2(
      {
        ok: false,
        code: "internal_error",
        message: "Could not allocate a room code."
      },
      503
    );
  }
  async reserve(code, source) {
    const stub = this.env.MATCH_ROOMS.get(
      this.env.MATCH_ROOMS.idFromName(code)
    );
    const response = await stub.fetch("https://room.internal/internal/reserve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source })
    });
    return await response.json();
  }
  async persist() {
    await this.state.storage.put(DIRECTORY_KEY, this.directory);
  }
};

// worker/index.ts
function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const configured = (env.ALLOWED_ORIGINS ?? "*").split(",").map((entry) => entry.trim()).filter(Boolean);
  const allowAny = configured.includes("*");
  const allowed = origin && configured.includes(origin);
  const headers = new Headers({
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "access-control-max-age": "86400",
    vary: "Origin"
  });
  if (allowAny) {
    headers.set("access-control-allow-origin", "*");
  } else if (allowed && origin) {
    headers.set("access-control-allow-origin", origin);
  }
  return headers;
}
__name(corsHeaders, "corsHeaders");
function originAllowed(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const configured = (env.ALLOWED_ORIGINS ?? "*").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (configured.includes("*") || configured.includes(origin)) return true;
  try {
    const originUrl = new URL(origin);
    return configured.some((entry) => {
      if (!entry.includes("*.")) return false;
      const allowedUrl = new URL(entry.replace("*.", "wildcard."));
      const suffix = allowedUrl.hostname.slice("wildcard".length);
      return originUrl.protocol === allowedUrl.protocol && originUrl.port === allowedUrl.port && originUrl.hostname.endsWith(suffix) && originUrl.hostname.length > suffix.length;
    });
  } catch {
    return false;
  }
}
__name(originAllowed, "originAllowed");
function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  for (const [name, value] of corsHeaders(request, env)) {
    headers.set(name, value);
  }
  headers.set("x-content-type-options", "nosniff");
  headers.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
__name(withCors, "withCors");
function json3(value, status, request, env) {
  return withCors(Response.json(value, { status }), request, env);
}
__name(json3, "json");
function publicWebSocketUrl(request, roomCode) {
  const url = new URL(request.url);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/api/rooms/${encodeURIComponent(roomCode)}/ws`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
__name(publicWebSocketUrl, "publicWebSocketUrl");
function decodeRoomCodeSegment(segment) {
  if (!segment) return null;
  try {
    return normalizeRoomCode(decodeURIComponent(segment));
  } catch {
    return null;
  }
}
__name(decodeRoomCodeSegment, "decodeRoomCodeSegment");
async function allocationResponse(response, request, env) {
  const result = await response.json();
  if (!result.ok) {
    return json3(result, response.status, request, env);
  }
  const output = {
    roomCode: result.roomCode,
    reservationToken: result.reservationToken,
    reservationExpiresAt: result.reservationExpiresAt,
    websocketUrl: publicWebSocketUrl(request, result.roomCode)
  };
  return json3(output, response.status, request, env);
}
__name(allocationResponse, "allocationResponse");
async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    const health = {
      ok: true,
      service: "neon-grapple-rush-multiplayer",
      protocol: PROTOCOL_VERSION,
      serverTime: Date.now()
    };
    return json3(health, 200, request, env);
  }
  if (request.method === "POST" && (url.pathname === "/api/rooms/quick" || url.pathname === "/api/rooms/private")) {
    const matchmaker = env.MATCHMAKER.get(
      env.MATCHMAKER.idFromName("global-directory")
    );
    const response = await matchmaker.fetch(
      "https://matchmaker.internal/internal/allocate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          private: url.pathname.endsWith("/private")
        })
      }
    );
    return allocationResponse(response, request, env);
  }
  const match = /^\/api\/rooms\/([^/]+)(?:\/(reserve|ws))?$/.exec(
    url.pathname
  );
  if (match) {
    const rawCode = match[1];
    const action = match[2];
    const code = decodeRoomCodeSegment(rawCode);
    if (!code) {
      return json3(
        {
          ok: false,
          code: "invalid_room_code",
          message: "Room codes use 5-6 safe letters and numbers."
        },
        400,
        request,
        env
      );
    }
    const room = env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(code));
    if (action === "ws" && request.method === "GET") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return json3(
          {
            ok: false,
            code: "bad_request",
            message: "Expected a WebSocket upgrade."
          },
          426,
          request,
          env
        );
      }
      if (!originAllowed(request, env)) {
        return json3(
          {
            ok: false,
            code: "bad_request",
            message: "This website origin is not allowed to open multiplayer sockets."
          },
          403,
          request,
          env
        );
      }
      const forwarded = new Request("https://room.internal/ws", request);
      return room.fetch(forwarded);
    }
    if (action === "reserve" && request.method === "POST") {
      const response = await room.fetch(
        "https://room.internal/internal/reserve",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: "code" })
        }
      );
      return allocationResponse(response, request, env);
    }
    if (!action && request.method === "GET") {
      const response = await room.fetch(
        "https://room.internal/internal/status"
      );
      return withCors(response, request, env);
    }
  }
  return json3(
    { ok: false, code: "bad_request", message: "Route not found." },
    404,
    request,
    env
  );
}
__name(handleRequest, "handleRequest");
var index_default = {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error("Worker request failed", error);
      return json3(
        {
          ok: false,
          code: "internal_error",
          message: "The multiplayer service could not complete the request."
        },
        500,
        request,
        env
      );
    }
  }
};
export {
  MatchRoom,
  Matchmaker,
  index_default as default
};
//# sourceMappingURL=index.js.map
