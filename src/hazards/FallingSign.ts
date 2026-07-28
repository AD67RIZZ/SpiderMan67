import * as THREE from 'three';
import type { HazardActor, HazardContact } from './types';

export type FallingSignState = 'hanging' | 'warning' | 'falling' | 'down' | 'resetting';

export interface FallingSignOptions {
  id: string;
  position: THREE.Vector3;
  phase?: number;
  cycleSeconds?: number;
}

export class FallingSign implements HazardActor {
  readonly kind = 'sign' as const;
  readonly id: string;
  readonly group = new THREE.Group();
  state: FallingSignState = 'hanging';

  private readonly basePosition: THREE.Vector3;
  private readonly phase: number;
  private readonly cycleSeconds: number;
  private readonly signGeometry = new THREE.BoxGeometry(6, 2.5, 0.35);
  private readonly bracketGeometry = new THREE.CylinderGeometry(0.08, 0.08, 3, 6);
  private readonly signMaterial: THREE.MeshStandardMaterial;
  private readonly warningMaterial: THREE.MeshBasicMaterial;
  private readonly sign: THREE.Mesh;
  private readonly bounds = new THREE.Box3();
  private disposed = false;

  constructor(scene: THREE.Scene, options: FallingSignOptions) {
    this.id = options.id;
    this.basePosition = options.position.clone();
    this.phase = options.phase ?? 0;
    this.cycleSeconds = Math.max(7, options.cycleSeconds ?? 10);
    this.group.name = options.id;
    this.group.position.copy(options.position);

    this.signMaterial = new THREE.MeshStandardMaterial({
      color: 0x14162a,
      emissive: 0xff3fd1,
      emissiveIntensity: 0.75,
      roughness: 0.48,
      metalness: 0.55,
    });
    this.warningMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc728,
      transparent: true,
      opacity: 0,
      toneMapped: false,
    });
    this.sign = new THREE.Mesh(this.signGeometry, this.signMaterial);
    this.sign.name = 'falling-panel';
    const bracketLeft = new THREE.Mesh(this.bracketGeometry, this.signMaterial);
    const bracketRight = new THREE.Mesh(this.bracketGeometry, this.signMaterial);
    bracketLeft.position.set(-2.4, 2.5, 0);
    bracketRight.position.set(2.4, 2.5, 0);
    const warning = new THREE.Mesh(new THREE.CircleGeometry(0.5, 3), this.warningMaterial);
    warning.name = 'warning-symbol';
    warning.position.set(0, 0, 0.2);
    warning.rotation.z = Math.PI;
    this.group.add(this.sign, bracketLeft, bracketRight, warning);
    scene.add(this.group);
  }

  get active(): boolean {
    return this.state === 'falling' || this.state === 'down';
  }

  update(_dt: number, elapsed: number): void {
    const time = ((elapsed + this.phase) % this.cycleSeconds + this.cycleSeconds) % this.cycleSeconds;
    const warningStart = this.cycleSeconds - 5.7;
    const fallStart = this.cycleSeconds - 4.1;
    const downStart = this.cycleSeconds - 3.25;
    const resetStart = this.cycleSeconds - 0.65;
    this.state =
      time < warningStart
        ? 'hanging'
        : time < fallStart
          ? 'warning'
          : time < downStart
            ? 'falling'
            : time < resetStart
              ? 'down'
              : 'resetting';

    if (this.state === 'hanging') {
      this.group.position.copy(this.basePosition);
      this.group.rotation.x = 0;
    } else if (this.state === 'warning') {
      const warningT = (time - warningStart) / Math.max(0.01, fallStart - warningStart);
      this.group.position.copy(this.basePosition);
      this.group.position.x += Math.sin(elapsed * 42) * 0.08 * warningT;
      this.group.rotation.z = Math.sin(elapsed * 35) * 0.025 * warningT;
    } else if (this.state === 'falling') {
      const fallT = THREE.MathUtils.smoothstep(
        (time - fallStart) / Math.max(0.01, downStart - fallStart),
        0,
        1,
      );
      this.group.position.copy(this.basePosition);
      this.group.position.y -= fallT * 5.4;
      this.group.rotation.x = fallT * Math.PI * 0.47;
    } else if (this.state === 'down') {
      this.group.position.copy(this.basePosition).add(new THREE.Vector3(0, -5.4, 0));
      this.group.rotation.x = Math.PI * 0.47;
    } else {
      const resetT = (time - resetStart) / Math.max(0.01, this.cycleSeconds - resetStart);
      this.group.position.copy(this.basePosition).add(new THREE.Vector3(0, -5.4 * (1 - resetT), 0));
      this.group.rotation.x = Math.PI * 0.47 * (1 - resetT);
    }

    this.warningMaterial.opacity =
      this.state === 'warning' ? 0.45 + Math.sin(elapsed * 15) * 0.45 : this.state === 'falling' ? 0.9 : 0;
    this.signMaterial.emissiveIntensity = this.state === 'warning' ? 1.8 : 0.72;
  }

  hitTest(position: THREE.Vector3, radius = 0.65): HazardContact | null {
    if (!this.active) {
      return null;
    }
    this.bounds.setFromObject(this.sign).expandByScalar(radius);
    if (!this.bounds.containsPoint(position)) {
      return null;
    }
    return {
      id: this.id,
      kind: this.kind,
      impulse: new THREE.Vector3(position.x >= this.group.position.x ? 5 : -5, 1.6, -3.2),
      stunSeconds: 0.45,
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.group.removeFromParent();
    this.signGeometry.dispose();
    this.bracketGeometry.dispose();
    const warning = this.group.getObjectByName('warning-symbol');
    if (warning instanceof THREE.Mesh) {
      warning.geometry.dispose();
    }
    this.signMaterial.dispose();
    this.warningMaterial.dispose();
  }
}
