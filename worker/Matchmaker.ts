import {
  MAX_PLAYERS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type ServerErrorCode,
} from "./protocol";
import type { Env } from "./env";

interface DirectoryState {
  quickRooms: string[];
  recentCodes: string[];
}

interface InternalReservation {
  ok: true;
  roomCode: string;
  reservationToken: string;
  reservationExpiresAt: number;
}

interface InternalFailure {
  ok: false;
  code: ServerErrorCode;
  message: string;
}

const DIRECTORY_KEY = "directory";
const MAX_TRACKED_QUICK_ROOMS = 64;
const MAX_RECENT_CODES = 2_048;

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function randomRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) {
    code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * A tiny directory DO serialises quick-match allocation. Capacity is still
 * reserved atomically by each MatchRoom, so stale directory entries cannot
 * overfill a room.
 */
export class Matchmaker {
  private directory: DirectoryState = { quickRooms: [], recentCodes: [] };
  private operation: Promise<void> = Promise.resolve();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<DirectoryState>(DIRECTORY_KEY);
      if (stored) this.directory = stored;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/internal/allocate") {
      return json({ ok: false, message: "Not found." }, 404);
    }

    let release: (() => void) | undefined;
    const previous = this.operation;
    this.operation = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      const body = (await request.json().catch(() => null)) as {
        private?: unknown;
      } | null;
      if (!body || typeof body.private !== "boolean") {
        return json(
          { ok: false, code: "bad_request", message: "Invalid allocation." },
          400,
        );
      }
      return body.private
        ? await this.createRoom(true)
        : await this.allocateQuickRoom();
    } finally {
      release?.();
    }
  }

  private async allocateQuickRoom(): Promise<Response> {
    const candidates = this.directory.quickRooms.slice().reverse();
    const surviving: string[] = [];

    for (let index = 0; index < candidates.length; index += 1) {
      const code = candidates[index];
      if (!code) continue;
      const result = await this.reserve(code, "quick");
      if (result.ok) {
        const unvisited = candidates.slice(index + 1).reverse();
        this.directory.quickRooms = [
          ...new Set([...unvisited, ...surviving, code]),
        ].slice(-MAX_TRACKED_QUICK_ROOMS);
        await this.persist();
        return json(result);
      }

      if (
        result.code !== "room_full" &&
        result.code !== "match_started" &&
        result.code !== "room_not_found"
      ) {
        surviving.push(code);
      }
    }

    // Prune rooms that reported full, started, or missing before adding a new
    // quick-match room.
    this.directory.quickRooms = surviving.slice(-MAX_TRACKED_QUICK_ROOMS);
    return this.createRoom(false);
  }

  private async createRoom(isPrivate: boolean): Promise<Response> {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const code = randomRoomCode();
      if (this.directory.recentCodes.includes(code)) continue;

      const stub = this.env.MATCH_ROOMS.get(
        this.env.MATCH_ROOMS.idFromName(code),
      );
      const response = await stub.fetch(
        "https://room.internal/internal/create",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code,
            private: isPrivate,
            maxPlayers: MAX_PLAYERS,
          }),
        },
      );
      const result = (await response.json()) as
        | InternalReservation
        | InternalFailure;

      if (!result.ok) {
        // An older still-live room can outlast the bounded recent-code list.
        // Mark the collision and try another code instead of surfacing a
        // random creation failure to the player.
        if (response.status === 409) {
          this.directory.recentCodes.push(code);
          continue;
        }
        return json(result, response.status);
      }

      this.directory.recentCodes.push(code);
      this.directory.recentCodes = this.directory.recentCodes.slice(
        -MAX_RECENT_CODES,
      );
      if (!isPrivate) {
        this.directory.quickRooms.push(code);
        this.directory.quickRooms = this.directory.quickRooms.slice(
          -MAX_TRACKED_QUICK_ROOMS,
        );
      }
      await this.persist();
      return json(result, 201);
    }

    await this.persist();
    return json(
      {
        ok: false,
        code: "internal_error",
        message: "Could not allocate a room code.",
      },
      503,
    );
  }

  private async reserve(
    code: string,
    source: "quick" | "code",
  ): Promise<InternalReservation | InternalFailure> {
    const stub = this.env.MATCH_ROOMS.get(
      this.env.MATCH_ROOMS.idFromName(code),
    );
    const response = await stub.fetch("https://room.internal/internal/reserve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source }),
    });
    return (await response.json()) as InternalReservation | InternalFailure;
  }

  private async persist(): Promise<void> {
    await this.state.storage.put(DIRECTORY_KEY, this.directory);
  }
}
