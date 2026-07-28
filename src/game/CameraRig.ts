import * as THREE from "three";

export interface CameraTarget {
  position: THREE.Vector3;
  velocity?: THREE.Vector3;
  grappleAnchor?: THREE.Vector3 | null;
}

export class CameraRig {
  private readonly lookAt = new THREE.Vector3();
  private readonly idealPosition = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private reducedMotion = false;
  private shake = 0;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly getObstacles: () => THREE.Object3D[],
  ) {}

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
  }

  impact(strength: number): void {
    if (!this.reducedMotion) this.shake = Math.max(this.shake, Math.min(strength, 0.45));
  }

  update(target: CameraTarget, dt: number, overdrive = false): void {
    const speed = target.velocity?.length() ?? 0;
    const horizontalVelocity = target.velocity?.clone().setY(0) ?? new THREE.Vector3(0, 0, 1);
    if (horizontalVelocity.lengthSq() < 0.01) horizontalVelocity.set(0, 0, 1);
    horizontalVelocity.normalize();

    const pullBack = target.grappleAnchor ? 2 : 0;
    this.idealPosition
      .copy(target.position)
      .addScaledVector(horizontalVelocity, -(10 + pullBack + Math.min(speed * 0.09, 4)))
      .add(new THREE.Vector3(0, 5.8, 0));
    this.lookAt
      .copy(target.position)
      .addScaledVector(horizontalVelocity, 7 + Math.min(speed * 0.2, 6))
      .add(new THREE.Vector3(0, 1.5, 0));

    const rayDirection = this.idealPosition.clone().sub(this.lookAt);
    const rayLength = rayDirection.length();
    this.raycaster.set(this.lookAt, rayDirection.normalize());
    const obstruction = this.raycaster
      .intersectObjects(this.getObstacles(), false)
      .find((hit) => hit.distance < rayLength);
    if (obstruction) {
      this.idealPosition.copy(this.lookAt).addScaledVector(rayDirection, Math.max(1.6, obstruction.distance - 0.7));
    }

    const smoothing = 1 - Math.exp(-dt * (this.reducedMotion ? 6 : 8));
    this.camera.position.lerp(this.idealPosition, smoothing);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.5;
      this.shake *= Math.exp(-dt * 11);
    }
    this.camera.lookAt(this.lookAt);
    const targetFov = 68 + Math.min(speed * 0.16, 8) + (overdrive ? 7 : 0);
    this.camera.fov += (targetFov - this.camera.fov) * smoothing;
    this.camera.updateProjectionMatrix();
  }
}
