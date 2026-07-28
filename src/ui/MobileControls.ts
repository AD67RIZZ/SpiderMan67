import { hasTouchInput, vibrate } from "../utils/Device";
import { clamp } from "../utils/MathUtils";

export interface MobileControlState {
  /** Horizontal steering from -1 (left) to +1 (right). */
  steer: number;
  /** One-frame action; reset by consumeOneShots(). */
  jump: boolean;
  /** True for as long as the grapple control is held. */
  grapple: boolean;
  /** One-frame action; reset by consumeOneShots(). */
  dash: boolean;
  /** One-frame action; reset by consumeOneShots(). */
  pause: boolean;
}

export interface MobileControlsOptions {
  haptics?: boolean;
  onChange?: (state: Readonly<MobileControlState>) => void;
}

/**
 * Touch controls with a captured virtual joystick and independent multi-touch
 * action buttons. Touch capability is feature-detected rather than guessed
 * from the user-agent string.
 */
export class MobileControls {
  public readonly element: HTMLElement;
  public readonly state: MobileControlState = {
    steer: 0,
    jump: false,
    grapple: false,
    dash: false,
    pause: false,
  };

  private readonly joystick: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly grappleButton: HTMLButtonElement;
  private readonly jumpButton: HTMLButtonElement;
  private readonly dashButton: HTMLButtonElement;
  private readonly pauseButton: HTMLButtonElement;
  private steeringPointer: number | null = null;
  private grapplePointers = new Set<number>();
  private haptics: boolean;
  private visible = false;
  private requestedVisible = false;
  private readonly coarsePointerQuery = window.matchMedia("(pointer: coarse)");

  public constructor(
    parent: HTMLElement,
    private readonly options: MobileControlsOptions = {},
  ) {
    this.haptics = options.haptics ?? true;
    this.element = document.createElement("div");
    this.element.className = "mobile-controls is-hidden";
    this.element.setAttribute("aria-label", "Touch controls");

    const pauseWrap = document.createElement("div");
    pauseWrap.className = "mobile-top-controls";
    this.pauseButton = this.controlButton("Ⅱ", "Pause", "pause-control");
    pauseWrap.append(this.pauseButton);

    const steeringZone = document.createElement("div");
    steeringZone.className = "steering-zone";
    steeringZone.setAttribute("role", "group");
    steeringZone.setAttribute("aria-label", "Steering control");
    this.joystick = document.createElement("div");
    this.joystick.className = "virtual-stick-base";
    this.stick = document.createElement("div");
    this.stick.className = "virtual-stick-knob";
    const steerLabel = document.createElement("span");
    steerLabel.className = "control-caption";
    steerLabel.textContent = "STEER";
    this.joystick.append(this.stick);
    steeringZone.append(this.joystick, steerLabel);

    const actionZone = document.createElement("div");
    actionZone.className = "mobile-action-zone";
    this.grappleButton = this.controlButton("GRAPPLE", "Hold to grapple, release to detach", "grapple-control");
    this.jumpButton = this.controlButton("JUMP", "Jump", "jump-control");
    this.dashButton = this.controlButton("DASH", "Air dash", "dash-control");
    actionZone.append(this.grappleButton, this.jumpButton, this.dashButton);
    this.element.append(pauseWrap, steeringZone, actionZone);
    parent.append(this.element);

    this.joystick.addEventListener("pointerdown", this.onSteerStart);
    this.joystick.addEventListener("pointermove", this.onSteerMove);
    this.joystick.addEventListener("pointerup", this.onSteerEnd);
    this.joystick.addEventListener("pointercancel", this.onSteerEnd);
    this.joystick.addEventListener("lostpointercapture", this.onSteerEnd);
    this.grappleButton.addEventListener("pointerdown", this.onGrappleStart);
    this.grappleButton.addEventListener("pointerup", this.onGrappleEnd);
    this.grappleButton.addEventListener("pointercancel", this.onGrappleEnd);
    this.grappleButton.addEventListener("lostpointercapture", this.onGrappleEnd);
    this.jumpButton.addEventListener("pointerdown", this.onJump);
    this.dashButton.addEventListener("pointerdown", this.onDash);
    this.pauseButton.addEventListener("pointerdown", this.onPause);
    this.element.addEventListener("contextmenu", this.preventDefault);
    this.element.addEventListener("touchmove", this.preventDefault, { passive: false });
    window.addEventListener("blur", this.releaseAll);
    this.coarsePointerQuery.addEventListener("change", this.onInputCapabilityChange);

    this.setVisible(hasTouchInput());
  }

  public get supported(): boolean {
    return hasTouchInput();
  }

  public setVisible(visible: boolean): void {
    this.requestedVisible = visible;
    this.visible = visible && this.supported;
    this.element.classList.toggle("is-hidden", !this.visible);
    this.element.setAttribute("aria-hidden", String(!this.visible));
    if (!this.visible) this.releaseAll();
  }

  public setHaptics(enabled: boolean): void {
    this.haptics = enabled;
  }

  /**
   * Read and clear jump/dash/pause while leaving held grapple and steering
   * untouched. Call once per simulation tick.
   */
  public consumeOneShots(): Pick<MobileControlState, "jump" | "dash" | "pause"> {
    const actions = {
      jump: this.state.jump,
      dash: this.state.dash,
      pause: this.state.pause,
    };
    this.state.jump = false;
    this.state.dash = false;
    this.state.pause = false;
    return actions;
  }

  /** Compatibility helpers for input managers that consume actions separately. */
  public consumeJump(): boolean {
    const value = this.state.jump;
    this.state.jump = false;
    return value;
  }

