import * as THREE from 'three';
import type { PlayerAction } from './types';

export interface PlayerRig {
  root: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
}

export interface PlayerAnimationState {
  action: PlayerAction;
  speed: number;
  steer: number;
  verticalVelocity: number;
  grounded: boolean;
}

function damp(current: number, target: number, sharpness: number, dt: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-sharpness * dt));
}

export class PlayerAnimation {
  private readonly rig: PlayerRig;
  private landingKick = 0;

  constructor(rig: PlayerRig) {
    this.rig = rig;
  }

  triggerLanding(impact: number): void {
    this.landingKick = THREE.MathUtils.clamp(impact / 18, 0.25, 1);
  }

  update(dt: number, elapsed: number, state: PlayerAnimationState): void {
    const safeDt = Math.max(0, Math.min(0.1, dt));
    const pace = THREE.MathUtils.clamp(state.speed / 14, 0.45, 2.1);
    const stride = Math.sin(elapsed * 10.5 * pace);
    let leftArmX = 0;
    let rightArmX = 0;
    let leftLegX = 0;
    let rightLegX = 0;
    let torsoX = 0;
    let torsoZ = -state.steer * 0.13;
    let rootY = 0;
    let rootScaleY = 1;

    switch (state.action) {
      case 'run':
      case 'idle':
        leftArmX = stride * 0.65;
        rightArmX = -stride * 0.65;
        leftLegX = -stride * 0.78;
        rightLegX = stride * 0.78;
        rootY = Math.abs(stride) * 0.035;
        torsoX = 0.08;
        break;
      case 'jump':
        leftArmX = -0.55;
        rightArmX = -0.55;
        leftLegX = 0.4;
        rightLegX = -0.22;
        torsoX = -0.08;
        rootScaleY = 1.06;
        break;
      case 'fall':
        leftArmX = 0.86;
        rightArmX = 0.86;
        leftLegX = -0.28;
        rightLegX = -0.28;
        torsoX = 0.2;
        rootScaleY = 0.96;
        break;
      case 'grapple':
        leftArmX = -2.28;
        rightArmX = -1.45;
        leftLegX = -0.35 + stride * 0.12;
        rightLegX = 0.55 - stride * 0.12;
        torsoX = -0.12;
        torsoZ *= 1.8;
        break;
      case 'dash':
        leftArmX = 1.32;
        rightArmX = 1.32;
        leftLegX = -0.2;
        rightLegX = -0.2;
        torsoX = 0.42;
        rootScaleY = 0.86;
        break;
      case 'wall-run':
        leftArmX = stride * 0.35;
        rightArmX = -stride * 0.35;
        leftLegX = -stride * 0.55;
        rightLegX = stride * 0.55;
        torsoX = 0.1;
        torsoZ = state.steer >= 0 ? -0.4 : 0.4;
        break;
      case 'rail':
        leftArmX = -0.95;
        rightArmX = -0.95;
        leftLegX = 0.52;
        rightLegX = 0.52;
        torsoX = 0.55;
        rootY = -0.14;
        rootScaleY = 0.88;
        break;
      case 'slide':
        leftArmX = 0.78;
        rightArmX = 0.9;
        leftLegX = 1.18;
        rightLegX = -0.35;
        torsoX = 0.82;
        rootY = -0.28;
        rootScaleY = 0.76;
        break;
      case 'land':
        leftArmX = 0.5;
        rightArmX = 0.5;
        leftLegX = 0.65;
        rightLegX = 0.65;
        torsoX = 0.52;
        rootY = -0.2;
        rootScaleY = 0.82;
        break;
      case 'respawn':
        leftArmX = -0.45;
        rightArmX = -0.45;
        leftLegX = 0.25;
        rightLegX = 0.25;
        rootScaleY = 0.9;
        break;
    }

    if (this.landingKick > 0) {
      rootY -= this.landingKick * 0.22;
      rootScaleY -= this.landingKick * 0.14;
      this.landingKick = Math.max(0, this.landingKick - safeDt * 4.2);
    }

    this.rig.leftArm.rotation.x = damp(this.rig.leftArm.rotation.x, leftArmX, 14, safeDt);
    this.rig.rightArm.rotation.x = damp(this.rig.rightArm.rotation.x, rightArmX, 14, safeDt);
    this.rig.leftLeg.rotation.x = damp(this.rig.leftLeg.rotation.x, leftLegX, 15, safeDt);
    this.rig.rightLeg.rotation.x = damp(this.rig.rightLeg.rotation.x, rightLegX, 15, safeDt);
    this.rig.torso.rotation.x = damp(this.rig.torso.rotation.x, torsoX, 11, safeDt);
    this.rig.torso.rotation.z = damp(this.rig.torso.rotation.z, torsoZ, 10, safeDt);
    this.rig.root.position.y = damp(this.rig.root.position.y, rootY, 18, safeDt);
    this.rig.root.scale.y = damp(this.rig.root.scale.y, rootScaleY, 16, safeDt);
    this.rig.root.scale.x = damp(this.rig.root.scale.x, 2 - rootScaleY, 16, safeDt);
    this.rig.head.rotation.y = damp(this.rig.head.rotation.y, -state.steer * 0.16, 8, safeDt);
  }
}
