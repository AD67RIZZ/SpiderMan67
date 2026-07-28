import type * as THREE from 'three';
import type { HazardKind } from '../world/types';

export interface HazardContact {
  id: string;
  kind: HazardKind | 'projectile';
  impulse: THREE.Vector3;
  slowSeconds?: number;
  stunSeconds?: number;
}

export interface HazardActor {
  readonly id: string;
  readonly kind: HazardKind | 'projectile';
  readonly group: THREE.Group;
  readonly active: boolean;
  update(dt: number, elapsed: number, playerPosition?: THREE.Vector3): void;
  hitTest(position: THREE.Vector3, radius?: number): HazardContact | null;
  dispose(): void;
}