  public consumeDash(): boolean {
    const value = this.state.dash;
    this.state.dash = false;
    return value;
  }

  public consumePause(): boolean {
    const value = this.state.pause;
    this.state.pause = false;
    return value;
  }

  public setDashAvailable(available: boolean): void {
    this.dashButton.disabled = !available;
    this.dashButton.classList.toggle("is-cooling", !available);
  }

  private controlButton(label: string, accessibleName: string, className: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mobile-control-button ${className}`;
    button.textContent = label;
    button.setAttribute("aria-label", accessibleName);
    button.tabIndex = -1;
    return button;
  }

  private readonly onSteerStart = (event: PointerEvent): void => {
    if (this.steeringPointer !== null) return;
    event.preventDefault();
    this.steeringPointer = event.pointerId;
    this.joystick.setPointerCapture(event.pointerId);
    this.joystick.classList.add("is-active");
    this.updateSteer(event);
    vibrate(8, this.haptics);
  };

  private readonly onSteerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.steeringPointer) return;
    event.preventDefault();
    this.updateSteer(event);
  };

  private readonly onSteerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.steeringPointer) return;
    event.preventDefault();
    this.steeringPointer = null;
    this.state.steer = 0;
    this.stick.style.transform = "translate3d(0, 0, 0)";
    this.joystick.classList.remove("is-active");
    this.emit();
  };

  private updateSteer(event: PointerEvent): void {
    const bounds = this.joystick.getBoundingClientRect();
    const radius = Math.max(1, bounds.width * 0.36);
    const x = clamp(event.clientX - (bounds.left + bounds.width / 2), -radius, radius);
    const y = clamp(event.clientY - (bounds.top + bounds.height / 2), -radius, radius);
    this.state.steer = Math.abs(x / radius) < 0.08 ? 0 : x / radius;
    this.stick.style.transform = `translate3d(${x}px, ${y * 0.45}px, 0)`;
    this.emit();
  }

  private readonly onGrappleStart = (event: PointerEvent): void => {
    event.preventDefault();
    this.grapplePointers.add(event.pointerId);
    this.grappleButton.setPointerCapture(event.pointerId);
    if (!this.state.grapple) {
      this.state.grapple = true;
      this.grappleButton.classList.add("is-active");
      vibrate(12, this.haptics);
      this.emit();
    }
  };

  private readonly onGrappleEnd = (event: PointerEvent): void => {
    this.grapplePointers.delete(event.pointerId);
    if (this.grapplePointers.size > 0) return;
    this.state.grapple = false;
    this.grappleButton.classList.remove("is-active");
    this.emit();
  };

  private readonly onJump = (event: PointerEvent): void => {
    event.preventDefault();
    this.state.jump = true;
    this.pulse(this.jumpButton);
    vibrate(10, this.haptics);
    this.emit();
  };

  private readonly onDash = (event: PointerEvent): void => {
    event.preventDefault();
    if (this.dashButton.disabled) return;
    this.state.dash = true;
    this.pulse(this.dashButton);
    vibrate([12, 18, 18], this.haptics);
    this.emit();
  };

  private readonly onPause = (event: PointerEvent): void => {
    event.preventDefault();
    this.state.pause = true;
    this.pulse(this.pauseButton);
    vibrate(8, this.haptics);
    this.emit();
  };

  private pulse(element: HTMLElement): void {
    element.classList.remove("is-pressed");
    void element.offsetWidth;
    element.classList.add("is-pressed");
    window.setTimeout(() => element.classList.remove("is-pressed"), 130);
  }

  private emit(): void {
    this.options.onChange?.(this.state);
  }

  private readonly preventDefault = (event: Event): void => event.preventDefault();

  private readonly onInputCapabilityChange = (): void => {
    this.setVisible(this.requestedVisible || hasTouchInput());
  };

  private readonly releaseAll = (): void => {
    this.steeringPointer = null;
    this.grapplePointers.clear();
    this.state.steer = 0;
    this.state.grapple = false;
    this.state.jump = false;
    this.state.dash = false;
    this.state.pause = false;
    this.stick.style.transform = "translate3d(0, 0, 0)";
    this.joystick.classList.remove("is-active");
    this.grappleButton.classList.remove("is-active");
    this.emit();
  };

  public dispose(): void {
    this.joystick.removeEventListener("pointerdown", this.onSteerStart);
    this.joystick.removeEventListener("pointermove", this.onSteerMove);
    this.joystick.removeEventListener("pointerup", this.onSteerEnd);
    this.joystick.removeEventListener("pointercancel", this.onSteerEnd);
    this.joystick.removeEventListener("lostpointercapture", this.onSteerEnd);
    this.grappleButton.removeEventListener("pointerdown", this.onGrappleStart);
    this.grappleButton.removeEventListener("pointerup", this.onGrappleEnd);
    this.grappleButton.removeEventListener("pointercancel", this.onGrappleEnd);
    this.grappleButton.removeEventListener("lostpointercapture", this.onGrappleEnd);
    this.jumpButton.removeEventListener("pointerdown", this.onJump);
    this.dashButton.removeEventListener("pointerdown", this.onDash);
    this.pauseButton.removeEventListener("pointerdown", this.onPause);
    this.element.removeEventListener("contextmenu", this.preventDefault);
    this.element.removeEventListener("touchmove", this.preventDefault);
    window.removeEventListener("blur", this.releaseAll);
    this.coarsePointerQuery.removeEventListener("change", this.onInputCapabilityChange);
    this.element.remove();
  }

  public destroy(): void {
    this.dispose();
  }
}
