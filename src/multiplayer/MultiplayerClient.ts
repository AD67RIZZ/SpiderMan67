import {
  INPUT_RATE_HZ,
  MAX_MESSAGE_BYTES,
  PLAYER_COLORS,
  PROTOCOL_VERSION,
  ROOM_CODE_PATTERN,
  deterministicPowerUpKind,
  type CheckpointServerMessage,
  type ClientMessage,
  type ConnectedMessage,
  type CountdownMessage,
  type ErrorMessage,
  type FinishServerMessage,
  type GameplayEventKind,
  type PlayerColor,
  type PlayerControls,
  type PlayerMotionState,
  type PlayerSnapshot,
  type PowerUpKind,
  type PowerUpStateMessage,
  type RaceResult,
  type RespawnReason,
  type RespawnServerMessage,
  type RoomReservationResponse,
  type RoomView,
  type ServerMessage,
  type SnapshotMessage,
  type StartMessage,
  type WelcomeMessage,
} from "../shared/protocol";
import {
  sanitizePlayerName,
  storage,
  STORAGE_KEYS,
} from "../utils/Storage";
import { parseServerMessage } from "./ProtocolValidation";

declare global {
  interface Window {
    NEON_GRAPPLE_CONFIG?: {
      multiplayerUrl?: unknown;
    };
  }
}

export type MultiplayerStatus =
  | "idle"
  | "reserving"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "unavailable"
  | "error";

export interface MultiplayerProfile {
  name: string;
  color: string;
}

export interface MultiplayerStatusDetail {
  status: MultiplayerStatus;
  message: string;
  reconnectAttempt?: number;
}

export interface PowerUpCollectRejection {
  objectId: string | null;
  kind: PowerUpKind | null;
  error: ErrorMessage & {
    code: "invalid_power_up" | "power_up_claimed";
  };
}

export interface MultiplayerEventMap {
  status: MultiplayerStatusDetail;
  connected: ConnectedMessage;
  welcome: WelcomeMessage;
  room: RoomView;
  countdown: CountdownMessage;
  start: StartMessage;
  snapshot: SnapshotMessage;
  checkpoint: CheckpointServerMessage;
  respawn: RespawnServerMessage;
  finish: FinishServerMessage;
  power_up_state: PowerUpStateMessage;
  power_up_rejected: PowerUpCollectRejection;
  results: RaceResult[];
  ping: number;
  error: ErrorMessage;
  disconnected: { code: number; reason: string; reconnecting: boolean };
  malformed: { count: number };
  availability: { available: boolean; message: string };
  message: ServerMessage;
}

export interface MultiplayerClientOptions {
  profile?: Partial<MultiplayerProfile>;
  endpoint?: string;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  fetch?: typeof window.fetch;
  webSocketFactory?: (url: string) => WebSocket;
}

interface StoredReconnect {
  roomCode: string;
  token: string;
  websocketUrl: string;
}

interface JoinCredentials {
  roomCode: string;
  websocketUrl: string;
  reservationToken?: string;
  reconnectToken?: string;
}

export class MultiplayerUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MultiplayerUnavailableError";
  }
}

/**
 * Worker reservation + WebSocket client. It validates every incoming message,
 * rate-limits movement to ~20 Hz, measures RTT, and reconnects with the token
 * issued by the Durable Object.
 */
export class MultiplayerClient extends EventTarget {
  private statusValue: MultiplayerStatus = "idle";
  private pingValue: number | null = null;
  private serverClockOffsetMs: number | null = null;
  private playerIdValue: string | null = null;
  private seedValue: number | null = null;
  private roomCodeValue: string | null = null;
  private profile: MultiplayerProfile;
  private socket?: WebSocket;
  private websocketUrl?: string;
  private reservationToken?: string;
  private reconnectToken?: string;
  private pingTimer?: number;
  private reconnectTimer?: number;
  private pendingInputTimer?: number;
  private requestController?: AbortController;
  private lastInputSentAt = -Infinity;
  private pendingInput?: { controls: PlayerControls; motion: PlayerMotionState };
  private sequence = 0;
  private malformedCount = 0;
  private pendingPowerUpClaims: Array<{ objectId: string; kind: PowerUpKind }> = [];
  private reconnectAttempt = 0;
  private intentionallyClosed = false;
  private disposed = false;
  private generation = 0;
  private readonly fetcher: typeof window.fetch;
  private readonly makeSocket: (url: string) => WebSocket;

