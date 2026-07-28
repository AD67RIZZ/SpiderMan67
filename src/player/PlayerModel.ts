import * as THREE from 'three';
import { PlayerAnimation, type PlayerRig } from './PlayerAnimation';
import type { PlayerAction } from './types';

export interface PlayerModelOptions {
  color?: THREE.ColorRepresentation;
  remote?: boolean;
  reducedMotion?: boolean;
  trailLength?: number;
}

export interface PlayerModelMotion {
  action: PlayerAction;
  speed: number;
  steer: number;
  verticalVelocity: number;
  grounded: boolean;
}

export class PlayerModel {
  readonly group = new THREE.Group();

  private readonly scene: THREE.Scene;
  private readonly rigRoot = new THREE.Group();
  private readonly suitMaterial: THREE.MeshStandardMaterial;
  private readonly darkMaterial: THREE.MeshStandardMaterial;
  private readonly visorMaterial: THREE.MeshBasicMaterial;
  private readonly accentMaterial: THREE.MeshBasicMaterial;
  private readonly shieldMaterial: THREE.MeshBasicMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly animation: PlayerAnimation;
  private readonly trailGeometry: THREE.BufferGeometry;
  private readonly trailMaterial: THREE.LineBasicMaterial;
  private readonly trail: THREE.Line;
  private readonly trailPositions: Float32Array;
  private readonly grapplePoint = new THREE.Object3D();
  private readonly reducedMotion: boolean;
  private shield: THREE.Mesh | null = null;
  private overdrive = false;
  private disposed = false;

