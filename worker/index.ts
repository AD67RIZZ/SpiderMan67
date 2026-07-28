import { MatchRoom } from "./MatchRoom";
import { Matchmaker } from "./Matchmaker";
import {
  PROTOCOL_VERSION,
  type HealthResponse,
  type RoomReservationResponse,
  type ServerErrorCode,
} from "./protocol";
import { normalizeRoomCode } from "./validation";
import type { Env } from "./env";

export { MatchRoom, Matchmaker };

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

function corsHeaders(request: Request, env: Env): Headers {
  const origin = request.headers.get("origin");
  const configured = (env.ALLOWED_ORIGINS ?? "*")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const allowAny = configured.includes("*");
  const allowed = origin && configured.includes(origin);
  const headers = new Headers({
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "access-control-max-age": "86400",
    vary: "Origin",
  });
  if (allowAny) {
    headers.set("access-control-allow-origin", "*");
  } else if (allowed && origin) {
    headers.set("access-control-allow-origin", origin);
  }
  return headers;
}

function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get("origin");
  // Native/non-browser WebSocket clients commonly omit Origin.
  if (!origin) return true;
  const configured = (env.ALLOWED_ORIGINS ?? "*")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (configured.includes("*") || configured.includes(origin)) return true;

  try {
    const originUrl = new URL(origin);
    return configured.some((entry) => {
      if (!entry.includes("*.")) return false;
      const allowedUrl = new URL(entry.replace("*.", "wildcard."));
      const suffix = allowedUrl.hostname.slice("wildcard".length);
      return (
        originUrl.protocol === allowedUrl.protocol &&
        originUrl.port === allowedUrl.port &&
        originUrl.hostname.endsWith(suffix) &&
        originUrl.hostname.length > suffix.length
      );
    });
  } catch {
    return false;
  }
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of corsHeaders(request, env)) {
    headers.set(name, value);
  }
  headers.set("x-content-type-options", "nosniff");
  headers.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(
  value: unknown,
  status: number,
  request: Request,
  env: Env,
): Response {
  return withCors(Response.json(value, { status }), request, env);
}

function publicWebSocketUrl(request: Request, roomCode: string): string {
  const url = new URL(request.url);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/api/rooms/${encodeURIComponent(roomCode)}/ws`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function decodeRoomCodeSegment(segment: string | undefined): string | null {
  if (!segment) return null;
  try {
    return normalizeRoomCode(decodeURIComponent(segment));
  } catch {
    return null;
  }
}

async function allocationResponse(
  response: Response,
  request: Request,
  env: Env,
): Promise<Response> {
  const result = (await response.json()) as
    | InternalReservation
    | InternalFailure;
  if (!result.ok) {
    return json(result, response.status, request, env);
  }
  const output: RoomReservationResponse = {
    roomCode: result.roomCode,
    reservationToken: result.reservationToken,
    reservationExpiresAt: result.reservationExpiresAt,
    websocketUrl: publicWebSocketUrl(request, result.roomCode),
  };
  return json(output, response.status, request, env);
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  if (
    request.method === "GET" &&
    (url.pathname === "/" || url.pathname === "/health")
  ) {
    const health: HealthResponse = {
      ok: true,
      service: "neon-grapple-rush-multiplayer",
      protocol: PROTOCOL_VERSION,
      serverTime: Date.now(),
    };
    return json(health, 200, request, env);
  }

  if (
    request.method === "POST" &&
    (url.pathname === "/api/rooms/quick" ||
      url.pathname === "/api/rooms/private")
  ) {
    const matchmaker = env.MATCHMAKER.get(
      env.MATCHMAKER.idFromName("global-directory"),
    );
    const response = await matchmaker.fetch(
      "https://matchmaker.internal/internal/allocate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          private: url.pathname.endsWith("/private"),
        }),
      },
    );
    return allocationResponse(response, request, env);
  }

  const match = /^\/api\/rooms\/([^/]+)(?:\/(reserve|ws))?$/.exec(
    url.pathname,
  );
  if (match) {
    const rawCode = match[1];
    const action = match[2];
    const code = decodeRoomCodeSegment(rawCode);
    if (!code) {
      return json(
        {
          ok: false,
          code: "invalid_room_code",
          message: "Room codes use 5-6 safe letters and numbers.",
        },
        400,
        request,
        env,
      );
    }

    const room = env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(code));

    if (action === "ws" && request.method === "GET") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return json(
          {
            ok: false,
            code: "bad_request",
            message: "Expected a WebSocket upgrade.",
          },
          426,
          request,
          env,
        );
      }
      if (!originAllowed(request, env)) {
        return json(
          {
            ok: false,
            code: "bad_request",
            message: "This website origin is not allowed to open multiplayer sockets.",
          },
          403,
          request,
          env,
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
          body: JSON.stringify({ source: "code" }),
        },
      );
      return allocationResponse(response, request, env);
    }

    if (!action && request.method === "GET") {
      const response = await room.fetch(
        "https://room.internal/internal/status",
      );
      return withCors(response, request, env);
    }
  }

  return json(
    { ok: false, code: "bad_request", message: "Route not found." },
    404,
    request,
    env,
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error("Worker request failed", error);
      return json(
        {
          ok: false,
          code: "internal_error",
          message: "The multiplayer service could not complete the request.",
        },
        500,
        request,
        env,
      );
    }
  },
} satisfies ExportedHandler<Env>;
