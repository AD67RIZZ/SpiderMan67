import type { WorldEvent } from '../world/types';
import { ComboSystem, type ComboAction } from './ComboSystem';

export interface ScoreBreakdown {
  distance: number;
  checkpoints: number;
  shards: number;
  drones: number;
  style: number;
  finish: number;
  penalties: number;
}

export interface ScoreSnapshot {
  score: number;
  distance: number;
  shards: number;
  drones: number;
  checkpoints: number;
  crashes: number;
  finished: boolean;
  breakdown: ScoreBreakdown;
}

export class ScoreSystem {
  readonly combo: ComboSystem;
  readonly breakdown: ScoreBreakdown = {
    distance: 0,
    checkpoints: 0,
    shards: 0,
    drones: 0,
    style: 0,
    finish: 0,
    penalties: 0,
  };

  distance = 0;
  shards = 0;
  drones = 0;
  checkpoints = 0;
  crashes = 0;
  finished = false;

  private highWaterDistance = 0;
  private scoreScale = 1;

  constructor(combo = new ComboSystem()) {
    this.combo = combo;
  }

  update(dt: number, forwardDistance: number, speed: number, grounded: boolean): void {
    this.combo.update(dt, speed, grounded);
    const nextDistance = Math.max(0, forwardDistance);
    const gained = Math.max(0, nextDistance - this.highWaterDistance);
    if (gained > 0) {
      this.highWaterDistance = nextDistance;
      this.distance = Math.max(this.distance, nextDistance);
      this.breakdown.distance += gained * (1 + Math.max(0, speed - 14) * 0.018) * this.scoreScale;
    }
  }

  setPowerUpMultiplier(multiplier: number): void {
    this.scoreScale = Math.max(1, multiplier);
  }

  award(action: ComboAction, basePoints: number, quality = 1): number {
    const multiplier = this.combo.add(action, quality);
    const points = Math.round(basePoints * multiplier * this.scoreScale);
    this.breakdown.style += points;
    return points;
  }

  handleWorldEvent(event: WorldEvent): number {
    switch (event.type) {
      case 'checkpoint': {
        this.checkpoints = Math.max(this.checkpoints, event.checkpoint);
        const points = Math.round(250 * this.combo.multiplier * this.scoreScale);
        this.breakdown.checkpoints += points;
        this.combo.add('checkpoint');
        return points;
      }
      case 'shard': {
        this.shards += 1;
        const action: ComboAction = event.risky ? 'risky-route' : 'air-shard';
        const points = Math.round(event.points * this.combo.add(action) * this.scoreScale);
        this.breakdown.shards += points;
        return points;
      }
      case 'drone-destroyed': {
        this.drones += 1;
        const points = Math.round(event.points * this.combo.add('drone') * this.scoreScale);
        this.breakdown.drones += points;
        return points;
      }
      case 'hazard-hit': {
        this.crash(125);
        return -125;
      }
      case 'finish':
      case 'power-up':
        return 0;
    }
  }

  crash(penalty = 150): void {
    this.crashes += 1;
    this.breakdown.penalties += Math.max(0, penalty);
    this.combo.reset();
  }

  finish(place: number, finishTimeSeconds: number): number {
    if (this.finished) {
      return 0;
    }
    this.finished = true;
    const placementBonus = [0, 2500, 1700, 1200, 900, 700, 550, 450, 350][
      Math.max(1, Math.min(8, Math.floor(place)))
    ] ?? 350;
    const timeBonus = Math.max(0, Math.round(1800 - finishTimeSeconds * 5));
    const points = Math.round((placementBonus + timeBonus) * this.scoreScale);
    this.breakdown.finish += points;
    return points;
  }

  get score(): number {
    const raw =
      this.breakdown.distance +
      this.breakdown.checkpoints +
      this.breakdown.shards +
      this.breakdown.drones +
      this.breakdown.style +
      this.breakdown.finish -
      this.breakdown.penalties;
    return Math.max(0, Math.round(raw));
  }

  snapshot(): ScoreSnapshot {
    return {
      score: this.score,
      distance: this.distance,
      shards: this.shards,
      drones: this.drones,
      checkpoints: this.checkpoints,
      crashes: this.crashes,
      finished: this.finished,
      breakdown: { ...this.breakdown },
    };
  }

  reset(): void {
    for (const key of Object.keys(this.breakdown) as Array<keyof ScoreBreakdown>) {
      this.breakdown[key] = 0;
    }
    this.distance = 0;
    this.shards = 0;
    this.drones = 0;
    this.checkpoints = 0;
    this.crashes = 0;
    this.finished = false;
    this.highWaterDistance = 0;
    this.scoreScale = 1;
    this.combo.reset();
  }
}
