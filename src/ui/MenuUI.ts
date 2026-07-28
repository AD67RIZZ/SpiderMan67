import { LobbyUI, type LobbyState } from "./LobbyUI";
import { SettingsPanel } from "./SettingsPanel";
import { loadRecords, loadSettings, type GameSettings } from "../utils/Storage";

export type MenuScreen =
  | "hidden"
  | "loading"
  | "main"
  | "menu"
  | "multiplayer"
  | "private-room"
  | "lobby"
  | "how-to"
  | "credits"
  | "settings"
  | "pause"
  | "results";

export type MenuAction =
  | "quick-match"
  | "private-room"
  | "create-private"
  | "join-private"
  | "solo-practice"
  | "tutorial"
  | "settings"
  | "how-to"
  | "credits"
  | "back"
  | "ready"
  | "leave-lobby"
  | "copy-room-code"
  | "resume"
  | "restart"
  | "play-again"
  | "return-lobby"
  | "main-menu"
  | "retry"
  | "dismiss"
  | "settings-change";

export interface MenuActionPayload {
  roomCode?: string;
  settings?: GameSettings;
  ready?: boolean;
}

export interface MenuUICallbacks {
  onAction?: (action: MenuAction, payload?: MenuActionPayload) => void;
}

export interface LoadingScreenData {
  progress?: number;
  message?: string;
}

export interface MainMenuData {
  bestScore?: number;
  online?: boolean;
  connectionText?: string;
}

export interface ResultsPlayer {
  id?: string;
  name: string;
  color: string;
  placement: number;
  score: number;
  finishTime?: number | null;
}

export interface ResultsData {
  multiplayer?: boolean;
  placement: number;
  score: number;
  finishTime?: number | null;
  distance: number;
  maxCombo: number;
  shards: number;
  drones: number;
  crashes: number;
  pingSummary?: string;
  rank?: string;
  players?: ResultsPlayer[];
  roomActive?: boolean;
}

export interface MenuScreenData {
  loading?: LoadingScreenData;
  main?: MainMenuData;
  lobby?: LobbyState;
  results?: ResultsData;
  pausedByVisibility?: boolean;
}

interface OverlayOptions {
  title: string;
  message: string;
  actions: Array<{ label: string; action: MenuAction; primary?: boolean }>;
}

/**
 * Complete DOM menu shell. `show()` swaps one screen without reloading the
 * page; all user intent is returned through one typed `onAction` callback.
 */
export class MenuUI {
  public readonly element: HTMLElement;
  public readonly overlayElement: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly screenContent: HTMLElement;
  private currentScreen: MenuScreen = "hidden";
  private currentData: MenuScreenData = {};
  private lobbyUI?: LobbyUI;
  private settingsPanel?: SettingsPanel;
  private destroyed = false;

  public constructor(
    parent: HTMLElement,
    private callbacks: MenuUICallbacks = {},
  ) {
    this.element = document.createElement("div");
    this.element.className = "menu-ui is-hidden";
    this.element.setAttribute("aria-live", "polite");

    const backdrop = document.createElement("div");
    backdrop.className = "menu-backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    this.panel = document.createElement("main");
    this.panel.className = "menu-panel";
    this.panel.tabIndex = -1;
    this.screenContent = document.createElement("div");
    this.screenContent.className = "menu-screen";
    this.panel.append(this.screenContent);
    this.element.append(backdrop, this.panel);

    this.overlayElement = document.createElement("div");
    this.overlayElement.className = "game-dialog-layer is-hidden";
    this.overlayElement.setAttribute("role", "dialog");
    this.overlayElement.setAttribute("aria-modal", "true");

    parent.append(this.element, this.overlayElement);
    window.addEventListener("keydown", this.onKeyDown);
  }

  public setCallbacks(callbacks: MenuUICallbacks): void {
    this.callbacks = callbacks;
  }

  public get screen(): MenuScreen {
    return this.currentScreen;
  }

