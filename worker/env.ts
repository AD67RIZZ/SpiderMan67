/** Bindings shared by the router, matchmaker, and match-room objects. */
export interface Env {
  MATCH_ROOMS: DurableObjectNamespace;
  MATCHMAKER: DurableObjectNamespace;
  ALLOWED_ORIGINS?: string;
}
