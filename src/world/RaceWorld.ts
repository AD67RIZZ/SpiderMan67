import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import {
  Drone,
  ElectricPanel,
  FallingSign,
  LaserGate,
  Projectile,
  type HazardActor,
} from '../hazards';
import { ParticlePool } from '../systems/ParticlePool';
import { AnchorSystem } from './AnchorSystem';
import { CheckpointSystem } from './CheckpointSystem';
import { ChunkManager } from './ChunkManager';
import { CityGenerator } from './CityGenerator';
import { Environment } from './Environment';
import type {
  CourseLayout,
  GraphicsQuality,
  PlatformRecord,
  AnchorRecord,
  CheckpointRecord,
  PowerUpKind,
  PowerUpRecord,
  RaceWorldOptions,
  RaceWorldUpdate,
  RailRecord,
  ShardRecord,
  WorldEvent,
  WorldPlayerState,
} from './types';

const SHARD_COLORS = {
  normal: 0x62f7ff,
  risky: 0xffd75c,
} as const;

const POWER_COLORS: Readonly<Record<PowerUpKind, number>> = {
  overdrive: 0xff4fd8,
  shield: 0x52f6ff,
  magnet: 0xffd65b,
};

export class RaceWorld {
  readonly physicsWorld: CANNON.World;
  readonly layout: CourseLayout;
  readonly totalDistance: number;
  readonly spawnPosition: THREE.Vector3;
  readonly platforms: PlatformRecord[];
  readonly rails: RailRecord[];
  readonly anchors: AnchorRecord[];
  readonly checkpoints: CheckpointRecord[];
  readonly shards: ShardRecord[] = [];
  readonly powerUps: PowerUpRecord[] = [];
  readonly hazards: HazardActor[] = [];
  readonly collidables: THREE.Object3D[];
  readonly anchorSystem: AnchorSystem;
  readonly checkpointSystem: CheckpointSystem;
  readonly particles: ParticlePool;

