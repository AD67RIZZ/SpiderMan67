import type * as CANNON from 'cannon-es';
import type * as THREE from 'three';
import type { PowerUpKind as SharedPowerUpKind } from '../shared/protocol';

export type Vec3Tuple = readonly [number, number, number];
export type RaceMode = 'practice' | 'tutorial' | 'multiplayer';
export type GraphicsQuality = 'low' | 'medium' | 'high';
export type ChunkKind =
  | 'beginner'
  | 'grapple'
  | 'split'
  | 'curved'
  | 'wall-run'
  | 'rail'
  | 'moving'
  | 'hazard'
  | 'final';

export interface RaceWorldOptions {
  seed?: number | string;
  mode?: RaceMode;
  quality?: GraphicsQuality;
  courseLength?: 'short' | 'standard' | 'long';
  reducedMotion?: boolean;
}

export interface PlatformSpec {
  id: string;
  chunk: number;
  position: Vec3Tuple;
  size: Vec3Tuple;
  neon: number;
  kind?: 'roof' | 'wall' | 'moving';
  movement?: {
    axis: 'x' | 'y';
    distance: number;
    period: number;
    phase: number;
  };
}

export interface AnchorSpec {
  id: string;
  chunk: number;
  position: Vec3Tuple;
  range?: number;
}

export interface CheckpointSpec {
  id: string;
  index: number;
  position: Vec3Tuple;
  width: number;
  respawn: Vec3Tuple;
}

export interface ShardSpec {
  id: string;
  position: Vec3Tuple;
  risky?: boolean;
}

export type PowerUpKind = SharedPowerUpKind;

export interface PowerUpSpec {
  id: string;
  position: Vec3Tuple;
  kind: PowerUpKind;
}

export interface RailSpec {
  id: string;
  start: Vec3Tuple;
  end: Vec3Tuple;
  neon: number;
}

export type HazardKind = 'drone' | 'laser' | 'sign' | 'electric';

export interface HazardSpec {
  id: string;
  kind: HazardKind;
  position: Vec3Tuple;
  options?: Record<string, number>;
}

export interface CourseChunk {
  id: string;
  index: number;
  kind: ChunkKind;
  startZ: number;
  endZ: number;
}

export interface CourseLayout {
  seed: number;
  chunks: CourseChunk[];
  platforms: PlatformSpec[];
  anchors: AnchorSpec[];
  checkpoints: CheckpointSpec[];
  shards: ShardSpec[];
  powerUps: PowerUpSpec[];
  rails: RailSpec[];
  hazards: HazardSpec[];
  spawn: Vec3Tuple;
  finish: Vec3Tuple;
  totalDistance: number;
}

export interface PlatformRecord {
  spec: PlatformSpec;
  mesh: THREE.Mesh;
  body: CANNON.Body;
  originalPosition: THREE.Vector3;
}

export interface AnchorRecord {
  id: string;
  position: THREE.Vector3;
  mesh: THREE.Group;
  range: number;
  visible: boolean;
  selected: boolean;
}

export interface CheckpointRecord {
  spec: CheckpointSpec;
  group: THREE.Group;
  passed: boolean;
}

export interface ShardRecord {
  id: string;
  mesh: THREE.Mesh;
  active: boolean;
  risky: boolean;
}

export interface PowerUpRecord {
  id: string;
  kind: PowerUpKind;
  group: THREE.Group;
  active: boolean;
  pending: boolean;
}

export interface RailRecord {
  spec: RailSpec;
  mesh: THREE.Mesh;
  start: THREE.Vector3;
  end: THREE.Vector3;
}

export interface WorldPlayerState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  radius?: number;
  isDashing?: boolean;
  invulnerable?: boolean;
  magnetRadius?: number;
  grappleAnchorId?: string | null;
}

export type WorldEvent =
  | { type: 'checkpoint'; checkpoint: number; respawn: THREE.Vector3 }
  | { type: 'shard'; id: string; risky: boolean; points: number }
  | {
      type: 'power-up';
      id: string;
      kind: PowerUpKind;
      requiresValidation: boolean;
    }
  | { type: 'hazard-hit'; id: string; kind: HazardKind | 'projectile'; impulse: THREE.Vector3 }
  | { type: 'drone-destroyed'; id: string; points: number }
  | { type: 'finish' };

export interface RaceWorldUpdate {
  events: WorldEvent[];
  progress: number;
  checkpoint: number;
  selectedAnchor: AnchorRecord | null;
}