  public show(screen: MenuScreen, data: MenuScreenData = {}): void {
    if (this.destroyed) return;
    this.currentScreen = screen;
    this.currentData = { ...this.currentData, ...data };
    this.cleanupEmbeddedUI();
    this.element.classList.toggle("is-hidden", screen === "hidden");
    this.element.dataset.screen = screen;
    this.screenContent.replaceChildren();

    if (screen === "hidden") return;
    switch (screen) {
      case "loading":
        this.renderLoading(this.currentData.loading);
        break;
      case "main":
      case "menu":
        this.renderMain(this.currentData.main);
        break;
      case "multiplayer":
        this.renderMultiplayer();
        break;
      case "private-room":
        this.renderPrivateRoom();
        break;
      case "lobby":
        this.renderLobby(this.currentData.lobby);
        break;
      case "how-to":
        this.renderHowTo();
        break;
      case "credits":
        this.renderCredits();
        break;
      case "settings":
        this.renderSettings();
        break;
      case "pause":
        this.renderPause(this.currentData.pausedByVisibility === true);
        break;
      case "results":
        this.renderResults(this.currentData.results);
        break;
    }
    requestAnimationFrame(() => {
      const preferred = this.screenContent.querySelector<HTMLElement>("[data-autofocus], button, input");
      (preferred ?? this.panel).focus({ preventScroll: true });
    });
  }

  public hide(): void {
    this.show("hidden");
  }

  public showMainMenu(data: MainMenuData = {}): void {
    this.show("main", { main: data });
  }

  public showPause(pausedByVisibility = false): void {
    this.show("pause", { pausedByVisibility });
  }

  public showResults(results: ResultsData): void {
    this.show("results", { results });
  }

  public showLobby(state: LobbyState): void {
    this.show("lobby", { lobby: state });
  }

  public updateLoading(progress: number, message?: string): void {
    const data = { progress, message: message ?? this.currentData.loading?.message };
    this.currentData.loading = data;
    if (this.currentScreen !== "loading") return;
    const bar = this.screenContent.querySelector<HTMLElement>(".loading-fill");
    const track = this.screenContent.querySelector<HTMLElement>(".loading-track");
    const status = this.screenContent.querySelector<HTMLElement>(".loading-message");
    const safeProgress = Math.max(0, Math.min(1, progress));
    if (bar) bar.style.width = `${safeProgress * 100}%`;
    track?.setAttribute("aria-valuenow", String(Math.round(safeProgress * 100)));
    if (status && message) status.textContent = message;
  }

  public updateLobby(state: LobbyState): void {
    this.currentData.lobby = state;
    if (this.currentScreen === "lobby") this.lobbyUI?.update(state);
  }

  public setOnlineStatus(online: boolean, text?: string): void {
    this.currentData.main = {
      ...this.currentData.main,
      online,
      connectionText: text,
    };
    if (this.currentScreen !== "main") return;
    const status = this.screenContent.querySelector<HTMLElement>(".connection-chip");
    if (!status) return;
    status.classList.toggle("online", online);
    status.classList.toggle("offline", !online);
    const label = status.querySelector<HTMLElement>("span:last-child");
    if (label) label.textContent = text ?? (online ? "Multiplayer online" : "Solo still available");
  }

  public showConnectionLost(message = "The multiplayer link dropped. We’ll keep trying for a moment."): void {
    this.showOverlay({
      title: "Signal lost",
      message,
      actions: [
        { label: "Retry connection", action: "retry", primary: true },
        { label: "Solo practice", action: "solo-practice" },
        { label: "Main menu", action: "main-menu" },
      ],
    });
  }

  public showError(
    title: string,
    message: string,
    options: { retry?: boolean; solo?: boolean; menu?: boolean } = {
      retry: true,
      solo: true,
      menu: true,
    },
  ): void {
    const actions: OverlayOptions["actions"] = [];
    if (options.retry) actions.push({ label: "Try again", action: "retry", primary: true });
    if (options.solo) actions.push({ label: "Solo practice", action: "solo-practice" });
    if (options.menu) actions.push({ label: "Main menu", action: "main-menu" });
    if (actions.length === 0) actions.push({ label: "Close", action: "dismiss", primary: true });
    this.showOverlay({ title, message, actions });
  }

