export interface GameLoopTarget {
  fixedUpdate(stepSeconds: number): void;
  render(interpolation: number, frameSeconds: number): void;
}

/**
 * Stable fixed-step simulation with independent rendering.
 * A short accumulator cap avoids a tab-resume "spiral of death".
 */
export class GameLoop {
  private animationFrame = 0;
  private previousTime = 0;
  private accumulator = 0;
  private running = false;

  constructor(
    private readonly target: GameLoopTarget,
    private readonly fixedStep = 1 / 60,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.previousTime = performance.now();
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    this.accumulator = 0;
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    const frameSeconds = Math.min((now - this.previousTime) / 1_000, 0.1);
    this.previousTime = now;
    this.accumulator += frameSeconds;

    let substeps = 0;
    while (this.accumulator >= this.fixedStep && substeps < 6) {
      this.target.fixedUpdate(this.fixedStep);
      this.accumulator -= this.fixedStep;
      substeps += 1;
    }
    if (substeps === 6) this.accumulator = 0;

    this.target.render(this.accumulator / this.fixedStep, frameSeconds);
    this.animationFrame = requestAnimationFrame(this.tick);
  };
}