  public constructor(private readonly options: MultiplayerClientOptions = {}) {
    super();
    this.profile = {
      name: sanitizePlayerName(options.profile?.name),
      color: closestPlayerColor(options.profile?.color),
    };
    this.fetcher = options.fetch ?? window.fetch.bind(window);
    this.makeSocket = options.webSocketFactory ?? ((url) => new WebSocket(url));
  }

  public get status(): MultiplayerStatus {
    return this.statusValue;
  }

  public get ping(): number | null {
    return this.pingValue;
  }

  /** Current Worker wall-clock estimate, corrected using pong round trips. */
  public get estimatedServerTime(): number {
    return Date.now() + (this.serverClockOffsetMs ?? 0);
  }

  public get playerId(): string | null {
    return this.playerIdValue;
  }

  public get seed(): number | null {
    return this.seedValue;
  }

  public get roomCode(): string | null {
    return this.roomCodeValue;
  }

  public get connected(): boolean {
    return this.statusValue === "connected" && this.socket?.readyState === WebSocket.OPEN;
  }

  public on<K extends keyof MultiplayerEventMap>(
    type: K,
    listener: (detail: MultiplayerEventMap[K]) => void,
  ): () => void {
    const handler = (event: Event): void => listener((event as CustomEvent<MultiplayerEventMap[K]>).detail);
    this.addEventListener(type, handler);
    return () => this.removeEventListener(type, handler);
  }

  public setProfile(profile: Partial<MultiplayerProfile>): void {
    if (profile.name !== undefined) this.profile.name = sanitizePlayerName(profile.name);
    if (profile.color !== undefined) this.profile.color = closestPlayerColor(profile.color);
  }

  public async quickMatch(profile?: Partial<MultiplayerProfile>): Promise<void> {
    if (profile) this.setProfile(profile);
    return this.reserveAndConnect("/api/rooms/quick");
  }

  public async createPrivate(profile?: Partial<MultiplayerProfile>): Promise<void> {
    if (profile) this.setProfile(profile);
    return this.reserveAndConnect("/api/rooms/private");
  }

  public async joinPrivate(roomCode: string, profile?: Partial<MultiplayerProfile>): Promise<void> {
    if (profile) this.setProfile(profile);
    const code = roomCode.trim().toUpperCase();
    if (!ROOM_CODE_PATTERN.test(code)) {
      const error: ErrorMessage = {
        type: "error",
        code: "invalid_room_code",
        message: "That room code is not valid.",
        retryable: false,
      };
      this.emit("error", error);
      throw new Error(error.message);
    }
    return this.reserveAndConnect(`/api/rooms/${encodeURIComponent(code)}/reserve`);
  }

  public async reconnectLastSession(): Promise<boolean> {
    const stored = storage.getJSON<StoredReconnect | null>(STORAGE_KEYS.reconnectToken, null);
    if (
      !stored ||
      typeof stored.roomCode !== "string" ||
      !ROOM_CODE_PATTERN.test(stored.roomCode) ||
      typeof stored.token !== "string" ||
      typeof stored.websocketUrl !== "string"
    ) {
      return false;
    }
    this.reconnectToken = stored.token;
    this.roomCodeValue = stored.roomCode;
    this.websocketUrl = stored.websocketUrl;
    await this.connectSocket({
      roomCode: stored.roomCode,
      websocketUrl: stored.websocketUrl,
      reconnectToken: stored.token,
    }, true);
    return true;
  }

