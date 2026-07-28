import type { ScoreBreakdown } from "./protocol";

export interface ScoreSource {
  motion: { distance: number };
  checkpointIndex: number;
  shardsCollected: number;
  dronesDestroyed: number;
  stylePoints: number;
  placementBonus: number;
  crashes: number;
}

export function scoreBreakdown(player: ScoreSource): ScoreBreakdown {
  const distance = Math.max(0, Math.floor(player.motion.distance * 2));
  // Checkpoint zero is the starting gate, so it does not award race progress.
  const checkpoints = Math.max(0, player.checkpointIndex * 1_000);
  const shards = Math.max(0, player.shardsCollected * 100);
  const drones = Math.max(0, player.dronesDestroyed * 300);
  const style = Math.max(0, Math.floor(player.stylePoints));
  const placement = Math.max(0, Math.floor(player.placementBonus));
  const crashPenalty = Math.max(0, player.crashes * 200);
  const total = Math.max(
    0,
    distance +
      checkpoints +
      shards +
      drones +
      style +
      placement -
      crashPenalty,
  );

  return {
    distance,
    checkpoints,
    shards,
    drones,
    style,
    placement,
    crashPenalty,
    total,
  };
}
