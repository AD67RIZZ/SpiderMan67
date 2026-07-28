import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import type { CourseLayout, PlatformRecord, RailRecord } from './types';

const UP = new THREE.Vector3(0, 1, 0);

function copyToCannon(target: CANNON.Vec3, source: THREE.Vector3): void {
  target.set(source.x, source.y, source.z);
}

export class ChunkManager {
  readonly group = new THREE.Group();
  readonly platforms: PlatformRecord[] = [];
  readonly rails: RailRecord[] = [];
  readonly collidables: THREE.Object3D[] = [];

  private readonly world: CANNON.World;
  private readonly boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly railGeometry = new THREE.CylinderGeometry(0.13, 0.13, 1, 8);
  private readonly materials = new Map<number, THREE.MeshStandardMaterial>();
  private readonly edgeMaterials = new Map<number, THREE.LineBasicMaterial>();
  private readonly edgeGeometry = new THREE.EdgesGeometry(this.boxGeometry);
  private readonly chunkRanges = new Map<number, { start: number; end: number }>();
  private disposed = false;

  constructor(scene: THREE.Scene, world: CANNON.World, layout: CourseLayout) {
    this.world = world;
    this.group.name = 'race-course';
    scene.add(this.group);
    for (const chunk of layout.chunks) {
      this.chunkRanges.set(chunk.index, { start: chunk.startZ, end: chunk.endZ });
    }
    this.buildPlatforms(layout);
    this.buildRails(layout);
  }

  private material(color: number): THREE.MeshStandardMaterial {
    let material = this.materials.get(color);
    if (material === undefined) {
      material = new THREE.MeshStandardMaterial({
        color: 0x081126,
        emissive: color,
        emissiveIntensity: 0.22,
        roughness: 0.72,
        metalness: 0.44,
      });
      this.materials.set(color, material);
    }
    return material;
  }

  private edgeMaterial(color: number): THREE.LineBasicMaterial {
    let material = this.edgeMaterials.get(color);
    if (material === undefined) {
      material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.86,
        toneMapped: false,
      });
      this.edgeMaterials.set(color, material);
    }
    return material;
  }

  private buildPlatforms(layout: CourseLayout): void {
    for (const spec of layout.platforms) {
      const mesh = new THREE.Mesh(this.boxGeometry, this.material(spec.neon));
      mesh.name = spec.id;
      mesh.position.fromArray(spec.position);
      mesh.scale.fromArray(spec.size);
      mesh.receiveShadow = true;
      mesh.castShadow = spec.kind === 'wall';
      mesh.userData.platformId = spec.id;
      mesh.userData.grindable = spec.kind === 'roof';

      const outline = new THREE.LineSegments(this.edgeGeometry, this.edgeMaterial(spec.neon));
      outline.scale.setScalar(1.002);
      outline.renderOrder = 2;
      mesh.add(outline);
      this.group.add(mesh);
      this.collidables.push(mesh);

      const half = new CANNON.Vec3(spec.size[0] / 2, spec.size[1] / 2, spec.size[2] / 2);
      const body = new CANNON.Body({
        mass: 0,
        type: spec.movement === undefined ? CANNON.Body.STATIC : CANNON.Body.KINEMATIC,
        shape: new CANNON.Box(half),
        material: new CANNON.Material({ friction: 0, restitution: 0 }),
      });
      body.position.set(spec.position[0], spec.position[1], spec.position[2]);
      const taggedBody = body as CANNON.Body & {
        userData?: { platformId: string; kind: string };
      };
      taggedBody.userData = { platformId: spec.id, kind: spec.kind ?? 'roof' };
      this.world.addBody(body);

      this.platforms.push({
        spec,
        mesh,
        body,
        originalPosition: mesh.position.clone(),
      });
    }
  }

  private buildRails(layout: CourseLayout): void {
    for (const spec of layout.rails) {
      const start = new THREE.Vector3().fromArray(spec.start);
      const end = new THREE.Vector3().fromArray(spec.end);
      const center = start.clone().add(end).multiplyScalar(0.5);
      const direction = end.clone().sub(start);
      const length = direction.length();
      const mesh = new THREE.Mesh(this.railGeometry, this.material(spec.neon));
      mesh.name = spec.id;
      mesh.position.copy(center);
      mesh.scale.set(1, length, 1);
      mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
      mesh.userData.railId = spec.id;
      mesh.userData.grindable = true;
      this.group.add(mesh);
      this.rails.push({ spec, mesh, start, end });
    }
  }

  update(elapsed: number): void {
    for (const platform of this.platforms) {
      const movement = platform.spec.movement;
      if (movement === undefined) {
        continue;
      }
      const phase = elapsed * ((Math.PI * 2) / movement.period) + movement.phase;
      const offset = Math.sin(phase) * movement.distance;
      const previous = platform.mesh.position.clone();
      platform.mesh.position.copy(platform.originalPosition);
      platform.mesh.position[movement.axis] += offset;
      const velocity = platform.mesh.position.clone().sub(previous);
      copyToCannon(platform.body.position, platform.mesh.position);
      platform.body.velocity.set(velocity.x * 60, velocity.y * 60, velocity.z * 60);
      platform.body.aabbNeedsUpdate = true;
    }
  }

  /**
   * Enables simple chunk recycling for endless-practice experiments. Authored
   * race modes normally keep all chunks because the standard course is small.
   */
  setChunkVisible(chunk: number, visible: boolean): void {
    for (const platform of this.platforms) {
      if (platform.spec.chunk === chunk) {
        platform.mesh.visible = visible;
        platform.body.collisionFilterMask = visible ? -1 : 0;
      }
    }
    for (const rail of this.rails) {
      const railChunk = Number(rail.spec.id.split('-')[1]);
      if (railChunk === chunk) {
        rail.mesh.visible = visible;
      }
    }
  }

  /** Disables distant geometry and physics, then restores it as the runner approaches. */
  recycleAround(playerZ: number, keepBehind = 95, keepAhead = 210): void {
    for (const [chunk, range] of this.chunkRanges) {
      const visible = range.end >= playerZ - keepBehind && range.start <= playerZ + keepAhead;
      this.setChunkVisible(chunk, visible);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const platform of this.platforms) {
      this.world.removeBody(platform.body);
    }
    this.group.removeFromParent();
    this.boxGeometry.dispose();
    this.railGeometry.dispose();
    this.edgeGeometry.dispose();
    for (const material of this.materials.values()) {
      material.dispose();
    }
    for (const material of this.edgeMaterials.values()) {
      material.dispose();
    }
    this.materials.clear();
    this.edgeMaterials.clear();
    this.chunkRanges.clear();
    this.platforms.length = 0;
    this.rails.length = 0;
    this.collidables.length = 0;
  }
}
