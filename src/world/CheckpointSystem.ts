import * as THREE from 'three';
import type { CheckpointRecord, CheckpointSpec } from './types';

export interface CheckpointPass {
  checkpoint: number;
  respawn: THREE.Vector3;
}

export class CheckpointSystem {
  readonly group = new THREE.Group();
  readonly checkpoints: CheckpointRecord[] = [];
  latestIndex = 0;

  private readonly ringGeometry = new THREE.TorusGeometry(3.25, 0.16, 10, 36);
  private readonly postGeometry = new THREE.BoxGeometry(0.18, 5.8, 0.18);
  private readonly materials: THREE.MeshBasicMaterial[] = [];
  private disposed = false;

  constructor(scene: THREE.Scene, specs: readonly CheckpointSpec[]) {
    this.group.name = 'checkpoints';
    scene.add(this.group);
    for (const spec of specs) {
      const checkpoint = new THREE.Group();
      checkpoint.name = spec.id;
      checkpoint.position.fromArray(spec.position);

      const material = new THREE.MeshBasicMaterial({
        color: spec.index === 0 ? 0x7b5cff : 0x22edb3,
        transparent: true,
        opacity: 0.7,
        toneMapped: false,
      });
      this.materials.push(material);
      const ring = new THREE.Mesh(this.ringGeometry, material);
      const leftPost = new THREE.Mesh(this.postGeometry, material);
      const rightPost = new THREE.Mesh(this.postGeometry, material);
      leftPost.position.set(-spec.width * 0.5, 0, 0);
      rightPost.position.set(spec.width * 0.5, 0, 0);
      checkpoint.add(ring, leftPost, rightPost);
      this.group.add(checkpoint);
      this.checkpoints.push({ spec, group: checkpoint, passed: spec.index === 0 });
    }
  }

  update(elapsed: number, playerPosition: THREE.Vector3): CheckpointPass | null {
    for (const checkpoint of this.checkpoints) {
      if (checkpoint.passed || checkpoint.spec.index > this.latestIndex + 1) {
        continue;
      }
      const dz = playerPosition.z - checkpoint.spec.position[2];
      const dx = Math.abs(playerPosition.x - checkpoint.spec.position[0]);
      const dy = Math.abs(playerPosition.y - checkpoint.spec.position[1]);
      if (dz >= -1.3 && dz <= 5 && dx <= checkpoint.spec.width * 0.62 && dy <= 8) {
        checkpoint.passed = true;
        this.latestIndex = Math.max(this.latestIndex, checkpoint.spec.index);
        return {
          checkpoint: checkpoint.spec.index,
          respawn: new THREE.Vector3().fromArray(checkpoint.spec.respawn),
        };
      }
    }

    for (let index = 0; index < this.checkpoints.length; index += 1) {
      const checkpoint = this.checkpoints[index];
      if (checkpoint === undefined) {
        continue;
      }
      const material = this.materials[index];
      if (material !== undefined) {
        material.opacity = checkpoint.passed ? 0.2 : 0.62 + Math.sin(elapsed * 4 + index) * 0.18;
        material.color.setHex(checkpoint.passed ? 0x4e7894 : index === 0 ? 0x7b5cff : 0x22edb3);
      }
      checkpoint.group.scale.setScalar(checkpoint.passed ? 0.82 : 1 + Math.sin(elapsed * 2.2 + index) * 0.025);
    }
    return null;
  }

  getRespawnPosition(index = this.latestIndex): THREE.Vector3 {
    const safeIndex = THREE.MathUtils.clamp(Math.floor(index), 0, Math.max(0, this.checkpoints.length - 1));
    const checkpoint = this.checkpoints[safeIndex] ?? this.checkpoints[0];
    return checkpoint === undefined
      ? new THREE.Vector3(0, 32.25, 2)
      : new THREE.Vector3().fromArray(checkpoint.spec.respawn);
  }

  reset(): void {
    this.latestIndex = 0;
    for (const checkpoint of this.checkpoints) {
      checkpoint.passed = checkpoint.spec.index === 0;
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.group.removeFromParent();
    this.ringGeometry.dispose();
    this.postGeometry.dispose();
    for (const material of this.materials) {
      material.dispose();
    }
    this.materials.length = 0;
    this.checkpoints.length = 0;
  }
}
