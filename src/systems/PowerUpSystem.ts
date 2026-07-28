import {
  POWER_UP_DURATION_MS,
  type PowerUpKind,
  type PowerUpStateMessage,
} from '../shared/protocol';

export type PowerUpAuthority = 'local' | 'server';
export type AuthoritativePowerUpStateKind = 'active' | 'expired' | 'consumed';

export interface ActivePowerUp {
  kind: PowerUpKind;
  remaining: number;
  duration: number;
  objectId?: string;
  startsAt?: number;
  endsAt?: number;
  authoritative?: boolean;
}

export interface PendingPowerUpCollection {
  objectId: string;
  kind: PowerUpKind;
  requestedAt: number;
}

export type AuthoritativePowerUpState = PowerUpStateMessage;

export type PowerUpCollectionResult =
  | { status: 'activated'; active: ActivePowerUp }
  | { status: 'pending'; request: PendingPowerUpCollection }
  | { status: 'duplicate' };

export interface PowerUpModifiers {
  speedMultiplier: number;
  scoreMultiplier: number;
  steeringAssist: number;
  magnetRadius: number;
  shielded: boolean;
}

export interface PowerUpSnapshot {
  authority: PowerUpAuthority;
  active: ActivePowerUp[];
  pending: PendingPowerUpCollection[];
  modifiers: PowerUpModifiers;
}

export interface PowerUpSystemOptions {
  authority?: PowerUpAuthority;
  requestTimeoutMs?: number;
}

interface InternalPendingCollection {
  request: PendingPowerUpCollection;
  timeoutAt: number;
}

export const POWER_UP_DURATIONS: Readonly<Record<PowerUpKind, number>> = {
  overdrive: POWER_UP_DURATION_MS.overdrive / 1_000,
  shield: POWER_UP_DURATION_MS.shield / 1_000,
  magnet: POWER_UP_DURATION_MS.magnet / 1_000,
};

function monotonicNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

/**
 * Local mode owns its timers. Server mode treats collection as a request and
 * derives every activation/expiry from absolute timestamps in a
 * power_up_state message.
 */
export class PowerUpSystem {
  private readonly timers = new Map<PowerUpKind, ActivePowerUp>();
  private readonly pendingCollections = new Map<string, InternalPendingCollection>();
  private readonly timedOutCollections: PendingPowerUpCollection[] = [];
  private readonly resolvedObjectIds = new Set<string>();
  private readonly requestTimeoutMs: number;
  private authorityValue: PowerUpAuthority;
  private shieldCharges = 0;
  private serverClockOffsetMs: number | null = null;

  constructor(options: PowerUpSystemOptions = {}) {
    this.authorityValue = options.authority ?? 'local';
    this.requestTimeoutMs = Math.max(1_000, Math.min(15_000, options.requestTimeoutMs ?? 5_000));
  }

  get authority(): PowerUpAuthority {
    return this.authorityValue;
  }

  setAuthority(authority: PowerUpAuthority): void {
    if (authority === this.authorityValue) {
      return;
    }
    this.clear();
    this.authorityValue = authority;
  }

  /**
   * Immediate activation is intentionally blocked in server mode. Multiplayer
   * code must call requestCollection then applyAuthoritativeState.
   */
  activate(
    kind: PowerUpKind,
    duration = POWER_UP_DURATIONS[kind],
  ): ActivePowerUp | null {
    if (this.authorityValue === 'server') {
      return null;
    }
    return this.activateTimer(kind, duration);
  }

  requestCollection(
    objectId: string,
    kind: PowerUpKind,
    requestedAt = this.estimatedServerTime,
  ): PowerUpCollectionResult {
    const cleanId = objectId.trim();
    if (
      cleanId.length === 0 ||
      this.pendingCollections.has(cleanId) ||
      this.resolvedObjectIds.has(cleanId)
    ) {
      return { status: 'duplicate' };
    }
    if (this.authorityValue === 'local') {
      this.resolvedObjectIds.add(cleanId);
      const active = this.activateTimer(kind, POWER_UP_DURATIONS[kind], cleanId);
      return { status: 'activated', active };
    }
    const request: PendingPowerUpCollection = {
      objectId: cleanId,
      kind,
      requestedAt,
    };
    this.pendingCollections.set(cleanId, {
      request,
      timeoutAt: monotonicNow() + this.requestTimeoutMs,
    });
    return { status: 'pending', request: { ...request } };
  }

  /**
   * Applies one canonical server message. RaceScene should filter playerId so
   * only the local player's modifiers are applied; all messages can still be
   * used to mark the world pickup as collected.
   */
  applyAuthoritativeState(
    message: AuthoritativePowerUpState,
    estimatedServerNow = message.serverTime,
  ): boolean {
    if (
      this.authorityValue !== 'server' ||
      !Number.isFinite(message.startsAt) ||
      !Number.isFinite(message.endsAt) ||
      !Number.isFinite(estimatedServerNow) ||
      message.endsAt < message.startsAt
    ) {
      return false;
    }
    this.synchronizeServerTime(estimatedServerNow);
    this.pendingCollections.delete(message.objectId);
    this.resolvedObjectIds.add(message.objectId);

    const existing = this.timers.get(message.kind);
    if (message.state !== 'active') {
      if (existing?.objectId === message.objectId) {
        this.timers.delete(message.kind);
        if (message.kind === 'shield') {
          this.shieldCharges = 0;
        }
      }
      return true;
    }

    const remaining = Math.max(0, (message.endsAt - estimatedServerNow) / 1_000);
    if (remaining <= 0) {
      if (existing?.objectId === message.objectId) {
        this.timers.delete(message.kind);
      }
      return true;
    }
    if (
      existing?.authoritative === true &&
      existing.endsAt !== undefined &&
      existing.endsAt > message.endsAt
    ) {
      return true;
    }
    const duration = Math.max(0.25, Math.min(60, (message.endsAt - message.startsAt) / 1_000));
    this.timers.set(message.kind, {
      kind: message.kind,
      duration,
      remaining,
      objectId: message.objectId,
      startsAt: message.startsAt,
      endsAt: message.endsAt,
      authoritative: true,
    });
    if (message.kind === 'shield') {
      this.shieldCharges = 1;
    }
    return true;
  }

