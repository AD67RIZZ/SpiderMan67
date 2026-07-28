import type { RaceSummary } from "../game/GameState";

export class ResultsScene {
  summary: RaceSummary | null = null;

  show(summary: RaceSummary): void {
    this.summary = summary;
  }

  clear(): void {
    this.summary = null;
  }
}
