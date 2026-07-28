export type ComboAction =
  | 'grapple'
  | 'clean-release'
  | 'air-shard'
  | 'drone'
  | 'near-miss'
  | 'wall-run'
  | 'rail'
  | 'dash'
  | 'risky-route'
  | 'checkpoint';

export interface ComboSnapshot {
  chain: number;
  meter: number;
  multiplier: number;
  maxMultiplier: number;
  lastAction: ComboAction | null;
}

const WEIGHTS: Readonly<Record<ComboAction, number>> = {
  grapple: 12,
  'clean-release': 24,
  'air-shard': 9,
  drone: 32,
  'near-miss': 26,
  'wall-run': 18,
  rail: 16,
  dash: 10,
  'risky-route': 30,
  checkpoint: 8,
};

export class ComboSystem {
  chain = 0;
  meter = 0;
  multiplier = 1;
  maxMultiplier = 1;
  lastAction: ComboAction | null = null;

  private idleTime = 0;
  private groundedTime = 0;

  add(action: ComboAction, quality = 1): number {
    const clampedQuality = Math.max(0.25, Math.min(2, quality));
    const gain = WEIGHTS[action] * clampedQuality;
    this.chain += 1;
    this.meter = Math.min(500, this.meter + gain);
    this.multiplier = Math.min(8, 1 + Math.floor(this.meter / 65));
    this.maxMultiplier = Math.max(this.maxMultiplier, this.multiplier);
    this.lastAction = action;
    this.idleTime = 0;
    return this.multiplier;
  }

  update(dt: number, speed: number, grounded: boolean): void {
    const safeDt = Math.max(0, Math.min(0.1, dt));
    this.idleTime += safeDt;
    this.groundedTime = grounded ? this.groundedTime + safeDt : 0;
    const slowPenalty = speed < 7 ? (7 - speed) * 2.2 : 0;
    const groundPenalty = this.groundedTime > 2.2 ? 6 : 0;
    const idlePenalty = this.idleTime > 1.1 ? 7 + (this.idleTime - 1.1) * 3 : 0;
    this.meter = Math.max(0, this.meter - (slowPenalty + groundPenalty + idlePenalty) * safeDt);
    this.multiplier = Math.min(8, 1 + Math.floor(this.meter / 65));
    if (this.meter <= 0) {
      this.chain = 0;
      this.lastAction = null;
    }
  }

  reset(): void {
    this.chain = 0;
    this.meter = 0;
    this.multiplier = 1;
    this.lastAction = null;
    this.idleTime = 0;
    this.groundedTime = 0;
  }

  snapshot(): ComboSnapshot {
    return {
      chain: this.chain,
      meter: this.meter,
      multiplier: this.multiplier,
      maxMultiplier: this.maxMultiplier,
      lastAction: this.lastAction,
    };
  }
}
