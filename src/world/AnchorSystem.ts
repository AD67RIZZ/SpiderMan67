import * as THREE from 'three';
import type { AnchorRecord, AnchorSpec } from './types';

const FORWARD = new THREE.Vector3(0, 0, 1);

export interface AnchorSelectionOptions {
  maxRange?: number;
  minimumForwardDot?: number;
  preferredDirection?: THREE.Vector3;
}

interface InternalAnchor extends AnchorRecord {
  coreMaterial: THREE.MeshBasicMaterial;
  ringMaterial: THREE.MeshBasicMaterial;
}

export class AnchorSystem {
  readonly group = new THREE.Group();
  readonly anchors: AnchorRecord[] = [];
  selected: AnchorRecord | null = null;

  private readonly internalAnchors: InternalAnchor[] = [];
  private readonly collidables: THREE.Object3D[];
  private readonly raycaster = new THREE.Raycaster();
  private readonly coreGeometry = new THREE.OctahedronGeometry(0.48, 0);
  private readonly ringGeometry = new THREE.TorusGeometry(0.85, 0.055, 8, 24);
  private readonly lineOfSightOrigin = new THREE.Vector3();
  private readonly toAnchor = new THREE.Vector3();
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    specs: readonly AnchorSpec[],
    collidables: readonly THREE.Object3D[],
  ) {
    this.collidables = [...collidables];
    this.group.name = 'grapple-anchors';
    scene.add(this.group);
    for (const spec of specs) {
      const anchorGroup = new THREE.Group();
      anchorGroup.name = spec.id;
      anchorGroup.position.fromArray(spec.position);

      const coreMaterial = new THREE.MeshBasicMaterial({
        color: 0x72f5ff,
        transparent: true,
        opacity: 0.9,
        toneMapped: false,
      });
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0x72f5ff,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      });
      const core = new THREE.Mesh(this.coreGeometry, coreMaterial);
      const ringA = new THREE.Mesh(this.ringGeometry, ringMaterial);
      const ringB = new THREE.Mesh(this.ringGeometry, ringMaterial);
      ringB.rotation.y = Math.PI / 2;
      anchorGroup.add(core, ringA, ringB);
      anchorGroup.userData.anchorId = spec.id;
      anchorGroup.visible = false;
      this.group.add(anchorGroup);

      const record: InternalAnchor = {
        id: spec.id,
        position: anchorGroup.position,
        mesh: anchorGroup,
        range: spec.range ?? 36,
        visible: false,
        selected: false,
        coreMaterial,
        ringMaterial,
      };
      this.internalAnchors.push(record);
      this.anchors.push(record);
    }
  }

  hasLineOfSight(origin: THREE.Vector3, anchor: AnchorRecord): boolean {
    this.lineOfSightOrigin.copy(origin).y += 0.35;
    this.toAnchor.copy(anchor.position).sub(this.lineOfSightOrigin);
    const distance = this.toAnchor.length();
    if (distance <= 0.001) {
      return true;
    }
    this.raycaster.set(this.lineOfSightOrigin, this.toAnchor.multiplyScalar(1 / distance));
    this.raycaster.near = 0.15;
    this.raycaster.far = Math.max(0.15, distance - 0.3);
    const hits = this.raycaster.intersectObjects(this.collidables, true);
    return hits.length === 0;
  }

  selectTarget(
    playerPosition: THREE.Vector3,
    velocity: THREE.Vector3,
    options: AnchorSelectionOptions = {},
  ): AnchorRecord | null {
    const direction = (options.preferredDirection ?? velocity).clone();
    direction.y *= 0.35;
    if (direction.lengthSq() < 0.1) {
      direction.copy(FORWARD);
    } else {
      direction.normalize();
    }
    const minimumForwardDot = options.minimumForwardDot ?? -0.15;
    const hardMax = options.maxRange ?? 38;
    let result: InternalAnchor | null = null;
    let resultScore = -Infinity;

    for (const anchor of this.internalAnchors) {
      this.toAnchor.copy(anchor.position).sub(playerPosition);
      const distance = this.toAnchor.length();
      const range = Math.min(anchor.range, hardMax);
      if (distance > range || distance < 2.2) {
        continue;
      }
      const normalized = this.toAnchor.clone().normalize();
      const forwardDot = normalized.dot(direction);
      if (forwardDot < minimumForwardDot || !this.hasLineOfSight(playerPosition, anchor)) {
        continue;
      }
      const heightBonus = THREE.MathUtils.clamp(this.toAnchor.y / 12, -0.4, 1);
      const aheadBonus = THREE.MathUtils.clamp(this.toAnchor.z / 20, -0.5, 1);
      const distanceScore = 1 - distance / range;
      const score = forwardDot * 2.3 + heightBonus * 1.1 + aheadBonus * 0.7 + distanceScore;
      if (score > resultScore) {
        result = anchor;
        resultScore = score;
      }
    }

    this.setSelected(result);
    return result;
  }

  clearSelection(): void {
    this.setSelected(null);
  }

  private setSelected(next: InternalAnchor | null): void {
    this.selected = next;
    for (const anchor of this.internalAnchors) {
      anchor.selected = anchor === next;
    }
  }

  update(
    elapsed: number,
    playerPosition: THREE.Vector3,
    velocity: THREE.Vector3,
    showSuggested = true,
    lockedAnchorId: string | null = null,
  ): void {
    if (lockedAnchorId !== null) {
      this.setSelected(
        this.internalAnchors.find((anchor) => anchor.id === lockedAnchorId) ?? null,
      );
    } else if (showSuggested) {
      this.selectTarget(playerPosition, velocity);
    }
    for (let index = 0; index < this.internalAnchors.length; index += 1) {
      const anchor = this.internalAnchors[index];
      if (anchor === undefined) {
        continue;
      }
      const distance = anchor.position.distanceTo(playerPosition);
      const relativeZ = anchor.position.z - playerPosition.z;
      const visible = distance <= anchor.range + 5 && relativeZ > -14;
      anchor.visible = visible;
      anchor.mesh.visible = visible;
      if (!visible) {
        continue;
      }
      const pulse = 1 + Math.sin(elapsed * 4.5 + index * 0.7) * 0.09;
      const selectedScale = anchor.selected ? 1.3 : 1;
      anchor.mesh.scale.setScalar(pulse * selectedScale);
      anchor.mesh.rotation.y = elapsed * (anchor.selected ? 1.8 : 0.65);
      anchor.coreMaterial.color.setHex(anchor.selected ? 0xffffff : 0x72f5ff);
      anchor.coreMaterial.opacity = anchor.selected ? 1 : 0.84;
      anchor.ringMaterial.color.setHex(anchor.selected ? 0xffe36e : 0x72f5ff);
      anchor.ringMaterial.opacity = anchor.selected ? 0.92 : 0.36;
    }
  }

  getById(id: string): AnchorRecord | null {
    return this.internalAnchors.find((anchor) => anchor.id === id) ?? null;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.group.removeFromParent();
    this.coreGeometry.dispose();
    this.ringGeometry.dispose();
    for (const anchor of this.internalAnchors) {
      anchor.coreMaterial.dispose();
      anchor.ringMaterial.dispose();
    }
    this.internalAnchors.length = 0;
    this.anchors.length = 0;
    this.selected = null;
  }
}
