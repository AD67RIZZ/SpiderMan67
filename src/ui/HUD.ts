import { formatCompactNumber, formatTime } from "../utils/MathUtils";

export interface HUDPowerUp {
  type: "overdrive" | "shield" | "magnet";
  label?: string;
  remaining: number;
  duration?: number;
}

export interface HUDData {
  score: number;
  distance: number;
  placement: number;
  playerCount: number;
  checkpoint: number;
  totalCheckpoints: number;
  combo: number;
  comboProgress?: number;
  dashAvailable: boolean;
  speed: number;
  ping: number | null;
  timer: number;
  powerUps: HUDPowerUp[];
}

export interface LeaderboardEntry {
  id?: string;
  name: string;
  color: string;
  placement: number;
  score: number;
  checkpoint?: number;
  finished?: boolean;
  local?: boolean;
}

export type HUDNoticeKind = "info" | "checkpoint" | "placement" | "danger" | "combo";

const INITIAL_DATA: HUDData = {
  score: 0,
  distance: 0,
  placement: 1,
  playerCount: 1,
  checkpoint: 0,
  totalCheckpoints: 0,
  combo: 1,
  comboProgress: 0,
  dashAvailable: true,
  speed: 0,
  ping: null,
  timer: 0,
  powerUps: [],
};

/**
 * In-race heads-up display. It updates existing nodes rather than rebuilding
 * the interface every frame, and owns the hold-Tab leaderboard behaviour.
 */
export class HUD {
  public readonly element: HTMLElement;
  private readonly scoreValue: HTMLElement;
  private readonly distanceValue: HTMLElement;
  private readonly placementValue: HTMLElement;
  private readonly placementTotal: HTMLElement;
  private readonly checkpointValue: HTMLElement;
  private readonly comboValue: HTMLElement;
  private readonly comboMeter: HTMLElement;
  private readonly dashValue: HTMLElement;
  private readonly speedValue: HTMLElement;
  private readonly pingValue: HTMLElement;
  private readonly timerValue: HTMLElement;
  private readonly powerUps: HTMLElement;
  private readonly noticeLayer: HTMLElement;
  private readonly tutorialElement: HTMLElement;
  private readonly countdownElement: HTMLElement;
  private readonly leaderboardElement: HTMLElement;
  private readonly dangerEdge: HTMLElement;
  private readonly scorePopups: HTMLElement;
  private data: HUDData = { ...INITIAL_DATA };
  private leaderboard: LeaderboardEntry[] = [];
  private visible = false;
  private tabHeld = false;

