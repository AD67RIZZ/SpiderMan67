import type * as CANNON from 'cannon-es';
import * as THREE from 'three';

export interface DashOptions {
  speed?: number;
  duration?: number;
  cooldown?: number;
}

export class DashController {
  available = true;
  isDashing = false;

  private readonly speed: number;
  private readonly duration: number;
  private readonly cooldown: number;
  private dashRemaining = 0;
  private cooldownRemaining = 0;

  constructor(options: DashOptions = {}) {
    this.speed = options.speed ?? 25;
    this.duration = options.duration ?? 0.24;
    this.cooldown = options.cooldown ?? 0.25;
  }

  tryDash(body: CANNON.Body, direction: THREE.Vector3, speedMultiplier = 1): boolean {
    if (!this.available || this.cooldownRemaining > 0) {
      return false;
    }
    const dashDirection = direction.clone();
    if (dashDirection.lengthSq() < 0.01) {
      dashDirection.set(0, 0, 1);
    }
    dashDirection.normalize();
    const existingForward = Math.max(0, body.velocity.z * 0.2);
    const speed = Math.min(31 * speedMultiplier, this.speed * speedMultiplier + existingForward);
    body.velocity.set(dashDirection.x * speed, Math.max(1.2, dashDirection.y * speed), dashDirection.z * speed);
    this.available = false;
    this.isDashing = true;
    this.dashRemaining = this.duration;
    this.cooldownRemaining = this.cooldown;
    return true;
  }

  update(dt: number): void {
    this.dashRemaining = Math.max(0, this.dashRemaining - dt);
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
    this.isDashing = this.dashRemaining > 0;
  }

  resetOnGround(): void {
    if (!this.isDashing) {
      this.available = true;
    }
  }

  reset(): void {
    this.available = true;
    this.isDashing = false;
    this.dashRemaining = 0;
    this.cooldownRemaining = 0;
  }
}