  constructor(scene: THREE.Scene, options: PlayerModelOptions = {}) {
    this.scene = scene;
    this.reducedMotion = options.reducedMotion ?? false;
    const color = new THREE.Color(options.color ?? 0x42e8ff);
    this.group.name = options.remote === true ? 'remote-runner' : 'local-runner';
    this.group.add(this.rigRoot);
    scene.add(this.group);

    this.suitMaterial = new THREE.MeshStandardMaterial({
      color: 0x111827,
      emissive: color,
      emissiveIntensity: 0.18,
      roughness: 0.58,
      metalness: 0.32,
    });
    this.darkMaterial = new THREE.MeshStandardMaterial({
      color: 0x070b18,
      roughness: 0.7,
      metalness: 0.4,
    });
    this.visorMaterial = new THREE.MeshBasicMaterial({
      color,
      toneMapped: false,
    });
    this.accentMaterial = new THREE.MeshBasicMaterial({
      color,
      toneMapped: false,
    });
    this.shieldMaterial = new THREE.MeshBasicMaterial({
      color: 0x76f6ff,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    const torso = new THREE.Group();
    torso.position.y = 0.18;
    const torsoGeometry = new THREE.CapsuleGeometry(0.31, 0.42, 3, 7);
    const torsoMesh = new THREE.Mesh(torsoGeometry, this.suitMaterial);
    torsoMesh.scale.set(1, 1, 0.72);
    torso.add(torsoMesh);

    const head = new THREE.Group();
    head.position.set(0, 0.72, 0.02);
    const headGeometry = new THREE.DodecahedronGeometry(0.25, 0);
    const headMesh = new THREE.Mesh(headGeometry, this.darkMaterial);
    const visorGeometry = new THREE.BoxGeometry(0.34, 0.095, 0.1);
    const visor = new THREE.Mesh(visorGeometry, this.visorMaterial);
    visor.position.set(0, 0.035, 0.21);
    visor.rotation.x = -0.06;
    head.add(headMesh, visor);

    const leftArm = this.createLimb(-0.39, 0.48, 0.13, 0.68, this.suitMaterial);
    const rightArm = this.createLimb(0.39, 0.48, 0.13, 0.68, this.suitMaterial);
    const leftLeg = this.createLimb(-0.18, -0.14, 0.17, 0.78, this.darkMaterial);
    const rightLeg = this.createLimb(0.18, -0.14, 0.17, 0.78, this.darkMaterial);

    const chestGeometry = new THREE.BoxGeometry(0.43, 0.055, 0.035);
    const chestAccent = new THREE.Mesh(chestGeometry, this.accentMaterial);
    chestAccent.position.set(0, 0.28, 0.245);
    torso.add(chestAccent);

    this.grapplePoint.position.set(-0.08, -0.62, 0);
    leftArm.add(this.grapplePoint);
    this.rigRoot.add(torso, head, leftArm, rightArm, leftLeg, rightLeg);
    const rig: PlayerRig = {
      root: this.rigRoot,
      torso,
      head,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
    };
    this.animation = new PlayerAnimation(rig);
    this.geometries.push(torsoGeometry, headGeometry, visorGeometry, chestGeometry);

    const trailLength = Math.max(5, Math.min(36, options.trailLength ?? 18));
    this.trailPositions = new Float32Array(trailLength * 3);
    this.trailGeometry = new THREE.BufferGeometry();
    this.trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trailMaterial = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: options.remote === true ? 0.35 : 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.trail = new THREE.Line(this.trailGeometry, this.trailMaterial);
    this.trail.name = `${this.group.name}-trail`;
    this.trail.frustumCulled = false;
    scene.add(this.trail);
    this.resetTrail();
  }

  private createLimb(
    x: number,
    y: number,
    radius: number,
    length: number,
    material: THREE.Material,
  ): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const geometry = new THREE.CapsuleGeometry(radius, Math.max(0.1, length - radius * 2), 2, 6);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = -length / 2;
    pivot.add(mesh);
    this.geometries.push(geometry);
    return pivot;
  }

  setColor(color: THREE.ColorRepresentation): void {
    this.visorMaterial.color.set(color);
    this.accentMaterial.color.set(color);
    this.suitMaterial.emissive.set(color);
    this.trailMaterial.color.set(color);
  }

  setPowerEffects(overdrive: boolean, shielded: boolean): void {
    this.overdrive = overdrive;
    this.suitMaterial.emissiveIntensity = overdrive ? 0.75 : 0.18;
    this.trailMaterial.opacity = overdrive ? 0.95 : 0.6;
    if (shielded && this.shield === null) {
      const geometry = new THREE.SphereGeometry(1.05, 18, 12);
      this.geometries.push(geometry);
      this.shield = new THREE.Mesh(geometry, this.shieldMaterial);
      this.shield.name = 'runner-shield';
      this.rigRoot.add(this.shield);
    }
    if (this.shield !== null) {
      this.shield.visible = shielded;
    }
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
    this.trail.visible = visible;
  }

  triggerLanding(impact: number): void {
    this.animation.triggerLanding(impact);
  }

  update(
    dt: number,
    elapsed: number,
    position: THREE.Vector3,
    yaw: number,
    motion: PlayerModelMotion,
  ): void {
    this.group.position.copy(position);
    this.group.rotation.y = yaw;
    this.animation.update(dt, elapsed, motion);
    if (this.shield !== null && this.shield.visible) {
      this.shield.rotation.y = elapsed * 0.9;
      this.shield.rotation.z = elapsed * 0.55;
      this.shieldMaterial.opacity = 0.16 + Math.sin(elapsed * 5) * 0.05;
    }
    if (!this.reducedMotion) {
      this.pushTrail(position, motion.speed);
    }
    this.trail.visible = this.group.visible && !this.reducedMotion && (motion.speed > 10 || this.overdrive);
  }

  private resetTrail(): void {
    for (let index = 0; index < this.trailPositions.length; index += 3) {
      this.trailPositions[index] = this.group.position.x;
      this.trailPositions[index + 1] = this.group.position.y;
      this.trailPositions[index + 2] = this.group.position.z;
    }
    this.trailGeometry.getAttribute('position').needsUpdate = true;
  }

  private pushTrail(position: THREE.Vector3, speed: number): void {
    for (let index = this.trailPositions.length - 3; index >= 3; index -= 3) {
      this.trailPositions[index] = this.trailPositions[index - 3] ?? position.x;
      this.trailPositions[index + 1] = this.trailPositions[index - 2] ?? position.y;
      this.trailPositions[index + 2] = this.trailPositions[index - 1] ?? position.z;
    }
    this.trailPositions[0] = position.x;
    this.trailPositions[1] = position.y - 0.05;
    this.trailPositions[2] = position.z - 0.2;
    this.trailGeometry.getAttribute('position').needsUpdate = true;
    this.trailMaterial.opacity = this.overdrive ? 0.95 : THREE.MathUtils.clamp((speed - 7) / 18, 0.2, 0.65);
  }

  getGrapplePoint(target = new THREE.Vector3()): THREE.Vector3 {
    return this.grapplePoint.getWorldPosition(target);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.group.removeFromParent();
    this.trail.removeFromParent();
    this.suitMaterial.dispose();
    this.darkMaterial.dispose();
    this.visorMaterial.dispose();
    this.accentMaterial.dispose();
    this.shieldMaterial.dispose();
    this.trailMaterial.dispose();
    this.trailGeometry.dispose();
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
  }
}
