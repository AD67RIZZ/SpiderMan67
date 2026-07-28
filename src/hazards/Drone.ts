import * as THREE from 'three';
import type { HazardActor, HazardContact } from './types';

export interface DroneOptions {
  id: string;
  position: THREE.Vector3;
  patrolRadius?: number;
  phase?: number;
  respawnSeconds?: number;
  projectileEnabled?: boolean;
}

export type DroneInteraction = 'destroyed' | 'hit' | null;

export class Drone implements HazardActor {
  readonly kind = 'drone' as const;
  readonly id: string;
  readonly group = new THREE.Group();

  private readonly basePosition: THREE.Vector3;
  private readonly patrolRadius: number;
  private readonly phase: number;
  private readonly respawnSeconds: number;
  private readonly projectileEnabled: boolean;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly warningMaterial: THREE.MeshBasicMaterial;
  private destroyedTimer = 0;
  private lastShotAt = -Infinity;
  private disposed = false;

  constructor(scene: THREE.Scene, options: DroneOptions) {
    this.id = options.id;
    this.basePosition = options.position.clone();
    this.patrolRadius = options.patrolRadius ?? 4;
    this.phase = options.phase ?? 0;
    this.respawnSeconds = options.respawnSeconds ?? 11;
    this.projectileEnabled = options.projectileEnabled ?? true;
    this.group.name = options.id;
    this.group.position.copy(this.basePosition);

    const shellGeometry = new THREE.OctahedronGeometry(0.72, 0);
    const wingGeometry = new THREE.BoxGeometry(1.35, 0.11, 0.38);
    const eyeGeometry = new THREE.SphereGeometry(0.2, 8, 6);
    this.geometries.push(shellGeometry, wingGeometry, eyeGeometry);
    const shellMaterial = new THREE.MeshStandardMaterial({
      color: 0x161a2c,
      emissive: 0x5e2cff,
      emissiveIntensity: 0.55,
      roughness: 0.36,
      metalness: 0.78,
    });
    const wingMaterial = new THREE.MeshStandardMaterial({
      color: 0x2b3150,
      emissive: 0x7f48ff,
      emissiveIntensity: 0.3,
      roughness: 0.42,
      metalness: 0.72,
    });
    this.warningMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc928,
      toneMapped: false,
    });
    this.materials.push(shellMaterial, wingMaterial, this.warningMaterial);

    const shell = new THREE.Mesh(shellGeometry, shellMaterial);
    const leftWing = new THREE.Mesh(wingGeometry, wingMaterial);
    const rightWing = new THREE.Mesh(wingGeometry, wingMaterial);
    const warning = new THREE.Mesh(eyeGeometry, this.warningMaterial);
    leftWing.position.x = -0.9;
    rightWing.position.x = 0.9;
    warning.position.set(0, 0, 0.67);
    warning.name = 'warning-light';
    this.group.add(shell, leftWing, rightWing, warning);
    scene.add(this.group);
  }

  get active(): boolean {
    return this.destroyedTimer <= 0;
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  update(dt: number, elapsed: number): void {
    if (this.destroyedTimer > 0) {
      this.destroyedTimer = Math.max(0, this.destroyedTimer - dt);
      this.group.visible = false;
      if (this.destroyedTimer <= 0) {
        this.group.visible = true;
      }
      return;
    }
    const wave = elapsed * 0.88 + this.phase;
    this.group.position.set(
      this.basePosition.x + Math.sin(wave) * this.patrolRadius,
      this.basePosition.y + Math.sin(wave * 1.7) * 0.65,
      this.basePosition.z + Math.cos(wave * 0.55) * 1.2,
    );
    this.group.rotation.y = Math.sin(wave) * 0.32;
    this.group.rotation.z = Math.cos(wave * 1.4) * 0.09;
    const urgency = 0.72 + Math.sin(elapsed * 8 + this.phase) * 0.28;
    this.warningMaterial.color.setRGB(1, 0.22 + urgency * 0.5, 0.05);
    const warning = this.group.getObjectByName('warning-light');
    warning?.scale.setScalar(0.85 + urgency * 0.4);
  }

  interact(position: THREE.Vector3, isDashing: boolean, radius = 0.65): DroneInteraction {
    if (!this.active || this.group.position.distanceToSquared(position) > (1.15 + radius) ** 2) {
      return null;
    }
    if (isDashing) {
      this.destroyedTimer = this.respawnSeconds;
      this.group.visible = false;
      return 'destroyed';
    }
    return 'hit';
  }

  hitTest(position: THREE.Vector3, radius = 0.65): HazardContact | null {
    if (this.interact(position, false, radius) !== 'hit') {
      return null;
    }
    const impulse = position.clone().sub(this.group.position).setY(0.35);
    if (impulse.lengthSq() < 0.01) {
      impulse.set(1, 0.35, -0.4);
    }
    impulse.normalize().multiplyScalar(6);
    return { id: this.id, kind: this.kind, impulse, slowSeconds: 1.1 };
  }

  canFire(elapsed: number, target: THREE.Vector3): boolean {
    if (!this.projectileEnabled || !this.active || elapsed - this.lastShotAt < 4.5) {
      return false;
    }
    const distance = this.group.position.distanceTo(target);
    return distance >= 8 && distance <= 34 && target.z <= this.group.position.z + 10;
  }

  markFired(elapsed: number): void {
    this.lastShotAt = elapsed;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.group.removeFromParent();
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
  }
}
