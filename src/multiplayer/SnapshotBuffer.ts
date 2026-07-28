import type { PlayerSnapshot, SnapshotMessage } from "../shared/protocol";
import {
  extrapolatePlayerSnapshot,
  interpolatePlayerSnapshot,
} from "./Interpolation";

export interface SnapshotSample {
  player: PlayerSnapshot;
  serverTime: number;
  interpolated: boolean;
  extrapolated: boolean;
}

interface BufferedFrame {
  seq: number;
  serverTime: number;
  players: Map<string, PlayerSnapshot>;
}

/**
 * Time-offset snapshot buffer. Rendering behind the newest server frame gives
 * interpolation room to absorb ordinary network jitter.
 */
export class SnapshotBuffer {
  private readonly frames: BufferedFrame[] = [];
  private serverOffsetMs: number | null = null;

  public constructor(
    public interpolationDelayMs = 100,
    private readonly maximumFrames = 48,
  ) {}

  public get size(): number {
    return this.frames.length;
  }

  public get estimatedServerOffset(): number {
    return this.serverOffsetMs ?? 0;
  }

  public push(message: SnapshotMessage, receivedAt = performance.now()): boolean {
    const newest = this.frames[this.frames.length - 1];
    if (newest && message.seq <= newest.seq) return false;
    const measuredOffset = message.serverTime - receivedAt;
    this.serverOffsetMs =
      this.serverOffsetMs === null
        ? measuredOffset
        : this.serverOffsetMs * 0.92 + measuredOffset * 0.08;
    this.frames.push({
      seq: message.seq,
      serverTime: message.serverTime,
      players: new Map(message.players.map((player) => [player.id, player])),
    });
    if (this.frames.length > this.maximumFrames) {
      this.frames.splice(0, this.frames.length - this.maximumFrames);
    }
    return true;
  }

  public samplePlayer(
    playerId: string,
    clientTime = performance.now(),
  ): SnapshotSample | null {
    if (this.frames.length === 0) return null;
    const target = clientTime + (this.serverOffsetMs ?? 0) - this.interpolationDelayMs;
    let before: { frame: BufferedFrame; player: PlayerSnapshot } | undefined;
    let after: { frame: BufferedFrame; player: PlayerSnapshot } | undefined;

    for (const frame of this.frames) {
      const player = frame.players.get(playerId);
      if (!player) continue;
      if (frame.serverTime <= target) before = { frame, player };
      if (frame.serverTime >= target) {
        after = { frame, player };
        break;
      }
    }

    if (before && after) {
      if (before.frame === after.frame) {
        return {
          player: before.player,
          serverTime: before.frame.serverTime,
          interpolated: false,
          extrapolated: false,
        };
      }
      const span = after.frame.serverTime - before.frame.serverTime;
      const alpha = span <= 0 ? 1 : (target - before.frame.serverTime) / span;
      return {
        player: interpolatePlayerSnapshot(before.player, after.player, alpha),
        serverTime: target,
        interpolated: true,
        extrapolated: false,
      };
    }

    if (before) {
      const elapsed = Math.max(0, target - before.frame.serverTime);
      return {
        player: extrapolatePlayerSnapshot(before.player, elapsed),
        serverTime: target,
        interpolated: false,
        extrapolated: elapsed > 0,
      };
    }

    if (after) {
      return {
        player: after.player,
        serverTime: after.frame.serverTime,
        interpolated: false,
        extrapolated: false,
      };
    }
    return null;
  }

  public sampleAll(
    clientTime = performance.now(),
    excludingPlayerId?: string,
  ): Map<string, SnapshotSample> {
    const ids = new Set<string>();
    const newest = this.frames[this.frames.length - 1];
    for (const id of newest?.players.keys() ?? []) {
      if (id !== excludingPlayerId) ids.add(id);
    }
    const samples = new Map<string, SnapshotSample>();
    for (const id of ids) {
      const sample = this.samplePlayer(id, clientTime);
      if (sample) samples.set(id, sample);
    }
    return samples;
  }

  public latest(playerId: string): PlayerSnapshot | null {
    for (let index = this.frames.length - 1; index >= 0; index -= 1) {
      const frame = this.frames[index];
      const player = frame?.players.get(playerId);
      if (player) return player;
    }
    return null;
  }

  public clear(): void {
    this.frames.length = 0;
    this.serverOffsetMs = null;
  }
}