  update(dt: number, estimatedServerNow?: number): PowerUpKind[] {
    const expired: PowerUpKind[] = [];
    const safeDt = Math.max(0, Math.min(0.1, dt));
    if (estimatedServerNow !== undefined && Number.isFinite(estimatedServerNow)) {
      this.synchronizeServerTime(estimatedServerNow);
    }
    const serverNow = this.estimatedServerTime;
    for (const [kind, active] of this.timers) {
      active.remaining =
        this.authorityValue === 'server' &&
        active.authoritative === true &&
        active.endsAt !== undefined
          ? Math.max(0, (active.endsAt - serverNow) / 1_000)
          : Math.max(0, active.remaining - safeDt);
      if (active.remaining <= 0 || (kind === 'shield' && this.shieldCharges <= 0)) {
        this.timers.delete(kind);
        expired.push(kind);
      }
    }
    const localNow = monotonicNow();
    for (const [objectId, pending] of this.pendingCollections) {
      if (localNow >= pending.timeoutAt) {
        this.pendingCollections.delete(objectId);
        this.timedOutCollections.push({ ...pending.request });
      }
    }
    return expired;
  }

  synchronizeServerTime(serverNow: number): void {
    if (!Number.isFinite(serverNow)) {
      return;
    }
    const sample = serverNow - monotonicNow();
    this.serverClockOffsetMs =
      this.serverClockOffsetMs === null
        ? sample
        : this.serverClockOffsetMs * 0.82 + sample * 0.18;
  }

  get estimatedServerTime(): number {
    return monotonicNow() + (this.serverClockOffsetMs ?? 0);
  }

  rejectCollection(objectId: string): PendingPowerUpCollection | null {
    const pending = this.pendingCollections.get(objectId);
    if (pending === undefined) {
      return null;
    }
    this.pendingCollections.delete(objectId);
    return { ...pending.request };
  }

  drainTimedOutCollections(): PendingPowerUpCollection[] {
    return this.timedOutCollections.splice(0, this.timedOutCollections.length);
  }

  isPending(objectId: string): boolean {
    return this.pendingCollections.has(objectId);
  }

  consumeShield(): boolean {
    if (!this.has('shield') || this.shieldCharges <= 0) {
      return false;
    }
    this.shieldCharges = 0;
    this.timers.delete('shield');
    return true;
  }

  has(kind: PowerUpKind): boolean {
    const active = this.timers.get(kind);
    return active !== undefined && active.remaining > 0 && (kind !== 'shield' || this.shieldCharges > 0);
  }

  remaining(kind: PowerUpKind): number {
    return this.timers.get(kind)?.remaining ?? 0;
  }

  get active(): ActivePowerUp[] {
    return Array.from(this.timers.values(), (entry) => ({ ...entry }));
  }

  get pending(): PendingPowerUpCollection[] {
    return Array.from(this.pendingCollections.values(), ({ request }) => ({ ...request }));
  }

  get modifiers(): PowerUpModifiers {
    const overdrive = this.has('overdrive');
    return {
      speedMultiplier: overdrive ? 1.28 : 1,
      scoreMultiplier: overdrive ? 1.35 : 1,
      steeringAssist: overdrive ? 1.18 : 1,
      magnetRadius: this.has('magnet') ? 11 : 0,
      shielded: this.has('shield'),
    };
  }

  snapshot(): PowerUpSnapshot {
    return {
      authority: this.authorityValue,
      active: this.active,
      pending: this.pending,
      modifiers: this.modifiers,
    };
  }

  restore(snapshot: readonly ActivePowerUp[]): void {
    this.clear();
    for (const active of snapshot) {
      if (active.remaining <= 0) {
        continue;
      }
      const duration = Math.max(active.remaining, active.duration);
      const restored: ActivePowerUp = {
        ...active,
        remaining: Math.min(active.remaining, 60),
        duration: Math.min(duration, 60),
      };
      this.timers.set(active.kind, restored);
      if (active.kind === 'shield') {
        this.shieldCharges = 1;
      }
      if (active.objectId !== undefined) {
        this.resolvedObjectIds.add(active.objectId);
      }
    }
  }

  clear(): void {
    this.timers.clear();
    this.pendingCollections.clear();
    this.timedOutCollections.length = 0;
    this.resolvedObjectIds.clear();
    this.shieldCharges = 0;
    this.serverClockOffsetMs = null;
  }

  private activateTimer(
    kind: PowerUpKind,
    duration: number,
    objectId?: string,
  ): ActivePowerUp {
    const safeDuration = Math.max(0.25, Math.min(60, duration));
    const existing = this.timers.get(kind);
    const active: ActivePowerUp = {
      kind,
      duration: safeDuration,
      remaining:
        existing === undefined
          ? safeDuration
          : Math.min(safeDuration * 1.5, existing.remaining + safeDuration * 0.5),
      ...(objectId === undefined ? {} : { objectId }),
      authoritative: false,
    };
    this.timers.set(kind, active);
    if (kind === 'shield') {
      this.shieldCharges = 1;
    }
    return { ...active };
  }
}
