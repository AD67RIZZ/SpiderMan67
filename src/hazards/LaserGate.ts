import * as THREE from 'three';
import type { HazardActor, HazardContact } from './types';

export type LaserGateState = 'safe' | 'warning' | 'active';

export interface LaserGateOptions {
  id: string;
  position: THREE.Vector3;
  width?: number;
  height?: number;
  safeOffset?: number;
  phase?: number;
  safeSeconds?: number;
  warningSeconds?: number;
  activeSeconds?: number;
}

export class LaserGate implements HazardActor {
  readonly kind = 'laser' as const;
  readonly id: string;
  readonly group = new THREE.Group();
  state: LaserGateState = 'safe';

  private readonly width: number;
  private readonly height: number;
  private readonly safeOffset: number;
  private readonly openingWidth = 4.2;
  private readonly phase: number;
  private readonly safeSeconds: number;
  private readonly warningSeconds: number;
  private readonly activeSeconds: number;
  private readonly postGeometry: THREE.BufferGeometry;
  private readonly beamGeometry = new THREE.BoxGeometry(1, 0.12, 0.12);
  private readonly postMaterial: THREE.MeshStandardMaterial;
  private readonly beamMaterial: THREE.MeshBasicMaterial;
  private readonly beams: THREE.Mesh[] = [];
  private disposed = false;

  constructor(scene: THREE.Scene, options: LaserGateOptions) {
    this.id = options.id;
    this.width = options.width ?? 20;
    this.height = options.height ?? 5;
    this.safeOffset = THREE.MathUtils.clamp(options.safeOffset ?? 0, -this.width * 0.3, this.width * 0.3);
    this.phase = options.phase ?? 0;
    this.safeSeconds = options.safeSeconds ?? 2.4;
    this.warningSeconds = options.warningSeconds ?? 1.35;
    this.activeSeconds = options.activeSeconds ?? 1.9;
    this.group.name = this.id;
    this.group.position.copy(options.position);

    this.postGeometry = new THREE.BoxGeometry(0.36, this.height + 1, 0.42);
    this.postMaterial = new THREE.MeshStandardMaterial({
      color: 0x191c31,
      emissive: 0xff5c27,
      emissiveIntensity: 0.38,
      roughness: 0.55,
      metalness: 0.65,
    });
    this.beamMaterial = new THREE.MeshBasicMaterial({
      color: 0xff542e,
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const leftPost = new THREE.Mesh(this.postGeometry, this.postMaterial);
    const rightPost = new THREE.Mesh(this.postGeometry, this.postMaterial);
    leftPost.position.set(-this.width / 2, this.height / 2, 0);
    rightPost.position.set(this.width / 2, this.height / 2, 0);
    this.group.add(leftPost, rightPost);

    const leftEnd = this.safeOffset - this.openingWidth / 2;
    const rightStart = this.safeOffset + this.openingWidth / 2;
    for (const y of [1, 2.4, 3.8]) {
      this.addBeam(-this.width / 2, leftEnd, y);
      this.addBeam(rightStart, this.width / 2, y);
    }
    scene.add(this.group);
  }

  get active(): boolean {
    return this.state === 'active';
  }

  private addBeam(fromX: number, toX: number, y: number): void {
    const length = Math.max(0.1, toX - fromX);
    const beam = new THREE.Mesh(this.beamGeometry, this.beamMaterial);
    beam.position.set((fromX + toX) / 2, y, 0);
    beam.scale.x = length;
    this.beams.push(beam);
    this.group.add(beam);
  }

  update(_dt: number, elapsed: number): void {
    const safe = this.safeSeconds;
    const warning = this.warningSeconds;
    const active = this.activeSeconds;
    const cycle = safe + warning + active;
    const time = ((elapsed + this.phase) % cycle + cycle) % cycle;
    this.state = time < safe ? 'safe' : time < safe + warning ? 'warning' : 'active';
    const pulse = 0.55 + Math.sin(elapsed * (this.active ? 18 : 7)) * 0.25;
    this.beamMaterial.opacity = this.state === 'safe' ? 0.04 : this.state === 'warning' ? 0.22 + pulse * 0.25 : 0.85;
    this.beamMaterial.color.setHex(this.state === 'warning' ? 0xffc126 : 0xff4729);
    this.postMaterial.emissiveIntensity = this.state === 'safe' ? 0.2 : this.state === 'warning' ? 1.2 : 2.1;
    for (const beam of this.beams) {
      beam.scale.y = this.state === 'warning' ? 1 + pulse * 2.1 : this.active ? 2.1 : 0.3;
      beam.visible = this.state !== 'safe';
    }
  }

  hitTest(position: THREE.Vector3, radius = 0.65): HazardContact | null {
    if (!this.active) {
      return null;
    }
    const localX = position.x - this.group.position.x;
    const localY = position.y - this.group.position.y;
    const localZ = position.z - this.group.position.z;
    const inOpening = Math.abs(localX - this.safeOffset) <= this.openingWidth / 2 - radius * 0.45;
    const inGate =
      Math.abs(localX) <= this.width / 2 + radius &&
      localY >= 0.2 - radius &&
      localY <= this.height + radius &&
      Math.abs(localZ) <= 0.45 + radius;
    if (!inGate || inOpening) {
      return null;
    }
    const side = localX >= this.safeOffset ? 1 : -1;
    return {
      id: this.id,
      kind: this.kind,
      impulse: new THREE.Vector3(side * 4, 2.2, -5),
      stunSeconds: 0.32,
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.group.removeFromParent();
    this.postGeometry.dispose();
    this.beamGeometry.dispose();
    this.postMaterial.dispose();
    this.beamMaterial.dispose();
    this.beams.length = 0;
  }
}