  /** Lightweight health check for the main-menu connection indicator. */
  public async checkAvailability(timeoutMs = 3_500): Promise<boolean> {
    const endpoint = this.resolveEndpoint();
    if (!endpoint) {
      this.emit("availability", {
        available: false,
        message: "Multiplayer is not configured. Solo practice is available.",
      });
      return false;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
    try {
      const response = await this.fetcher(
        new URL("/health", `${websocketBaseToHttp(endpoint)}/`).toString(),
        { headers: { accept: "application/json" }, signal: controller.signal },
      );
      const value = await readSmallJson(response);
      const available =
        response.ok &&
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>).ok === true &&
        (value as Record<string, unknown>).protocol === PROTOCOL_VERSION;
      this.emit("availability", {
        available,
        message: available ? "Multiplayer online." : "Multiplayer did not answer correctly.",
      });
      return available;
    } catch {
      this.emit("availability", {
        available: false,
        message: "Multiplayer server unavailable. Solo practice is ready.",
      });
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  public setReady(ready: boolean): boolean {
    return this.send({ type: "ready", ready });
  }

  public sendState(controls: PlayerControls, motion: PlayerMotionState): void {
    if (this.disposed) return;
    if (this.pendingInput) {
      this.pendingInput = {
        controls: {
          steer: controls.steer,
          grapple: controls.grapple,
          jump: this.pendingInput.controls.jump || controls.jump,
          dash: this.pendingInput.controls.dash || controls.dash,
        },
        motion,
      };
    } else {
      this.pendingInput = { controls: { ...controls }, motion };
    }
    const interval = 1000 / INPUT_RATE_HZ;
    const wait = interval - (performance.now() - this.lastInputSentAt);
    if (wait <= 0) {
      this.flushInput();
    } else if (this.pendingInputTimer === undefined) {
      this.pendingInputTimer = window.setTimeout(() => {
        this.pendingInputTimer = undefined;
        this.flushInput();
      }, wait);
    }
  }

  public sendCheckpoint(checkpointIndex: number): boolean {
    if (!Number.isInteger(checkpointIndex) || checkpointIndex < 0) return false;
    return this.send({
      type: "checkpoint",
      seq: this.nextSequence(),
      checkpointIndex,
    });
  }

  public sendGameplayEvent(event: GameplayEventKind, objectId: string): boolean {
    return this.send({
      type: "gameplay_event",
      seq: this.nextSequence(),
      event,
      objectId: objectId.replace(/[^a-z0-9:_-]/gi, "").slice(0, 64) || "unknown",
    });
  }

  public sendRespawn(reason: RespawnReason): boolean {
    return this.send({ type: "respawn", seq: this.nextSequence(), reason });
  }

  public sendFinish(): boolean {
    return this.send({ type: "finish", seq: this.nextSequence() });
  }

  /**
   * Request a deterministic course power-up. No local effect should be
   * activated until the Worker replies with `power_up_state`.
   */
  public sendPowerUpCollect(objectId: string, kind: PowerUpKind): boolean {
    if (!/^power-\d{1,3}$/.test(objectId)) return false;
    if (
      this.seedValue !== null &&
      deterministicPowerUpKind(this.seedValue, objectId) !== kind
    ) {
      return false;
    }
    const sent = this.send({
      type: "power_up_collect",
      seq: this.nextSequence(),
      objectId,
      kind,
    });
    if (sent) this.pendingPowerUpClaims.push({ objectId, kind });
    return sent;
  }

  public playAgain(): boolean {
    return this.send({ type: "play_again" });
  }

  public leave(): void {
    this.intentionallyClosed = true;
    this.clearTimers();
    if (this.socket?.readyState === WebSocket.OPEN) this.send({ type: "leave" });
    this.socket?.close(1000, "Player left");
    this.socket = undefined;
    this.requestController?.abort();
    this.requestController = undefined;
    this.resetRoomState();
    this.setStatus("idle", "Not connected.");
  }

  private async reserveAndConnect(path: string): Promise<void> {
    if (this.disposed) throw new Error("Multiplayer client has been disposed.");
    this.leave();
    this.intentionallyClosed = false;
    const generation = ++this.generation;
    const endpoint = this.resolveEndpoint();
    if (!endpoint) {
      const message =
        "Multiplayer is not configured for this deployment. Solo practice is still available.";
      this.setStatus("unavailable", message);
      throw new MultiplayerUnavailableError(message);
    }

    this.setStatus("reserving", "Finding a skyline room…");
    const httpBase = websocketBaseToHttp(endpoint);
    this.requestController = new AbortController();
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, `${httpBase}/`).toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: this.requestController.signal,
      });
    } catch (cause) {
      if (generation !== this.generation || this.intentionallyClosed) return;
      const message = "The multiplayer server could not be reached. You can retry or play solo.";
      this.setStatus("unavailable", message);
      throw new MultiplayerUnavailableError(
        cause instanceof Error ? `${message} (${cause.message})` : message,
      );
    } finally {
      this.requestController = undefined;
    }
    if (generation !== this.generation || this.intentionallyClosed) return;

    const json = await readSmallJson(response);
    if (!response.ok) {
      const error = serverHttpError(json, response.status);
      this.emit("error", error);
      this.setStatus("error", error.message);
      throw new Error(error.message);
    }
    const reservation = parseReservation(json, httpBase);
    if (!reservation) {
      const message = "The multiplayer server returned an invalid room reservation.";
      this.setStatus("error", message);
      throw new Error(message);
    }
    await this.connectSocket({
      roomCode: reservation.roomCode,
      websocketUrl: reservation.websocketUrl,
      reservationToken: reservation.reservationToken,
    }, false);
  }

  private async connectSocket(credentials: JoinCredentials, reconnecting: boolean): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.intentionallyClosed = false;
    this.websocketUrl = credentials.websocketUrl;
    this.roomCodeValue = credentials.roomCode;
    this.reservationToken = credentials.reservationToken;
    if (credentials.reconnectToken) this.reconnectToken = credentials.reconnectToken;
    this.setStatus(
      reconnecting ? "reconnecting" : "connecting",
      reconnecting ? "Reconnecting to the race…" : "Opening the skyline link…",
      reconnecting ? this.reconnectAttempt : undefined,
    );

    let socket: WebSocket;
    try {
      socket = this.makeSocket(credentials.websocketUrl);
    } catch (cause) {
      if (reconnecting) {
        this.scheduleReconnect();
        return;
      }
      const message = cause instanceof Error ? cause.message : "Could not create a WebSocket.";
      this.setStatus("unavailable", message);
      throw new MultiplayerUnavailableError(message);
    }
    this.socket?.close(1000, "Superseded");
    this.socket = socket;
    socket.binaryType = "arraybuffer";

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const open = (): void => {
        if (generation !== this.generation || this.disposed) {
          socket.close(1000, "Stale connection");
          return;
        }
        socket.send(
          JSON.stringify({
            type: "join",
            protocol: PROTOCOL_VERSION,
            name: this.profile.name,
            color: this.profile.color,
            ...(credentials.reservationToken
              ? { reservationToken: credentials.reservationToken }
              : {}),
            ...(credentials.reconnectToken
              ? { reconnectToken: credentials.reconnectToken }
              : {}),
          } satisfies ClientMessage),
        );
        settled = true;
        resolve();
      };
      const error = (): void => {
        if (settled) return;
        settled = true;
        if (reconnecting) {
          resolve();
          this.scheduleReconnect();
        } else {
          reject(new MultiplayerUnavailableError("The multiplayer WebSocket could not open."));
        }
      };
      socket.addEventListener("open", open, { once: true });
      socket.addEventListener("error", error, { once: true });
      socket.addEventListener("message", (event) => this.handleMessage(event));
      socket.addEventListener("close", (event) => this.handleClose(event, generation));
      socket.addEventListener("close", () => {
        if (settled) return;
        settled = true;
        if (reconnecting) resolve();
        else reject(new MultiplayerUnavailableError("The multiplayer WebSocket closed before opening."));
      }, { once: true });
    }).catch((cause) => {
      if (!reconnecting) {
        this.setStatus("unavailable", "The multiplayer link could not open. Solo practice is available.");
        throw cause;
      }
    });
  }

  private handleMessage(event: MessageEvent<unknown>): void {
    if (typeof event.data !== "string") {
      this.handleMalformed();
      return;
    }
    if (new TextEncoder().encode(event.data).byteLength > MAX_MESSAGE_BYTES) {
      this.socket?.close(1009, "Message too large");
      return;
    }
    const message = parseServerMessage(event.data);
    if (!message) {
      this.handleMalformed();
      return;
    }
    if (
      message.type === "power_up_state" &&
      this.seedValue !== null &&
      deterministicPowerUpKind(this.seedValue, message.objectId) !== message.kind
    ) {
      this.handleMalformed();
      return;
    }
    this.malformedCount = 0;
    this.emit("message", message);

    switch (message.type) {
      case "connected":
        this.recordServerTime(message.serverTime);
        this.emit("connected", message);
        break;
      case "welcome":
        this.handleWelcome(message);
        break;
      case "room":
        this.emit("room", message.room);
        break;
      case "countdown":
        this.seedValue = message.course.seed;
        this.emit("countdown", message);
        break;
      case "start":
        this.seedValue = message.course.seed;
        this.emit("start", message);
        break;
      case "snapshot":
        this.emit("snapshot", message);
        break;
      case "checkpoint":
        this.emit("checkpoint", message);
        break;
      case "respawn":
        this.emit("respawn", message);
        break;
      case "finish":
        this.emit("finish", message);
        break;
      case "power_up_state":
        if (message.playerId === this.playerIdValue) {
          this.pendingPowerUpClaims = this.pendingPowerUpClaims.filter(
            (claim) => claim.objectId !== message.objectId,
          );
        }
        this.emit("power_up_state", message);
        break;
      case "results":
        this.emit("results", message.results);
        break;
      case "pong":
        this.handlePong(message.nonce, message.clientTime, message.serverTime);
        break;
      case "error":
        if (
          message.code === "invalid_power_up" ||
          message.code === "power_up_claimed"
        ) {
          const claim = this.pendingPowerUpClaims.shift();
          this.emit("power_up_rejected", {
            objectId: claim?.objectId ?? null,
            kind: claim?.kind ?? null,
            error: message as PowerUpCollectRejection["error"],
          });
          break;
        }
        this.emit("error", message);
        if (message.code === "invalid_reconnect_token") storage.remove(STORAGE_KEYS.reconnectToken);
        if (!message.retryable) this.setStatus("error", message.message);
        break;
    }
  }

  private handleWelcome(message: WelcomeMessage): void {
    this.recordServerTime(message.serverTime);
    this.playerIdValue = message.playerId;
    this.roomCodeValue = message.room.code;
    this.seedValue = message.course.seed;
    this.reconnectToken = message.reconnectToken;
    this.reservationToken = undefined;
    this.reconnectAttempt = 0;
    if (this.websocketUrl) {
      storage.setJSON(STORAGE_KEYS.reconnectToken, {
        roomCode: message.room.code,
        token: message.reconnectToken,
        websocketUrl: this.websocketUrl,
      } satisfies StoredReconnect);
    }
    this.setStatus("connected", message.reconnected ? "Reconnected to the race." : "Connected.");
    this.startPing();
    this.emit("welcome", message);
    this.emit("room", message.room);
  }

  private handlePong(nonce: string, clientTime: number, serverTime: number): void {
    if (!nonce.startsWith("p-")) return;
    const receivedAt = Date.now();
    const rtt = Math.max(0, receivedAt - clientTime);
    this.pingValue = this.pingValue === null ? rtt : this.pingValue * 0.72 + rtt * 0.28;
    this.recordServerTime(serverTime, receivedAt, clientTime);
    this.emit("ping", this.pingValue);
  }

  private recordServerTime(
    serverTime: number,
    receivedAt = Date.now(),
    sentAt?: number,
  ): void {
    const estimatedAtReceive =
      sentAt === undefined
        ? serverTime
        : serverTime + Math.max(0, receivedAt - sentAt) * 0.5;
    const sample = estimatedAtReceive - receivedAt;
    const weight = sentAt === undefined ? 0.12 : 0.55;
    this.serverClockOffsetMs =
      this.serverClockOffsetMs === null
        ? sample
        : this.serverClockOffsetMs * (1 - weight) + sample * weight;
  }

  private handleMalformed(): void {
    this.malformedCount += 1;
    this.emit("malformed", { count: this.malformedCount });
    if (this.malformedCount >= 3) {
      this.socket?.close(1002, "Repeated invalid server messages");
    }
  }

  private handleClose(event: CloseEvent, generation: number): void {
    if (generation !== this.generation) return;
    this.stopPing();
    this.socket = undefined;
    if (this.intentionallyClosed || this.disposed || event.code === 1000) {
      if (!this.disposed) this.setStatus("idle", "Not connected.");
      return;
    }
    const canReconnect =
      (this.options.reconnect ?? true) &&
      Boolean(this.reconnectToken && this.websocketUrl && this.roomCodeValue);
    this.setStatus(
      canReconnect ? "reconnecting" : "disconnected",
      canReconnect ? "Connection lost. Reconnecting…" : "Connection lost.",
      canReconnect ? this.reconnectAttempt + 1 : undefined,
    );
    this.emit("disconnected", {
      code: event.code,
      reason: event.reason || "Connection closed",
      reconnecting: canReconnect,
    });
    if (canReconnect) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.intentionallyClosed || this.reconnectTimer !== undefined) return;
    const maximum = this.options.maxReconnectAttempts ?? 7;
    if (this.reconnectAttempt >= maximum) {
      this.setStatus("disconnected", "Could not reconnect. Solo practice is still available.");
      return;
    }
    const delays = [500, 1_000, 2_000, 3_500, 5_500, 8_000, 10_000];
    const delay = delays[Math.min(this.reconnectAttempt, delays.length - 1)] ?? 10_000;
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.websocketUrl || !this.roomCodeValue || !this.reconnectToken) return;
      void this.connectSocket({
        roomCode: this.roomCodeValue,
        websocketUrl: this.websocketUrl,
        reconnectToken: this.reconnectToken,
      }, true).catch(() => this.scheduleReconnect());
    }, delay);
  }

  private flushInput(): void {
    if (!this.pendingInput) return;
    const input = this.pendingInput;
    this.pendingInput = undefined;
    if (
      this.send({
        type: "input",
        seq: this.nextSequence(),
        clientTime: Date.now(),
        controls: input.controls,
        motion: input.motion,
      })
    ) {
      this.lastInputSentAt = performance.now();
    }
  }

  private send(message: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  private nextSequence(): number {
    this.sequence = (this.sequence + 1) % 2_147_483_647;
    return this.sequence;
  }

  private startPing(): void {
    this.stopPing();
    const ping = (): void => {
      if (!this.connected) return;
      const now = Date.now();
      this.send({
        type: "ping",
        nonce: `p-${Math.round(now).toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        clientTime: now,
        ...(this.pingValue === null
          ? {}
          : { rttMs: Math.max(0, Math.min(5_000, this.pingValue)) }),
      });
    };
    ping();
    this.pingTimer = window.setInterval(ping, 4_000);
  }

  private stopPing(): void {
    if (this.pingTimer !== undefined) window.clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }

  private clearTimers(): void {
    this.stopPing();
    if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer);
    if (this.pendingInputTimer !== undefined) window.clearTimeout(this.pendingInputTimer);
    this.reconnectTimer = undefined;
    this.pendingInputTimer = undefined;
    this.pendingInput = undefined;
    this.pendingPowerUpClaims.length = 0;
  }

  private resetRoomState(): void {
    this.playerIdValue = null;
    this.seedValue = null;
    this.roomCodeValue = null;
    this.websocketUrl = undefined;
    this.reservationToken = undefined;
    this.reconnectToken = undefined;
    this.pingValue = null;
    this.serverClockOffsetMs = null;
    this.reconnectAttempt = 0;
    this.sequence = 0;
    storage.remove(STORAGE_KEYS.reconnectToken);
  }

  private resolveEndpoint(): string | null {
    const raw = this.options.endpoint ?? (
      import.meta.env.DEV
        ? "ws://localhost:8787/ws"
        : window.NEON_GRAPPLE_CONFIG?.multiplayerUrl
    );
    if (typeof raw !== "string" || raw.trim() === "") return null;
    if (/your-worker|your-subdomain|example\.com/i.test(raw)) return null;
    try {
      const url = new URL(raw.trim(), window.location.href);
      if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
      if (!import.meta.env.DEV && window.location.protocol === "https:" && url.protocol !== "wss:") {
        return null;
      }
      return url.toString();
    } catch {
      return null;
    }
  }

  private setStatus(
    status: MultiplayerStatus,
    message: string,
    reconnectAttempt?: number,
  ): void {
    this.statusValue = status;
    this.emit("status", {
      status,
      message,
      ...(reconnectAttempt === undefined ? {} : { reconnectAttempt }),
    });
  }

  private emit<K extends keyof MultiplayerEventMap>(type: K, detail: MultiplayerEventMap[K]): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  public dispose(): void {
    if (this.disposed) return;
    this.leave();
    this.disposed = true;
    this.statusValue = "idle";
  }

  public destroy(): void {
    this.dispose();
  }
}

function websocketBaseToHttp(endpoint: string): string {
  const url = new URL(endpoint);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/ws\/?$/i, "").replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function parseReservation(value: unknown, httpBase: string): RoomReservationResponse | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.roomCode !== "string" ||
    !ROOM_CODE_PATTERN.test(record.roomCode) ||
    typeof record.reservationToken !== "string" ||
    record.reservationToken.length < 16 ||
    typeof record.reservationExpiresAt !== "number" ||
    !Number.isFinite(record.reservationExpiresAt) ||
    typeof record.websocketUrl !== "string"
  ) {
    return null;
  }
  try {
    const url = new URL(record.websocketUrl, `${httpBase}/`);
    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol === "https:") url.protocol = "wss:";
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
    return {
      roomCode: record.roomCode,
      reservationToken: record.reservationToken,
      reservationExpiresAt: record.reservationExpiresAt,
      websocketUrl: url.toString(),
    };
  } catch {
    return null;
  }
}

function serverHttpError(value: unknown, status: number): ErrorMessage {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.message === "string") {
      return {
        type: "error",
        code:
          typeof record.code === "string"
            ? (record.code as ErrorMessage["code"])
            : "bad_request",
        message: record.message.slice(0, 512),
        retryable: status >= 500 || status === 429,
      };
    }
  }
  return {
    type: "error",
    code: status >= 500 ? "internal_error" : "bad_request",
    message:
      status === 404
        ? "That room was not found."
        : status === 409
          ? "That room cannot be joined right now."
          : "The multiplayer request failed.",
    retryable: status >= 500 || status === 429,
  };
}

function closestPlayerColor(raw: unknown): PlayerColor {
  if (typeof raw !== "string" || !/^#[0-9a-f]{6}$/i.test(raw)) return PLAYER_COLORS[0];
  const normalized = raw.toLowerCase();
  const exact = PLAYER_COLORS.find((color) => color === normalized);
  if (exact) return exact;
  const target = hexToRgb(normalized);
  let closest: PlayerColor = PLAYER_COLORS[0];
  let closestDistance = Infinity;
  for (const color of PLAYER_COLORS) {
    const candidate = hexToRgb(color);
    const distance =
      (target[0] - candidate[0]) ** 2 +
      (target[1] - candidate[1]) ** 2 +
      (target[2] - candidate[2]) ** 2;
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = color;
    }
  }
  return closest;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** Convert any local player colour to the Worker protocol palette. */
export function multiplayerColor(raw: string): PlayerColor {
  return closestPlayerColor(raw);
}

/** Convenience helper for extracting the local player from a snapshot event. */
export function localSnapshot(
  message: SnapshotMessage,
  playerId: string | null,
): PlayerSnapshot | undefined {
  return playerId ? message.players.find((player) => player.id === playerId) : undefined;
}

async function readSmallJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_MESSAGE_BYTES) return null;
  try {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_MESSAGE_BYTES) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
