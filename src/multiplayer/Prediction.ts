import type {
  PlayerControls,
  PlayerMotionState,
  Vec3,
} from "../shared/protocol";
import { clamp, damp } from "../utils/MathUtils";

export interface PredictedInput {
  sequence: number;
  controls: PlayerControls;
  state: PlayerMotionState;
  clientTime: number;
}

export interface ReconciliationResult {
  distance: number;
  snapped: boolean;
  correction: Vec3;
}

/**
 * Tracks local predicted states and turns authoritative errors into gradual
 * position corrections. Large desyncs snap only when smoothing would be worse.
 */
export class Prediction {
  private readonly history: PredictedInput[] = [];
  private correction: Vec3 = { x: 0, y: 0, z: 0 };

  public constructor(
    private readonly snapDistance = 8,
    private readonly historyLimit = 120,
  ) {}

  public record(
    sequence: number,
    controls: PlayerControls,
    predictedState: PlayerMotionState,
    clientTime = performance.now(),
  ): void {
    this.history.push({
      sequence,
      controls: { ...controls },
      state: cloneMotion(predictedState),
      clientTime,
    });
    if (this.history.length > this.historyLimit) {
      this.history.splice(0, this.history.length - this.historyLimit);
    }
  }

  public reconcile(
    authoritative: PlayerMotionState,
    currentPredicted: PlayerMotionState,
    acknowledgedSequence?: number,
  ): ReconciliationResult {
    if (acknowledgedSequence !== undefined) {
      while (
        this.history[0] &&
        this.history[0].sequence <= acknowledgedSequence
      ) {
        this.history.shift();
      }
    }
    const dx = authoritative.position.x - currentPredicted.position.x;
    const dy = authoritative.position.y - currentPredicted.position.y;
    const dz = authoritative.position.z - currentPredicted.position.z;
    const distance = Math.hypot(dx, dy, dz);
    const snapped = distance >= this.snapDistance;
    this.correction = { x: dx, y: dy, z: dz };
    return {
      distance,
      snapped,
      correction: { ...this.correction },
    };
  }

  /**
   * Apply pending correction to a predicted state. A major correction is
   * consumed in one call; small errors fade in over several rendered frames.
   */
  public applyCorrection(
    state: PlayerMotionState,
    deltaSeconds: number,
    forceSnap = false,
  ): PlayerMotionState {
    const magnitude = Math.hypot(this.correction.x, this.correction.y, this.correction.z);
    if (magnitude < 0.001) return state;
    const fraction = forceSnap || magnitude >= this.snapDistance
      ? 1
      : 1 - Math.exp(-10 * clamp(deltaSeconds, 0, 0.1));
    const applied = {
      x: this.correction.x * fraction,
      y: this.correction.y * fraction,
      z: this.correction.z * fraction,
    };
    this.correction.x -= applied.x;
    this.correction.y -= applied.y;
    this.correction.z -= applied.z;
    return {
      ...state,
      position: {
        x: state.position.x + applied.x,
        y: state.position.y + applied.y,
        z: state.position.z + applied.z,
      },
    };
  }

  public smoothVelocity(
    current: Vec3,
    authoritative: Vec3,
    deltaSeconds: number,
  ): Vec3 {
    return {
      x: damp(current.x, authoritative.x, 6, deltaSeconds),
      y: damp(current.y, authoritative.y, 6, deltaSeconds),
      z: damp(current.z, authoritative.z, 6, deltaSeconds),
    };
  }

  public get pendingInputs(): readonly PredictedInput[] {
    return this.history;
  }

  public clear(): void {
    this.history.length = 0;
    this.correction = { x: 0, y: 0, z: 0 };
  }
}

function cloneMotion(state: PlayerMotionState): PlayerMotionState {
  return {
    ...state,
    position: { ...state.position },
    velocity: { ...state.velocity },
  };
}