  private readonly scene: THREE.Scene;
  private readonly quality: GraphicsQuality;
  private readonly chunkManager: ChunkManager;
  private readonly environment: Environment;
  private readonly drones: Drone[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly shardGeometry = new THREE.OctahedronGeometry(0.34, 0);
  private readonly shardMaterials: THREE.MeshBasicMaterial[];
  private readonly powerGeometry = new THREE.IcosahedronGeometry(0.54, 1);
  private readonly powerRingGeometry = new THREE.TorusGeometry(0.82, 0.055, 8, 24);
  private readonly powerMaterials = new Map<PowerUpKind, THREE.MeshBasicMaterial>();
  private readonly pendingPowerUps = new Map<string, number>();
  private readonly authoritativePowerUps: boolean;
  private readonly hazardCooldowns = new Map<string, number>();
  private readonly temporary = new THREE.Vector3();
  private projectileSequence = 0;
  private lastProjectileAt = -Infinity;
  private finished = false;
  private disposed = false;

  constructor(scene: THREE.Scene, options: RaceWorldOptions = {}) {
    this.scene = scene;
    this.quality = options.quality ?? 'medium';
    this.authoritativePowerUps = options.mode === 'multiplayer';
    this.physicsWorld = new CANNON.World({
      gravity: new CANNON.Vec3(0, -25, 0),
      allowSleep: true,
    });
    this.physicsWorld.broadphase = new CANNON.SAPBroadphase(this.physicsWorld);
    // Horizontal friction in cannon-es can cancel the runner's drive force
    // when the capsule has multiple contact points. Movement is controlled by
    // the arcade controller instead, so the shared contact stays frictionless.
    this.physicsWorld.defaultContactMaterial.friction = 0;
    this.physicsWorld.defaultContactMaterial.restitution = 0;
    if (this.physicsWorld.solver instanceof CANNON.GSSolver) {
      this.physicsWorld.solver.iterations = this.quality === 'low' ? 7 : 10;
    }

    this.layout = CityGenerator.generate(
      options.seed ?? 'neon-grapple-rush',
      options.mode ?? 'practice',
      options.courseLength ?? 'standard',
    );
    this.totalDistance = this.layout.totalDistance;
    this.spawnPosition = new THREE.Vector3().fromArray(this.layout.spawn);
    this.environment = new Environment(
      scene,
      this.layout.seed,
      this.quality,
      this.layout.totalDistance,
    );
    this.chunkManager = new ChunkManager(scene, this.physicsWorld, this.layout);
    this.platforms = this.chunkManager.platforms;
    this.rails = this.chunkManager.rails;
    this.collidables = this.chunkManager.collidables;
    this.anchorSystem = new AnchorSystem(scene, this.layout.anchors, this.collidables);
    this.anchors = this.anchorSystem.anchors;
    this.checkpointSystem = new CheckpointSystem(scene, this.layout.checkpoints);
    this.checkpoints = this.checkpointSystem.checkpoints;
    this.particles = new ParticlePool(scene, this.quality);

    this.shardMaterials = [
      new THREE.MeshBasicMaterial({ color: SHARD_COLORS.normal, toneMapped: false }),
      new THREE.MeshBasicMaterial({ color: SHARD_COLORS.risky, toneMapped: false }),
    ];
    for (const kind of ['overdrive', 'shield', 'magnet'] as const) {
      this.powerMaterials.set(
        kind,
        new THREE.MeshBasicMaterial({
          color: POWER_COLORS[kind],
          transparent: true,
          opacity: 0.9,
          toneMapped: false,
        }),
      );
    }
    this.buildCollectibles();
    this.buildHazards();
    this.buildProjectilePool();
  }

  private buildCollectibles(): void {
    for (const spec of this.layout.shards) {
      const material = this.shardMaterials[spec.risky ? 1 : 0];
      if (material === undefined) {
        continue;
      }
      const mesh = new THREE.Mesh(this.shardGeometry, material);
      mesh.name = spec.id;
      mesh.position.fromArray(spec.position);
      mesh.userData.shardId = spec.id;
      mesh.userData.risky = spec.risky ?? false;
      this.scene.add(mesh);
      this.shards.push({
        id: spec.id,
        mesh,
        active: true,
        risky: spec.risky ?? false,
      });
    }

    for (const spec of this.layout.powerUps) {
      const group = new THREE.Group();
      group.name = spec.id;
      group.position.fromArray(spec.position);
      const material = this.powerMaterials.get(spec.kind);
      if (material === undefined) {
        continue;
      }
      const core = new THREE.Mesh(this.powerGeometry, material);
      const ring = new THREE.Mesh(this.powerRingGeometry, material);
      const crossRing = new THREE.Mesh(this.powerRingGeometry, material);
      crossRing.rotation.y = Math.PI / 2;
      group.add(core, ring, crossRing);
      group.userData.powerUpId = spec.id;
      group.userData.kind = spec.kind;
      this.scene.add(group);
      this.powerUps.push({
        id: spec.id,
        kind: spec.kind,
        group,
        active: true,
        pending: false,
      });
    }
  }

  private buildHazards(): void {
    for (const spec of this.layout.hazards) {
      const position = new THREE.Vector3().fromArray(spec.position);
      let actor: HazardActor;
      switch (spec.kind) {
        case 'drone': {
          const chunkIndex = Number(spec.id.split('-')[1]);
          const drone = new Drone(this.scene, {
            id: spec.id,
            position,
            patrolRadius: spec.options?.patrol,
            phase: spec.options?.phase,
            projectileEnabled: Number.isFinite(chunkIndex) && chunkIndex >= 15,
          });
          actor = drone;
          this.drones.push(drone);
          break;
        }
        case 'laser':
          actor = new LaserGate(this.scene, {
            id: spec.id,
            position,
            width: spec.options?.width,
            height: spec.options?.height,
            safeOffset: spec.options?.safeOffset,
            phase: spec.options?.phase,
          });
          break;
        case 'sign': {
          const sign = new FallingSign(this.scene, {
            id: spec.id,
            position,
            phase: spec.options?.phase,
          });
          actor = sign;
          this.collidables.push(sign.group);
          break;
        }
        case 'electric':
          actor = new ElectricPanel(this.scene, {
            id: spec.id,
            position,
            width: spec.options?.width,
            depth: spec.options?.depth,
            phase: spec.options?.phase,
          });
          break;
      }
      this.hazards.push(actor);
    }
  }

  private buildProjectilePool(): void {
    const count = this.quality === 'low' ? 3 : 6;
    for (let index = 0; index < count; index += 1) {
      const projectile = new Projectile(this.scene, `projectile-${index}`);
      this.projectiles.push(projectile);
      this.hazards.push(projectile);
    }
  }

  /**
   * Advances deterministic visuals, hazard cycles and player/world
   * interactions. Call before or after PlayerController.update; physics itself
   * is stepped by PlayerController unless stepPhysics is used directly.
   */
  update(dt: number, elapsed: number, playerState: WorldPlayerState): RaceWorldUpdate {
    const safeDt = Math.max(0, Math.min(0.1, dt));
    this.environment.update(safeDt, elapsed);
    this.chunkManager.update(elapsed);
    this.chunkManager.recycleAround(playerState.position.z, 320, 260);
    this.anchorSystem.update(
      elapsed,
      playerState.position,
      playerState.velocity,
      true,
      playerState.grappleAnchorId ?? null,
    );
    this.particles.update(safeDt);
    this.updateCollectibleVisuals(safeDt, elapsed, playerState);
    this.updateCooldowns(safeDt);
    this.restoreTimedOutPowerUps(elapsed);
    for (const hazard of this.hazards) {
      hazard.update(safeDt, elapsed, playerState.position);
    }

    const events: WorldEvent[] = [];
    const checkpoint = this.checkpointSystem.update(elapsed, playerState.position);
    if (checkpoint !== null) {
      events.push({
        type: 'checkpoint',
        checkpoint: checkpoint.checkpoint,
        respawn: checkpoint.respawn,
      });
    }
    events.push(...this.checkInteractions(playerState, elapsed));
    if (!this.finished && playerState.position.z >= this.layout.finish[2] - 1) {
      const finishX = this.layout.finish[0];
      if (Math.abs(playerState.position.x - finishX) < 13) {
        this.finished = true;
        events.push({ type: 'finish' });
      }
    }

    return {
      events,
      progress: THREE.MathUtils.clamp((playerState.position.z - this.layout.spawn[2]) / this.totalDistance, 0, 1),
      checkpoint: this.checkpointSystem.latestIndex,
      selectedAnchor: this.anchorSystem.selected,
    };
  }

  private updateCollectibleVisuals(
    dt: number,
    elapsed: number,
    playerState: WorldPlayerState,
  ): void {
    const magnetRadius = Math.max(0, playerState.magnetRadius ?? 0);
    for (let index = 0; index < this.shards.length; index += 1) {
      const shard = this.shards[index];
      if (shard === undefined || !shard.active) {
        continue;
      }
      shard.mesh.rotation.y = elapsed * 2.6 + index * 0.21;
      shard.mesh.rotation.x = Math.sin(elapsed * 2 + index) * 0.28;
      shard.mesh.scale.setScalar(1 + Math.sin(elapsed * 5 + index * 0.4) * 0.09);
      if (magnetRadius > 0) {
        const distance = shard.mesh.position.distanceTo(playerState.position);
        if (distance < magnetRadius && distance > 0.5) {
          const strength = THREE.MathUtils.clamp(1 - distance / magnetRadius, 0, 1);
          this.temporary
            .copy(playerState.position)
            .sub(shard.mesh.position)
            .normalize();
          shard.mesh.position.addScaledVector(this.temporary, dt * (4 + strength * 18));
        }
      }
    }
    for (let index = 0; index < this.powerUps.length; index += 1) {
      const power = this.powerUps[index];
      if (power === undefined || !power.active) {
        continue;
      }
      power.group.rotation.y = elapsed * 1.4 + index;
      power.group.rotation.z = Math.sin(elapsed * 1.8 + index) * 0.2;
      power.group.scale.setScalar(1 + Math.sin(elapsed * 4 + index) * 0.08);
    }
  }

  private updateCooldowns(dt: number): void {
    for (const [id, remaining] of this.hazardCooldowns) {
      const next = remaining - dt;
      if (next <= 0) {
        this.hazardCooldowns.delete(id);
      } else {
        this.hazardCooldowns.set(id, next);
      }
    }
  }

  /** Can be called separately by authoritative simulations if desired. */
  checkInteractions(playerState: WorldPlayerState, elapsed: number): WorldEvent[] {
    const events: WorldEvent[] = [];
    const radius = playerState.radius ?? 0.65;

    for (const shard of this.shards) {
      if (!shard.active || shard.mesh.position.distanceToSquared(playerState.position) > (radius + 0.72) ** 2) {
        continue;
      }
      shard.active = false;
      shard.mesh.visible = false;
      this.particles.burst({
        position: shard.mesh.position,
        color: shard.risky ? SHARD_COLORS.risky : SHARD_COLORS.normal,
        count: shard.risky ? 18 : 12,
        speed: 4,
      });
      events.push({ type: 'shard', id: shard.id, risky: shard.risky, points: shard.risky ? 90 : 50 });
    }

    for (const power of this.powerUps) {
      if (
        !power.active ||
        power.pending ||
        power.group.position.distanceToSquared(playerState.position) > (radius + 1) ** 2
      ) {
        continue;
      }
      power.pending = this.authoritativePowerUps;
      power.active = this.authoritativePowerUps;
      power.group.visible = false;
      if (this.authoritativePowerUps) {
        this.pendingPowerUps.set(power.id, elapsed + 5);
      }
      this.particles.burst({
        position: power.group.position,
        color: POWER_COLORS[power.kind],
        count: 24,
        speed: 5,
        life: 1,
      });
      events.push({
        type: 'power-up',
        id: power.id,
        kind: power.kind,
        requiresValidation: this.authoritativePowerUps,
      });
    }

    for (const drone of this.drones) {
      const interaction = drone.interact(playerState.position, playerState.isDashing ?? false, radius);
      if (interaction === 'destroyed') {
        this.particles.burst({
          position: drone.position,
          color: 0xff8b42,
          count: 28,
          speed: 7,
          life: 1.1,
        });
        events.push({ type: 'drone-destroyed', id: drone.id, points: 450 });
      } else if (
        interaction === 'hit' &&
        playerState.invulnerable !== true &&
        !this.hazardCooldowns.has(drone.id)
      ) {
        const hit = drone.hitTest(playerState.position, radius);
        if (hit !== null) {
          this.hazardCooldowns.set(drone.id, 1.2);
          events.push({ type: 'hazard-hit', id: hit.id, kind: hit.kind, impulse: hit.impulse });
        }
      }
    }

    for (const hazard of this.hazards) {
      if (
        hazard instanceof Drone ||
        playerState.invulnerable === true ||
        this.hazardCooldowns.has(hazard.id)
      ) {
        continue;
      }
      const hit = hazard.hitTest(playerState.position, radius);
      if (hit !== null) {
        this.hazardCooldowns.set(hazard.id, 1.2);
        events.push({ type: 'hazard-hit', id: hit.id, kind: hit.kind, impulse: hit.impulse });
      }
    }

    this.tryLaunchProjectile(elapsed, playerState.position);
    return events;
  }

  private tryLaunchProjectile(elapsed: number, target: THREE.Vector3): void {
    if (elapsed - this.lastProjectileAt < 1.6) {
      return;
    }
    const drone = this.drones.find((candidate) => candidate.canFire(elapsed, target));
    const projectile = this.projectiles.find((candidate) => !candidate.active);
    if (drone === undefined || projectile === undefined) {
      return;
    }
    this.temporary.copy(target);
    this.temporary.z += 2.2;
    projectile.launch({
      origin: drone.position,
      target: this.temporary,
      speed: 8 + (this.projectileSequence % 3) * 0.4,
      telegraphSeconds: 0.72,
      maximumLife: 5,
    });
    this.projectileSequence += 1;
    this.lastProjectileAt = elapsed;
    drone.markFired(elapsed);
  }

  /**
   * Resolves a hidden multiplayer pickup after server validation. Accepted
   * pickups stay unavailable for every client; rejected/time-out requests
   * become collectable again.
   */
  resolvePowerUpCollection(objectId: string, accepted: boolean): PowerUpRecord | null {
    const power = this.powerUps.find((entry) => entry.id === objectId);
    if (power === undefined) {
      return null;
    }
    this.pendingPowerUps.delete(objectId);
    power.pending = false;
    power.active = !accepted;
    power.group.visible = !accepted;
    return power;
  }

  private restoreTimedOutPowerUps(elapsed: number): void {
    for (const [objectId, expiresAt] of this.pendingPowerUps) {
      if (elapsed >= expiresAt) {
        this.resolvePowerUpCollection(objectId, false);
      }
    }
  }

  stepPhysics(dt: number): void {
    this.physicsWorld.step(1 / 120, Math.max(0, Math.min(0.1, dt)), 8);
  }

  get currentCheckpoint(): number {
    return this.checkpointSystem.latestIndex;
  }

  getCheckpointPosition(index = this.checkpointSystem.latestIndex): THREE.Vector3 {
    return this.checkpointSystem.getRespawnPosition(index);
  }

  getRespawnPosition(): THREE.Vector3 {
    return this.checkpointSystem.getRespawnPosition();
  }

  resetCollectibles(): void {
    const shardSpecs = new Map(this.layout.shards.map((spec) => [spec.id, spec]));
    for (const shard of this.shards) {
      shard.active = true;
      shard.mesh.visible = true;
      const spec = shardSpecs.get(shard.id);
      if (spec !== undefined) {
        shard.mesh.position.fromArray(spec.position);
      }
    }
    for (const power of this.powerUps) {
      power.active = true;
      power.pending = false;
      power.group.visible = true;
    }
    this.checkpointSystem.reset();
    this.finished = false;
    this.hazardCooldowns.clear();
    this.pendingPowerUps.clear();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.particles.dispose();
    this.anchorSystem.dispose();
    this.checkpointSystem.dispose();
    this.chunkManager.dispose();
    this.environment.dispose();
    for (const shard of this.shards) {
      shard.mesh.removeFromParent();
    }
    for (const power of this.powerUps) {
      power.group.removeFromParent();
    }
    for (const hazard of this.hazards) {
      hazard.dispose();
    }
    this.shardGeometry.dispose();
    this.powerGeometry.dispose();
    this.powerRingGeometry.dispose();
    for (const material of this.shardMaterials) {
      material.dispose();
    }
    for (const material of this.powerMaterials.values()) {
      material.dispose();
    }
    this.shards.length = 0;
    this.powerUps.length = 0;
    this.hazards.length = 0;
    this.drones.length = 0;
    this.projectiles.length = 0;
    this.powerMaterials.clear();
    this.hazardCooldowns.clear();
    this.pendingPowerUps.clear();
  }
}
