import * as THREE from 'three';
import type { HazardActor, HazardContact } from './types';

export type ElectricPanelState = 'safe' | 'warning' | 'active';

export interface ElectricPanelOptions {
  id: string;
  position: THREE.Vector3;
  width?: number;
  depth?: number;
  phase?: number;
}

export class ElectricPanel implements HazardActor {
  readonly kind = 'electric' as const;
  readonly id: string;
  readonly group = new THREE.Group();
  state: ElectricPanelState = 'safe';

  private readonly width: number;
  private readonly depth: number;
  private readonly phase: number;
  private readonly baseY: number;
  private readonly geometry: THREE.BufferGeometry;
  private readonly panelMaterial: THREE.MeshStandardMaterial;
  private readonly warningMaterial: THREE.MeshBasicMaterial;
  private readonly warningLines: THREE.LineSegments;
  private disposed = false;

  constructor(scene: THREE.Scene, options: ElectricPanelOptions) {
    this.id = options.id;
    this.width = options.width ?? 5;
    this.depth = options.depth ?? 7;
    this.phase = options.phase ?? 0;
    this.baseY = options.position.y;
    this.group.name = options.id;
    this.group.position.copy(options.position);
    this.geometry = new THREE.BoxGeometry(this.width, 0.16, this.depth);
    this.panelMaterial = new THREE.MeshStandardMaterial({
      color: 0x131c2e,
      emissive: 0x2c88ff,
      emissiveIntensity: 0.25,
      roughness: 0.62,
      metalness: 0.5,
    });
    this.warningMaterial = new THREE.MeshBasicMaterial({
      color: 0x8eefff,
      transparent: true,
      opacity: 0.2,
      toneMapped: false,
    });
    const panel = new THREE.Mesh(this.geometry, this.panelMaterial);
    const edges = new THREE.EdgesGeometry(this.geometry);
    this.warningLines = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0xeefcff, transparent: true, opacity: 0.2, toneMapped: false }),
    );
    this.group.add(panel, this.warningLines);
    scene.add(this.group);
  }

  get active(): boolean {
    return this.state === 'active';
  }

  update(_dt: number, elapsed: number): void {
    const cycle = 5.6;
    const time = ((elapsed + this.phase) % cycle + cycle) % cycle;
    this.state = time < 2.7 ? 'safe' : time < 3.9 ? 'warning' : 'active';
    const pulse = 0.5 + Math.sin(elapsed * (this.active ? 24 : 11)) * 0.5;
    this.panelMaterial.emissiveIntensity = this.state === 'safe' ? 0.22 : this.state === 'warning' ? 0.5 + pulse : 1.8 + pulse;
    this.panelMaterial.emissive.setHex(this.state === 'warning' ? 0xffcc32 : 0x32baff);
    this.warningMaterial.opacity = this.state === 'safe' ? 0.08 : 0.35 + pulse * 0.4;
    const lineMaterial = this.warningLines.material;
    if (lineMaterial instanceof THREE.LineBasicMaterial) {
      lineMaterial.color.setHex(this.state === 'warning' ? 0xffe65c : 0xe8fbff);
      lineMaterial.opacity = this.state === 'safe' ? 0.15 : 0.55 + pulse * 0.4;
    }
    this.group.position.y =
      this.baseY + Math.sin(elapsed * 18 + this.phase) * (this.active ? 0.018 : 0);
  }

  hitTest(position: THREE.Vector3, radius = 0.65): HazardContact | null {
    if (!this.active) {
      return null;
    }
    const local = position.clone().sub(this.group.position);
    if (
      Math.abs(local.x) > this.width / 2 + radius ||
      Math.abs(local.z) > this.depth / 2 + radius ||
      local.y < -0.3 ||
      local.y > 1.45 + radius
    ) {
      return null;
    }
    return {
      id: this.id,
      kind: this.kind,
      impulse: new THREE.Vector3(0, 2.2, -1.5),
      slowSeconds: 1.15,
      stunSeconds: 0.16,
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.group.removeFromParent();
    this.geometry.dispose();
    this.panelMaterial.dispose();
    this.warningMaterial.dispose();
    this.warningLines.geometry.dispose();
    const material = this.warningLines.material;
    if (Array.isArray(material)) {
      for (const entry of material) {
        entry.dispose();
      }
    } else {
      material.dispose();
    }
  }
}
