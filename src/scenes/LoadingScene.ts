export class LoadingScene {
  readonly name = "loading";
  progress = 0;

  setProgress(value: number): void {
    this.progress = Math.max(0, Math.min(1, value));
  }
}
