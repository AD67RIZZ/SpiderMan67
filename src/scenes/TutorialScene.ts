const STEPS = [
  "Steer through the guide gates",
  "Jump onto the next rooftop",
  "Hold grapple to catch the highlighted anchor",
  "Release at speed to launch forward",
  "Use your air dash",
  "Run beside the bright wall",
  "Collect the energy shard trail",
  "Dodge the warning hazard",
  "Reach the checkpoint",
] as const;

export class TutorialScene {
  private stepIndex = 0;

  reset(): void {
    this.stepIndex = 0;
  }

  advance(): void {
    this.stepIndex = Math.min(this.stepIndex + 1, STEPS.length - 1);
  }

  setStep(index: number): void {
    this.stepIndex = Math.max(0, Math.min(index, STEPS.length - 1));
  }

  get step(): number {
    return this.stepIndex;
  }

  get prompt(): string {
    return STEPS[this.stepIndex] ?? STEPS[0];
  }

  get complete(): boolean {
    return this.stepIndex === STEPS.length - 1;
  }
}