  public showOverlay(options: OverlayOptions): void {
    this.overlayElement.replaceChildren();
    this.overlayElement.classList.remove("is-hidden");
    const card = document.createElement("section");
    card.className = "game-dialog";
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow danger";
    eyebrow.textContent = "SYSTEM NOTICE";
    const title = document.createElement("h2");
    title.textContent = options.title;
    const copy = document.createElement("p");
    copy.className = "dialog-copy";
    copy.textContent = options.message;
    const actions = document.createElement("div");
    actions.className = "menu-actions";
    for (const option of options.actions) {
      actions.append(
        this.actionButton(option.label, option.action, option.primary ? "primary" : "secondary", undefined, true),
      );
    }
    card.append(eyebrow, title, copy, actions);
    this.overlayElement.append(card);
    requestAnimationFrame(() =>
      this.overlayElement.querySelector<HTMLElement>("button")?.focus({ preventScroll: true }),
    );
  }

  public hideOverlay(): void {
    this.overlayElement.classList.add("is-hidden");
    this.overlayElement.replaceChildren();
  }

  public setRotateDeviceVisible(visible: boolean): void {
    document.documentElement.classList.toggle("show-rotate-device", visible);
    let rotate = document.querySelector<HTMLElement>(".rotate-device-overlay");
    if (!rotate && visible) {
      rotate = document.createElement("aside");
      rotate.className = "rotate-device-overlay";
      rotate.setAttribute("role", "status");
      rotate.innerHTML =
        '<div class="rotate-phone" aria-hidden="true">↻</div><strong>Turn for the skyline</strong><span>Rotate your device to landscape for the best controls.</span>';
      document.body.append(rotate);
    }
    rotate?.classList.toggle("is-visible", visible);
  }

