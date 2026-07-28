import * as THREE from "three";
import type { PlayerSnapshot } from "../shared/protocol";
import { damp } from "../utils/MathUtils";

export interface RemotePlayerOptions {
  name?: string;
  color?: string;
}

/**
 * Lightweight procedural runner for a network peer. It has no physics body,
 * so remote players cannot shove or trap the local runner.
 */
export class RemotePlayer {
  public readonly group = new THREE.Group();
  public readonly id: string;
  private readonly body = new THREE.Group();
  private readonly torso: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly leftArm: THREE.Group;
  private readonly rightArm: THREE.Group;
  private readonly leftLeg: THREE.Group;
  private readonly rightLeg: THREE.Group;
  private readonly trail: THREE.Mesh;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly targetPosition = new THREE.Vector3();
  private target?: PlayerSnapshot;
  private animationTime = 0;
  private initialized = false;

  public constructor(
    parent: THREE.Object3D,
    id: string,
    options: RemotePlayerOptions = {},
  ) {
    this.id = id;
    this.group.name = `remote-player:${id}`;
    this.group.userData.playerId = id;
    this.group.userData.playerName = options.name ?? "Runner";

    const color = new THREE.Color(options.color ?? "#00e5ff");
    const dark = color.clone().multiplyScalar(0.18);
    const suit = this.material(new THREE.MeshStandardMaterial({
      color: dark,
      roughness: 0.52,
      metalness: 0.42,
    }));
    const accent = this.material(new THREE.MeshBasicMaterial({
      color,
      toneMapped: false,
    }));
    const visor = this.material(new THREE.MeshBasicMaterial({
      color: "#bafcff",
      toneMapped: false,
    }));

    this.torso = this.mesh(new THREE.CylinderGeometry(0.34, 0.42, 1.08, 6), suit);
    this.torso.position.y = 1.42;
    const chest = this.mesh(new THREE.BoxGeometry(0.46, 0.09, 0.04), accent);
    chest.position.set(0, 1.53, 0.36);

    this.head = this.mesh(new THREE.IcosahedronGeometry(0.31, 1), suit);
    this.head.position.y = 2.19;
    const visorMesh = this.mesh(new THREE.BoxGeometry(0.45, 0.13, 0.06), visor);
    visorMesh.position.set(0, 2.2, 0.27);
    visorMesh.rotation.x = -0.08;

    this.leftArm = this.limb(-0.5, 1.72, 0.13, 0.82, suit, accent);
    this.rightArm = this.limb(0.5, 1.72, 0.13, 0.82, suit, accent);
    this.leftLeg = this.limb(-0.21, 0.92, 0.16, 0.92, suit, accent);
    this.rightLeg = this.limb(0.21, 0.92, 0.16, 0.92, suit, accent);

    this.trail = this.mesh(
      new THREE.ConeGeometry(0.18, 1.7, 5, 1, true),
      this.material(new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })),
    );
    this.trail.rotation.x = -Math.PI / 2;
    this.trail.position.set(0, 0.9, -1.2);
    this.trail.visible = false;

    this.body.add(this.torso, chest, this.head, visorMesh, this.leftArm, this.rightArm, this.leftLeg, this.rightLeg, this.trail);
    this.body.position.y = -0.95;
    this.group.add(this.body);
    this.group.scale.setScalar(0.82);
    parent.add(this.group);
  }

  public applySnapshot(snapshot: PlayerSnapshot, teleport = false): void {
    this.target = snapshot;
    this.group.visible = snapshot.connected;
    this.group.userData.playerName = snapshot.name;
    if (!this.initialized || teleport) {
      this.group.position.set(
        snapshot.motion.position.x,
        snapshot.motion.position.y,
        snapshot.motion.position.z,
      );
      this.group.rotation.y = snapshot.motion.yaw;
      this.initialized = true;
    }
  }

  public update(deltaSeconds: number): void {
    if (!this.target || !this.initialized) return;
    const delta = Math.min(Math.max(deltaSeconds, 0), 0.1);
    const motion = this.target.motion;
    this.targetPosition.set(motion.position.x, motion.position.y, motion.position.z);
    const distance = this.group.position.distanceTo(this.targetPosition);
    if (distance > 10) {
      this.group.position.set(motion.position.x, motion.position.y, motion.position.z);
    } else {
      this.group.position.set(
        damp(this.group.position.x, motion.position.x, 14, delta),
        damp(this.group.position.y, motion.position.y, 14, delta),
        damp(this.group.position.z, motion.position.z, 14, delta),
      );
    }
    const turn = Math.atan2(
      Math.sin(motion.yaw - this.group.rotation.y),
      Math.cos(motion.yaw - this.group.rotation.y),
    );
    this.group.rotation.y += turn * (1 - Math.exp(-12 * delta));
    this.animationTime += delta * Math.max(3, Math.min(13, motion.velocity.z * 0.42));
    this.animate(motion.action, motion.velocity);
    this.group.visible = this.target.connected;
  }

  public setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  private animate(action: PlayerSnapshot["motion"]["action"], velocity: { x: number; y: number; z: number }): void {
    const stride = Math.sin(this.animationTime) * 0.72;
    const speed = Math.hypot(velocity.x, velocity.z);
    const runBlend = Math.min(1, speed / 8);
    this.leftLeg.rotation.x = stride * runBlend;
    this.rightLeg.rotation.x = -stride * runBlend;
    this.leftArm.rotation.x = -stride * 0.72 * runBlend;
    this.rightArm.rotation.x = stride * 0.72 * runBlend;
    this.body.rotation.z = 0;
    this.body.rotation.x = 0;
    this.body.rotation.y = 0;
    this.trail.visible = speed > 18 || action === "dash";
    this.trail.scale.z = Math.max(0.5, Math.min(2.1, speed / 16));

    if (action === "grapple") {
      this.rightArm.rotation.x = -2.15;
      this.rightArm.rotation.z = -0.25;
      this.body.rotation.x = -0.15;
    } else if (action === "dash") {
      this.leftArm.rotation.x = 1.3;
      this.rightArm.rotation.x = 1.3;
      this.leftLeg.rotation.x = -0.25;
      this.rightLeg.rotation.x = -0.25;
      this.body.rotation.x = -0.3;
    } else if (action === "wall_run") {
      this.body.rotation.z = 0.28;
      this.leftArm.rotation.z = -0.65;
      this.rightArm.rotation.z = 0.65;
    } else if (action === "fall") {
      this.leftArm.rotation.z = -1.05;
      this.rightArm.rotation.z = 1.05;
      this.leftLeg.rotation.x = 0.3;
      this.rightLeg.rotation.x = -0.3;
    } else if (action === "jump") {
      this.leftLeg.rotation.x = 0.42;
      this.rightLeg.rotation.x = -0.36;
    } else if (action === "respawn") {
      this.body.rotation.y = this.animationTime * 2.5;
    }
  }

  private limb(
    x: number,
    y: number,
    radius: number,
    length: number,
    suit: THREE.Material,
    accent: THREE.Material,
  ): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const segment = this.mesh(new THREE.CylinderGeometry(radius, radius * 0.82, length, 5), suit);
    segment.position.y = -length / 2;
    const strip = this.mesh(new THREE.BoxGeometry(radius * 1.45, length * 0.45, radius * 0.28), accent);
    strip.position.set(0, -length * 0.5, -radius);
    pivot.add(segment, strip);
    return pivot;
  }

  private mesh<T extends THREE.BufferGeometry, M extends THREE.Material>(
    geometry: T,
    material: M,
  ): THREE.Mesh<T, M> {
    this.geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    return mesh;
  }

  private material<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  public dispose(): void {
    this.group.removeFromParent();
    for (const geometry of new Set(this.geometries)) geometry.dispose();
    for (const material of new Set(this.materials)) material.dispose();
    this.target = undefined;
  }

  public destroy(): void {
    this.dispose();
  }
}
