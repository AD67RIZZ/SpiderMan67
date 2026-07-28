export interface InputSnapshot {
  steer: number;
  forward: number;
  grapple: boolean;
  jump: boolean;
  dash: boolean;
  respawn: boolean;
  pause: boolean;
  leaderboard: boolean;
}

interface MobileInputSource {
  state?: {
    steer?: number;
    grapple?: boolean;
    jump?: boolean;
    dash?: boolean;
    pause?: boolean;
  };
  consumeJump?(): boolean;
  consumeDash?(): boolean;
  consumePause?(): boolean;
  consumeOneShots?(): { jump: boolean; dash: boolean; pause: boolean };
}

export class InputManager {
  private readonly down = new Set<string>();
  private jumpQueued = false;
  private dashQueued = false;
  private respawnQueued = false;
  private pauseQueued = false;
  private mouseGrapple = false;
  private mobile?: MobileInputSource;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp, { passive: false });
    canvas.addEventListener("pointerdown", this.onPointerDown, { passive: false });
    window.addEventListener("pointerup", this.onPointerUp, { passive: false });
    canvas.addEventListener("contextmenu", this.preventContextMenu);
  }

  setMobileSource(source: MobileInputSource | undefined): void {
    this.mobile = source;
  }

  snapshot(): InputSnapshot {
    const left = this.has("KeyA", "ArrowLeft");
    const right = this.has("KeyD", "ArrowRight");
    const forward = this.has("KeyW", "ArrowUp");
    const back = this.has("KeyS", "ArrowDown");
    const mobileState = this.mobile?.state;
    const mobileOneShots = this.mobile?.consumeOneShots?.();

    const snapshot: InputSnapshot = {
      steer: Math.max(-1, Math.min(1, Number(right) - Number(left) + (mobileState?.steer ?? 0))),
      forward: Number(forward) - Number(back),
      grapple: this.mouseGrapple || this.down.has("Space") || Boolean(mobileState?.grapple),
      jump:
        this.jumpQueued ||
        Boolean(mobileOneShots?.jump) ||
        Boolean(this.mobile?.consumeJump?.()) ||
        Boolean(mobileState?.jump),
      dash:
        this.dashQueued ||
        Boolean(mobileOneShots?.dash) ||
        Boolean(this.mobile?.consumeDash?.()) ||
        Boolean(mobileState?.dash),
      respawn: this.respawnQueued,
      pause:
        this.pauseQueued ||
        Boolean(mobileOneShots?.pause) ||
        Boolean(this.mobile?.consumePause?.()) ||
        Boolean(mobileState?.pause),
      leaderboard: this.down.has("Tab"),
    };

    this.jumpQueued = false;
    this.dashQueued = false;
    this.respawnQueued = false;
    this.pauseQueued = false;
    return snapshot;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("contextmenu", this.preventContextMenu);
  }

  private has(...codes: string[]): boolean {
    return codes.some((code) => this.down.has(code));
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    const firstPress = !this.down.has(event.code);
    this.down.add(event.code);
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(event.code)) {
      event.preventDefault();
    }
    if (!firstPress) return;
    if (event.code === "KeyW" || event.code === "ArrowUp") this.jumpQueued = true;
    if (event.code === "ShiftLeft" || event.code === "ShiftRight" || event.code === "KeyE") {
      this.dashQueued = true;
    }
    if (event.code === "KeyR") this.respawnQueued = true;
    if (event.code === "Escape" || event.code === "KeyP") this.pauseQueued = true;
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.down.delete(event.code);
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(event.code)) {
      event.preventDefault();
    }
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button === 0) {
      this.mouseGrapple = true;
      event.preventDefault();
    }
    if (event.button === 2) {
      this.dashQueued = true;
      event.preventDefault();
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.button === 0) this.mouseGrapple = false;
  };

  private readonly preventContextMenu = (event: Event): void => event.preventDefault();
}