  private renderLoading(data: LoadingScreenData = {}): void {
    const hero = this.hero("SYNCING SKYLINE", "Neon Grapple Rush", "Charging grapples and mapping rooftops…");
    hero.classList.add("loading-hero");
    const spinner = document.createElement("div");
    spinner.className = "neon-orbit";
    spinner.setAttribute("aria-hidden", "true");
    const track = document.createElement("div");
    track.className = "loading-track";
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", "Game loading progress");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute(
      "aria-valuenow",
      String(Math.round(Math.max(0, Math.min(1, data.progress ?? 0)) * 100)),
    );
    const fill = document.createElement("div");
    fill.className = "loading-fill";
    fill.style.width = `${Math.max(0, Math.min(1, data.progress ?? 0)) * 100}%`;
    track.append(fill);
    const message = document.createElement("p");
    message.className = "loading-message";
    message.textContent = data.message ?? "Starting the neon grid…";
    message.setAttribute("role", "status");
    hero.prepend(spinner);
    hero.append(track, message);
    this.screenContent.append(hero);
  }

  private renderMain(data: MainMenuData = {}): void {
    const records = loadRecords();
    const hero = this.hero(
      "ROOFTOP RACING // ONLINE + SOLO",
      "Neon Grapple Rush",
      "Swing fast. Dash hard. Own the skyline.",
    );
    hero.classList.add("main-hero");
    const connection = document.createElement("div");
    const online = data.online === true;
    connection.className = `connection-chip ${online ? "online" : "offline"}`;
    const dot = document.createElement("span");
    dot.className = "status-dot";
    const text = document.createElement("span");
    text.textContent =
      data.connectionText ?? (online ? "Multiplayer online" : "Checking multiplayer…");
    connection.append(dot, text);

    const score = document.createElement("p");
    score.className = "best-score";
    score.innerHTML = `<span>BEST RUN</span><strong>${Math.max(0, Math.round(data.bestScore ?? Math.max(records.bestSoloScore, records.bestMultiplayerScore))).toLocaleString()}</strong>`;

    const actions = document.createElement("div");
    actions.className = "menu-actions main-actions";
    actions.append(
      this.actionButton("Quick Match", "quick-match", "primary", "Find a live 2–8 player race"),
      this.actionButton("Private Room", "private-room", "secondary", "Create or join with a room code"),
      this.actionButton("Solo Practice", "solo-practice", "secondary", "Race locally, even while offline"),
    );
    const utility = document.createElement("div");
    utility.className = "menu-actions horizontal compact";
    utility.append(
      this.actionButton("How to play", "how-to", "ghost"),
      this.actionButton("Settings", "settings", "ghost"),
      this.actionButton("Credits", "credits", "ghost"),
    );
    hero.append(connection, actions, utility, score);
    this.screenContent.append(hero);
  }

  private renderMultiplayer(): void {
    const hero = this.hero(
      "MULTIPLAYER",
      "Choose your skyline",
      "Race live runners, or bring friends together with a private code.",
    );
    const cards = document.createElement("div");
    cards.className = "choice-grid";
    cards.append(
      this.choiceCard(
        "⚡",
        "Quick Match",
        "Jump into an open race. A room is made automatically if needed.",
        "Find race",
        "quick-match",
      ),
      this.choiceCard(
        "◇",
        "Private Room",
        "Create a shareable room code or join your friends.",
        "Open rooms",
        "private-room",
      ),
    );
    hero.append(cards, this.actionButton("Back", "back", "ghost"));
    this.screenContent.append(hero);
  }

  private renderPrivateRoom(): void {
    const hero = this.hero(
      "PRIVATE ROOM",
      "Gather your crew",
      "Room codes contain letters and numbers only. No account needed.",
    );
    const split = document.createElement("div");
    split.className = "private-room-grid";

    const create = document.createElement("section");
    create.className = "glass-card";
    const createTitle = document.createElement("h3");
    createTitle.textContent = "Start a room";
    const createCopy = document.createElement("p");
    createCopy.textContent = "We’ll make a short code you can share.";
    create.append(
      createTitle,
      createCopy,
      this.actionButton("Create private room", "create-private", "primary"),
    );

    const join = document.createElement("form");
    join.className = "glass-card";
    const joinTitle = document.createElement("h3");
    joinTitle.textContent = "Join a room";
    const joinLabel = document.createElement("label");
    joinLabel.textContent = "Room code";
    const input = document.createElement("input");
    input.type = "text";
    input.name = "room-code";
    input.className = "room-code-input";
    input.maxLength = 8;
    input.placeholder = "N7RUSH";
    input.autocapitalize = "characters";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-describedby", "room-code-help");
    const help = document.createElement("small");
    help.id = "room-code-help";
    help.textContent = "Ask the room creator for this code.";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "neon-button secondary";
    submit.textContent = "Join room";
    join.addEventListener("submit", (event) => {
      event.preventDefault();
      const roomCode = input.value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 8);
      input.value = roomCode;
      if (roomCode.length < 4) {
        input.setCustomValidity("Enter a room code with at least 4 characters.");
        input.reportValidity();
        return;
      }
      input.setCustomValidity("");
      this.emit("join-private", { roomCode });
    });
    joinLabel.append(input);
    join.append(joinTitle, joinLabel, help, submit);
    split.append(create, join);
    hero.append(split, this.actionButton("Back", "back", "ghost"));
    this.screenContent.append(hero);
  }

  private renderLobby(state?: LobbyState): void {
    this.lobbyUI = new LobbyUI(
      this.screenContent,
      {
        onAction: (action) => {
          if (action === "ready") this.emit("ready");
          else if (action === "leave") this.emit("leave-lobby");
          else this.emit("copy-room-code");
        },
      },
      state ?? {
        roomCode: "----",
        players: [],
        connected: false,
        capacity: 8,
      },
    );
  }

  private renderHowTo(): void {
    const hero = this.hero(
      "FIELD GUIDE",
      "Flow beats force",
      "The tutorial teaches each move while you play. Here’s the quick reference.",
    );
    const controls = document.createElement("div");
    controls.className = "instruction-grid";
    const steps: Array<[string, string, string]> = [
      ["01", "Steer & jump", "Use WASD or arrow keys. Press W / ↑ on a rooftop to jump."],
      ["02", "Grapple", "Hold Space or left mouse. Release while moving fast to launch."],
      ["03", "Air dash", "Press Shift, E, or right mouse once before landing."],
      ["04", "Build a combo", "Chain grapples, shards, wall-runs, near misses and drone dashes."],
      ["05", "Recover", "Press R if stuck. Falling returns you to your latest checkpoint."],
      ["06", "Mobile", "Steer on the left. Hold GRAPPLE, then use JUMP and DASH on the right."],
    ];
    for (const [number, title, copy] of steps) {
      const card = document.createElement("article");
      card.className = "instruction-card";
      const marker = document.createElement("span");
      marker.textContent = number;
      const heading = document.createElement("h3");
      heading.textContent = title;
      const paragraph = document.createElement("p");
      paragraph.textContent = copy;
      card.append(marker, heading, paragraph);
      controls.append(card);
    }
    const actions = document.createElement("div");
    actions.className = "menu-actions horizontal";
    actions.append(
      this.actionButton("Play tutorial", "tutorial", "primary"),
      this.actionButton("Back", "back", "ghost"),
    );
    hero.append(controls, actions);
    this.screenContent.append(hero);
  }

  private renderCredits(): void {
    const hero = this.hero(
      "TRANSMISSION LOG",
      "Built from pure neon",
      "An original rooftop runner made with procedural shapes, Three.js and Web Audio synthesis.",
    );
    const card = document.createElement("div");
    card.className = "glass-card credits-card";
    const heading = document.createElement("h3");
    heading.textContent = "Neon Grapple Rush";
    const copy = document.createElement("p");
    copy.textContent =
      "Every runner, skyline, grapple effect and sound was created for this game. No downloaded game assets or copyrighted characters are used.";
    const tech = document.createElement("p");
    tech.className = "muted";
    tech.textContent =
      "Powered by TypeScript, Three.js, Cannon-es, Vite, WebSockets and Cloudflare Durable Objects.";
    card.append(heading, copy, tech);
    hero.append(card, this.actionButton("Back", "back", "ghost"));
    this.screenContent.append(hero);
  }

  private renderSettings(): void {
    const wrapper = this.hero(
      "CALIBRATION",
      "Settings",
      "Changes save on this device whenever browser storage is available.",
    );
    const mount = document.createElement("div");
    wrapper.append(mount);
    this.screenContent.append(wrapper);
    this.settingsPanel = new SettingsPanel(
      mount,
      {
        onChange: (settings) => this.emit("settings-change", { settings }),
        onClose: () => this.emit("back"),
      },
      loadSettings(),
    );
  }

  private renderPause(pausedByVisibility: boolean): void {
    const hero = this.hero(
      "RUN PAUSED",
      pausedByVisibility ? "Welcome back" : "Catch your breath",
      pausedByVisibility
        ? "The game paused while this tab was hidden."
        : "Solo simulation is paused. Multiplayer time may continue.",
    );
    const actions = document.createElement("div");
    actions.className = "menu-actions";
    actions.append(
      this.actionButton("Resume run", "resume", "primary"),
      this.actionButton("Restart from checkpoint", "restart", "secondary"),
      this.actionButton("Settings", "settings", "ghost"),
      this.actionButton("Main menu", "main-menu", "ghost"),
    );
    hero.append(actions);
    this.screenContent.append(hero);
  }

  private renderResults(results?: ResultsData): void {
    const data: ResultsData = results ?? {
      placement: 1,
      score: 0,
      distance: 0,
      maxCombo: 1,
      shards: 0,
      drones: 0,
      crashes: 0,
    };
    const suffix = ordinalSuffix(data.placement);
    const hero = this.hero(
      "RUN COMPLETE",
      data.placement === 1 ? "Skyline claimed!" : `${data.placement}${suffix} across the line`,
      data.rank ?? rankForScore(data.score),
    );
    const score = document.createElement("div");
    score.className = "result-score";
    score.innerHTML = `<span>FINAL SCORE</span><strong>${Math.max(0, Math.round(data.score)).toLocaleString()}</strong>`;
    const stats = document.createElement("dl");
    stats.className = "result-stats";
    const entries: Array<[string, string]> = [
      ["Finish", data.finishTime === null || data.finishTime === undefined ? "DNF" : formatResultTime(data.finishTime)],
      ["Distance", `${Math.round(data.distance)} m`],
      ["Max combo", `${data.maxCombo.toFixed(1)}×`],
      ["Shards", String(data.shards)],
      ["Drones", String(data.drones)],
      ["Crashes", String(data.crashes)],
    ];
    if (data.pingSummary) entries.push(["Connection", data.pingSummary]);
    for (const [term, description] of entries) {
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = description;
      stats.append(dt, dd);
    }
    hero.append(score, stats);

    if (data.players && data.players.length > 0) {
      const board = document.createElement("ol");
      board.className = "results-board";
      for (const player of [...data.players].sort((a, b) => a.placement - b.placement)) {
        const row = document.createElement("li");
        const place = document.createElement("span");
        place.textContent = `#${player.placement}`;
        const swatch = document.createElement("i");
        swatch.style.setProperty("--player-color", player.color);
        const name = document.createElement("strong");
        name.textContent = player.name;
        const playerScore = document.createElement("span");
        playerScore.textContent = player.score.toLocaleString();
        row.append(place, swatch, name, playerScore);
        board.append(row);
      }
      hero.append(board);
    }

    const actions = document.createElement("div");
    actions.className = "menu-actions horizontal result-actions";
    actions.append(this.actionButton("Play again", "play-again", "primary"));
    if (data.multiplayer && data.roomActive) {
      actions.append(this.actionButton("Return to lobby", "return-lobby", "secondary"));
    }
    actions.append(this.actionButton("Main menu", "main-menu", "ghost"));
    hero.append(actions);
    this.screenContent.append(hero);
  }

  private hero(eyebrowText: string, titleText: string, copyText: string): HTMLElement {
    const hero = document.createElement("section");
    hero.className = "menu-hero";
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = eyebrowText;
    const title = document.createElement("h1");
    title.textContent = titleText;
    title.tabIndex = -1;
    const copy = document.createElement("p");
    copy.className = "menu-copy";
    copy.textContent = copyText;
    hero.append(eyebrow, title, copy);
    return hero;
  }

  private choiceCard(
    iconText: string,
    titleText: string,
    copyText: string,
    buttonText: string,
    action: MenuAction,
  ): HTMLElement {
    const card = document.createElement("article");
    card.className = "choice-card";
    const icon = document.createElement("span");
    icon.className = "choice-icon";
    icon.textContent = iconText;
    icon.setAttribute("aria-hidden", "true");
    const title = document.createElement("h3");
    title.textContent = titleText;
    const copy = document.createElement("p");
    copy.textContent = copyText;
    card.append(icon, title, copy, this.actionButton(buttonText, action, "secondary"));
    return card;
  }

  private actionButton(
    text: string,
    action: MenuAction,
    kind: "primary" | "secondary" | "ghost",
    description?: string,
    closeOverlay = false,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `neon-button ${kind}`;
    if (description) {
      const title = document.createElement("strong");
      title.textContent = text;
      const copy = document.createElement("small");
      copy.textContent = description;
      button.append(title, copy);
    } else {
      button.textContent = text;
    }
    button.addEventListener("click", () => {
      if (closeOverlay) this.hideOverlay();
      this.emit(action);
    });
    return button;
  }

  private emit(action: MenuAction, payload?: MenuActionPayload): void {
    this.callbacks.onAction?.(action, payload);
  }

  private cleanupEmbeddedUI(): void {
    this.lobbyUI?.destroy();
    this.lobbyUI = undefined;
    this.settingsPanel?.destroy();
    this.settingsPanel = undefined;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    if (!this.overlayElement.classList.contains("is-hidden")) {
      this.hideOverlay();
      this.emit("dismiss");
      return;
    }
    if (this.currentScreen === "hidden" || this.currentScreen === "loading") return;
    if (this.currentScreen === "pause") this.emit("resume");
    else if (this.currentScreen === "main" || this.currentScreen === "menu") return;
    else this.emit("back");
  };

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener("keydown", this.onKeyDown);
    this.cleanupEmbeddedUI();
    this.element.remove();
    this.overlayElement.remove();
    document.querySelector(".rotate-device-overlay")?.remove();
    document.documentElement.classList.remove("show-rotate-device");
  }
}

function ordinalSuffix(place: number): string {
  const safe = Math.abs(Math.round(place));
  if (safe % 100 >= 11 && safe % 100 <= 13) return "th";
  if (safe % 10 === 1) return "st";
  if (safe % 10 === 2) return "nd";
  if (safe % 10 === 3) return "rd";
  return "th";
}

function rankForScore(score: number): string {
  if (score >= 100_000) return "Neon Legend";
  if (score >= 60_000) return "Grapple Master";
  if (score >= 30_000) return "Skyline Ace";
  if (score >= 10_000) return "Runner";
  return "Rookie";
}

function formatResultTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, "0")}`;
}
