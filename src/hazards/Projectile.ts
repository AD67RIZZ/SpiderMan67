import * as THREE from 'three';
import type { HazardActor, HazardContact } from './types';

export interface ProjectileLaunch {
  origin: THREE.Vector3;
  target: THREE.Vector3;
  speed?: number;
  telegraphSeconds?: number;
  maximumLife?: number;
}

export class Projectile implements HazardActor {
  readonly kind = 'projectile' as const;
  readonly id: string;
  readonly group = new THREE.Group();

  private readonly velocity = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly geometry = new THREE.IcosahedronGeometry(0.28, 0);
  private readonly material = new THREE.MeshBasicMaterial({
    color: 0xffa52f,
    transparent: true,
    opacity: 0.9,
    toneMapped: false,
  });
  private readonly trailGeometry = new THREE.BufferGeometry();
  private readonly trailMaterial = new THREE.LineBasicMaterial({
    color: 0xff6e31,
    transparent: true,
    opacity: 0.62,
    toneMapped: false,
  });
  private readonly trailPositions = new Float32Array(18);
  private readonly projectile: THREE.Mesh;
  private readonly trail: THREE.Line;
  private telegraphRemaining = 0;
  private lifeRemaining = 0;
  private disposed = false;
  private enabled = false;

  constructor(scene: THREE.Scene, id: string) {
    this.id = id;
    this.group.name = id;
    this.projectile = new THREE.Mesh(this.geometry, this.material);
    this.trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trail = new THREE.Line(this.trailGeometry, this.trailMaterial);
    this.group.add(this.projectile, this.trail);
    this.group.visible = false;
    scene.add(this.group);
  }

  get active(): boolean {
    return this.enabled;
  }

  launch(options: ProjectileLaunch): void {
    this.enabled = true;
    this.group.visible = true;
    this.group.position.copy(options.origin);
    this.direction.copy(options.target).sub(options.origin);
    if (this.direction.lengthSq() < 0.01) {
      this.direction.set(0, 0, -1);
    }
    this.direction.normalize();
    this.velocity.copy(this.direction).multiplyScalar(options.speed ?? 8.5);
    this.telegraphRemaining = Math.max(0.25, options.telegraphSeconds ?? 0.65);
    this.lifeRemaining = Math.max(1, options.maximumLife ?? 5);
    this.material.opacity = 0.35;
    this.resetTrail();
  }

  deactivate(): void {
    this.enabled = false;
    this.group.visible = false;
    this.lifeRemaining = 0;
  }

  update(dt: number, elapsed: number): void {
    if (!this.enabled) {
      return;
    }
    if (this.telegraphRemaining > 0) {
      this.telegraphRemaining = Math.max(0, this.telegraphRemaining - dt);
      this.group.scale.setScalar(0.75 + Math.sin(elapsed * 20) * 0.22);
      this.material.color.setHex(0xffdd55);
      this.material.opacity = 0.4 + Math.sin(elapsed * 17) * 0.22;
      return;
    }
    this.lifeRemaining -= dt;
    if (this.lifeRemaining <= 0) {
      this.deactivate();
      return;
    }
    this.material.color.setHex(0xff7135);
    this.material.opacity = 0.92;
    this.group.scale.setScalar(1);
    this.group.position.addScaledVector(this.velocity, dt);
    this.projectile.rotation.x += dt * 8;
    this.projectile.rotation.y += dt * 11;
    this.shiftTrail();
  }

  private resetTrail(): void {
    for (let index = 0; index < this.trailPositions.length; index += 3) {
      const point = index / 3;
      this.trailPositions[index] = -this.direction.x * point * 0.32;
      this.trailPositions[index + 1] = -this.direction.y * point * 0.32;
      this.trailPositions[index + 2] = -this.direction.z * point * 0.32;
    }
    this.trailGeometry.getAttribute('position').needsUpdate = true;
  }

  private shiftTrail(): void {
    const pulse = 0.9 + Math.sin(this.lifeRemaining * 15) * 0.08;
    for (let index = 0; index < this.trailPositions.length; index += 3) {
      const point = (index / 3) * 0.32 * pulse;
      this.trailPositions[index] = -this.direction.x * point;
      this.trailPositions[index + 1] = -this.direction.y * point;
      this.trailPositions[index + 2] = -this.direction.z * point;
    }
    this.trailGeometry.getAttribute('position').needsUpdate = true;
  }

  hitTest(position: THREE.Vector3, radius = 0.65): HazardContact | null {
    if (!this.enabled || this.telegraphRemaining > 0) {
      return null;
    }
    if (this.group.position.distanceToSquared(position) > (radius + 0.35) ** 2) {
      return null;
    }
    const impulse = this.direction.clone().multiplyScalar(4.5).add(new THREE.Vector3(0, 1.5, 0));
    this.deactivate();
    return {
      id: this.id,
      kind: this.kind,
      impulse,
      slowSeconds: 0.8,
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.group.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.trailGeometry.dispose();
    this.trailMaterial.dispose();
  }
}