  public constructor(parent: HTMLElement) {
    this.element = document.createElement("div");
    this.element.className = "game-hud is-hidden";
    this.element.setAttribute("aria-label", "Race information");

    const top = document.createElement("div");
    top.className = "hud-top";

    const score = hudStat("Score", "0", "hud-score");
    this.scoreValue = score.value;
    const placement = hudStat("Place", "1st", "hud-placement");
    this.placementValue = placement.value;
    this.placementTotal = document.createElement("small");
    this.placementTotal.textContent = "/ 1";
    placement.value.append(this.placementTotal);

    const timer = hudStat("Time", "0:00.0", "hud-timer");
    this.timerValue = timer.value;
    const ping = hudStat("Ping", "—", "hud-ping");
    this.pingValue = ping.value;
    top.append(score.element, placement.element, timer.element, ping.element);

    const left = document.createElement("div");
    left.className = "hud-left";
    const distance = hudStat("Distance", "0 m", "hud-distance");
    this.distanceValue = distance.value;
    const checkpoint = hudStat("Checkpoint", "0 / 0", "hud-checkpoint");
    this.checkpointValue = checkpoint.value;
    left.append(distance.element, checkpoint.element);

    const bottom = document.createElement("div");
    bottom.className = "hud-bottom";
    const combo = document.createElement("section");
    combo.className = "combo-panel";
    const comboLabel = document.createElement("span");
    comboLabel.textContent = "FLOW COMBO";
    this.comboValue = document.createElement("strong");
    this.comboValue.textContent = "1.0×";
    const meter = document.createElement("div");
    meter.className = "combo-meter";
    this.comboMeter = document.createElement("i");
    meter.append(this.comboMeter);
    combo.append(comboLabel, this.comboValue, meter);

    const motion = document.createElement("section");
    motion.className = "motion-panel";
    const dash = hudStat("Dash", "READY", "hud-dash");
    this.dashValue = dash.value;
    const speed = hudStat("Speed", "0", "hud-speed");
    this.speedValue = speed.value;
    const speedUnit = document.createElement("small");
    speedUnit.textContent = " km/h";
    this.speedValue.append(speedUnit);
    motion.append(dash.element, speed.element);
    bottom.append(combo, motion);

    this.powerUps = document.createElement("div");
    this.powerUps.className = "powerup-stack";
    this.powerUps.setAttribute("aria-label", "Active power-ups");

    this.noticeLayer = document.createElement("div");
    this.noticeLayer.className = "hud-notices";
    this.noticeLayer.setAttribute("aria-live", "polite");
    this.noticeLayer.setAttribute("aria-atomic", "false");

    this.tutorialElement = document.createElement("div");
    this.tutorialElement.className = "tutorial-prompt is-hidden";
    this.tutorialElement.setAttribute("role", "status");

    this.countdownElement = document.createElement("div");
    this.countdownElement.className = "race-countdown is-hidden";
    this.countdownElement.setAttribute("aria-live", "assertive");

    this.leaderboardElement = document.createElement("section");
    this.leaderboardElement.className = "hud-leaderboard is-hidden";
    this.leaderboardElement.setAttribute("aria-label", "Match leaderboard");
    this.leaderboardElement.setAttribute("aria-hidden", "true");

    this.dangerEdge = document.createElement("div");
    this.dangerEdge.className = "fall-warning-edge";
    this.dangerEdge.setAttribute("aria-hidden", "true");
    this.scorePopups = document.createElement("div");
    this.scorePopups.className = "score-popup-layer";
    this.scorePopups.setAttribute("aria-hidden", "true");

    const tabHint = document.createElement("div");
    tabHint.className = "leaderboard-hint";
    tabHint.innerHTML = "<kbd>Tab</kbd><span>Leaderboard</span>";

    this.element.append(
      top,
      left,
      bottom,
      this.powerUps,
      this.noticeLayer,
      this.tutorialElement,
      this.countdownElement,
      this.leaderboardElement,
      this.dangerEdge,
      this.scorePopups,
      tabHint,
    );
    parent.append(this.element);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  public setVisible(visible: boolean): void {
    this.visible = visible;
    this.element.classList.toggle("is-hidden", !visible);
    if (!visible) this.setLeaderboardVisible(false);
  }

  public show(): void {
    this.setVisible(true);
  }

  public hide(): void {
    this.setVisible(false);
  }

  public update(data: Partial<HUDData>): void {
    const previousPlacement = this.data.placement;
    this.data = { ...this.data, ...data };
    const state = this.data;
    this.scoreValue.textContent = formatCompactNumber(state.score);
    this.distanceValue.textContent = `${Math.max(0, Math.floor(state.distance))} m`;
    this.placementValue.firstChild?.remove();
    this.placementValue.prepend(document.createTextNode(`${state.placement}${ordinalSuffix(state.placement)}`));
    this.placementTotal.textContent = `/ ${Math.max(1, state.playerCount)}`;
    this.checkpointValue.textContent = `${Math.max(0, state.checkpoint)} / ${Math.max(0, state.totalCheckpoints)}`;
    this.comboValue.textContent = `${Math.max(1, state.combo).toFixed(1)}×`;
    this.comboMeter.style.width = `${Math.max(0, Math.min(1, state.comboProgress ?? state.combo % 1)) * 100}%`;
    this.element.style.setProperty("--combo-level", String(Math.min(1, (state.combo - 1) / 5)));
    this.dashValue.textContent = state.dashAvailable ? "READY" : "CHARGING";
    this.dashValue.parentElement?.classList.toggle("unavailable", !state.dashAvailable);
    this.speedValue.firstChild?.remove();
    this.speedValue.prepend(document.createTextNode(String(Math.max(0, Math.round(state.speed)))));
    this.pingValue.textContent = state.ping === null ? "—" : `${Math.max(0, Math.round(state.ping))} ms`;
    this.pingValue.parentElement?.classList.toggle("warning", state.ping !== null && state.ping > 180);
    this.timerValue.textContent = formatTime(state.timer);
    this.renderPowerUps();

    if (previousPlacement !== state.placement && previousPlacement > 0) {
      this.notice(
        state.placement < previousPlacement
          ? `Moved up to ${state.placement}${ordinalSuffix(state.placement)}!`
          : `Now ${state.placement}${ordinalSuffix(state.placement)}`,
        "placement",
        1800,
      );
    }
  }

  public setLeaderboard(entries: LeaderboardEntry[]): void {
    this.leaderboard = [...entries].sort((a, b) => a.placement - b.placement);
    this.renderLeaderboard();
  }

  public setLeaderboardVisible(visible: boolean): void {
    const next = visible && this.visible;
    this.leaderboardElement.classList.toggle("is-hidden", !next);
    this.leaderboardElement.setAttribute("aria-hidden", String(!next));
  }

  public notice(message: string, kind: HUDNoticeKind = "info", durationMs = 2200): void {
    const notice = document.createElement("div");
    notice.className = `hud-notice ${kind}`;
    notice.textContent = message;
    this.noticeLayer.append(notice);
    requestAnimationFrame(() => notice.classList.add("is-visible"));
    window.setTimeout(() => {
      notice.classList.remove("is-visible");
      window.setTimeout(() => notice.remove(), 250);
    }, Math.max(500, durationMs));
  }

  public banner(title: string, subtitle?: string, durationMs = 2400): void {
    const banner = document.createElement("div");
    banner.className = "checkpoint-banner";
    const heading = document.createElement("strong");
    heading.textContent = title;
    banner.append(heading);
    if (subtitle) {
      const copy = document.createElement("span");
      copy.textContent = subtitle;
      banner.append(copy);
    }
    this.noticeLayer.append(banner);
    requestAnimationFrame(() => banner.classList.add("is-visible"));
    window.setTimeout(() => {
      banner.classList.remove("is-visible");
      window.setTimeout(() => banner.remove(), 350);
    }, durationMs);
  }

  public showTutorial(
    title: string,
    instruction: string,
    options: { key?: string; progress?: number } = {},
  ): void {
    this.tutorialElement.replaceChildren();
    this.tutorialElement.classList.remove("is-hidden");
    const marker = document.createElement("span");
    marker.className = "tutorial-marker";
    marker.textContent = options.key ?? "TIP";
    const body = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = title;
    const copy = document.createElement("span");
    copy.textContent = instruction;
    body.append(heading, copy);
    this.tutorialElement.append(marker, body);
    if (options.progress !== undefined) {
      const progress = document.createElement("i");
      progress.style.width = `${Math.max(0, Math.min(1, options.progress)) * 100}%`;
      this.tutorialElement.append(progress);
    }
  }

  public hideTutorial(): void {
    this.tutorialElement.classList.add("is-hidden");
  }

  public showCountdown(value: number | "GO" | null): void {
    if (value === null) {
      this.countdownElement.classList.add("is-hidden");
      return;
    }
    this.countdownElement.textContent = typeof value === "number" ? String(Math.max(0, Math.ceil(value))) : value;
    this.countdownElement.classList.remove("is-hidden");
    this.countdownElement.classList.remove("pulse");
    void this.countdownElement.offsetWidth;
    this.countdownElement.classList.add("pulse");
    if (value === "GO") {
      window.setTimeout(() => this.countdownElement.classList.add("is-hidden"), 900);
    }
  }

  public setFallWarning(intensity: number): void {
    const level = Math.max(0, Math.min(1, intensity));
    this.dangerEdge.style.opacity = String(level);
    this.dangerEdge.classList.toggle("is-dangerous", level > 0.55);
  }

  public scorePopup(
    points: number,
    label: string,
    screenPosition: { x: number; y: number } = { x: 50, y: 45 },
  ): void {
    const popup = document.createElement("span");
    popup.className = "score-popup";
    popup.style.left = `${Math.max(4, Math.min(96, screenPosition.x))}%`;
    popup.style.top = `${Math.max(8, Math.min(88, screenPosition.y))}%`;
    popup.textContent = `${points >= 0 ? "+" : ""}${Math.round(points)} ${label}`.trim();
    this.scorePopups.append(popup);
    popup.addEventListener("animationend", () => popup.remove(), { once: true });
    window.setTimeout(() => popup.remove(), 1800);
  }

  private renderPowerUps(): void {
    this.powerUps.replaceChildren();
    for (const powerUp of this.data.powerUps) {
      const chip = document.createElement("div");
      chip.className = `powerup-chip ${powerUp.type}`;
      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = powerUp.type === "overdrive" ? "»" : powerUp.type === "shield" ? "⬡" : "◎";
      const body = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent =
        powerUp.label ??
        (powerUp.type === "overdrive"
          ? "Overdrive"
          : powerUp.type === "shield"
            ? "Shield"
            : "Magnet Pulse");
      const time = document.createElement("span");
      time.textContent = `${Math.max(0, powerUp.remaining).toFixed(1)}s`;
      const meter = document.createElement("i");
      const duration =
        powerUp.duration !== undefined && powerUp.duration > 0
          ? powerUp.duration
          : Math.max(1, powerUp.remaining);
      meter.style.width = `${Math.max(0, Math.min(1, powerUp.remaining / duration)) * 100}%`;
      body.append(name, time, meter);
      chip.append(icon, body);
      this.powerUps.append(chip);
    }
  }

  private renderLeaderboard(): void {
    this.leaderboardElement.replaceChildren();
    const title = document.createElement("h2");
    title.textContent = "Skyline standings";
    const list = document.createElement("ol");
    for (const entry of this.leaderboard) {
      const row = document.createElement("li");
      if (entry.local) row.classList.add("is-local");
      const place = document.createElement("span");
      place.className = "leaderboard-place";
      place.textContent = `#${entry.placement}`;
      const color = document.createElement("i");
      color.style.setProperty("--player-color", entry.color);
      const name = document.createElement("strong");
      name.textContent = entry.name;
      const progress = document.createElement("span");
      progress.className = "leaderboard-progress";
      progress.textContent = entry.finished
        ? "FINISHED"
        : entry.checkpoint === undefined
          ? `${formatCompactNumber(entry.score)} pts`
          : `CP ${entry.checkpoint} · ${formatCompactNumber(entry.score)}`;
      row.append(place, color, name, progress);
      list.append(row);
    }
    const help = document.createElement("small");
    help.textContent = "Release Tab to return to the race";
    this.leaderboardElement.append(title, list, help);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Tab" || !this.visible) return;
    event.preventDefault();
    if (this.tabHeld) return;
    this.tabHeld = true;
    this.setLeaderboardVisible(true);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.key !== "Tab") return;
    this.tabHeld = false;
    this.setLeaderboardVisible(false);
  };

  private readonly onBlur = (): void => {
    this.tabHeld = false;
    this.setLeaderboardVisible(false);
  };

  public destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.element.remove();
  }
}

function hudStat(
  label: string,
  initialValue: string,
  className: string,
): { element: HTMLElement; value: HTMLElement } {
  const element = document.createElement("section");
  element.className = `hud-stat ${className}`;
  const labelElement = document.createElement("span");
  labelElement.textContent = label;
  const value = document.createElement("strong");
  value.textContent = initialValue;
  element.append(labelElement, value);
  return { element, value };
}

function ordinalSuffix(place: number): string {
  const value = Math.abs(Math.round(place));
  if (value % 100 >= 11 && value % 100 <= 13) return "th";
  if (value % 10 === 1) return "st";
  if (value % 10 === 2) return "nd";
  if (value % 10 === 3) return "rd";
  return "th";
}
