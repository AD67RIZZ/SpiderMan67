import type {
  PlayerMotionState,
  PlayerSnapshot,
  Vec3,
} from "../shared/protocol";
import { clamp, lerp, wrap } from "../utils/MathUtils";

export function interpolateVec3(from: Vec3, to: Vec3, alpha: number): Vec3 {
  const t = clamp(alpha, 0, 1);
  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    z: lerp(from.z, to.z, t),
  };
}

export function interpolateAngle(from: number, to: number, alpha: number): number {
  const difference = wrap(to - from + Math.PI, 0, Math.PI * 2) - Math.PI;
  return from + difference * clamp(alpha, 0, 1);
}

export function interpolateMotion(
  from: PlayerMotionState,
  to: PlayerMotionState,
  alpha: number,
): PlayerMotionState {
  const t = clamp(alpha, 0, 1);
  return {
    position: interpolateVec3(from.position, to.position, t),
    velocity: interpolateVec3(from.velocity, to.velocity, t),
    yaw: interpolateAngle(from.yaw, to.yaw, t),
    distance: lerp(from.distance, to.distance, t),
    grounded: t < 0.5 ? from.grounded : to.grounded,
    action: t < 0.5 ? from.action : to.action,
  };
}

export function interpolatePlayerSnapshot(
  from: PlayerSnapshot,
  to: PlayerSnapshot,
  alpha: number,
): PlayerSnapshot {
  const t = clamp(alpha, 0, 1);
  return {
    ...(t < 0.5 ? from : to),
    motion: interpolateMotion(from.motion, to.motion, t),
    score: lerp(from.score, to.score, t),
    combo: lerp(from.combo, to.combo, t),
  };
}

/** Short capped extrapolation for brief snapshot gaps. */
export function extrapolatePlayerSnapshot(
  snapshot: PlayerSnapshot,
  milliseconds: number,
  maximumMilliseconds = 120,
): PlayerSnapshot {
  const seconds = clamp(milliseconds, 0, maximumMilliseconds) / 1000;
  return {
    ...snapshot,
    motion: {
      ...snapshot.motion,
      position: {
        x: snapshot.motion.position.x + snapshot.motion.velocity.x * seconds,
        y: snapshot.motion.position.y + snapshot.motion.velocity.y * seconds,
        z: snapshot.motion.position.z + snapshot.motion.velocity.z * seconds,
      },
      distance:
        snapshot.motion.distance +
        Math.hypot(snapshot.motion.velocity.x, snapshot.motion.velocity.z) * seconds,
    },
  };
}
