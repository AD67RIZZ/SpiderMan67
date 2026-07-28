export interface LobbyPlayer {
  id: string;
  name: string;
  color: string;
  ready: boolean;
  host?: boolean;
  connected?: boolean;
}

export interface LobbyState {
  roomCode: string;
  players: LobbyPlayer[];
  localPlayerId?: string;
  connected: boolean;
  ping?: number;
  countdown?: number | null;
  capacity?: number;
}

export type LobbyAction = "ready" | "leave" | "copy-room-code";

export interface LobbyUIOptions {
  onAction?: (action: LobbyAction) => void;
}

/** Ready-up lobby renderer that can also be embedded by MenuUI. */
export class LobbyUI {
  public readonly element: HTMLElement;
  private state: LobbyState;

  public constructor(
    parent: HTMLElement,
    private readonly options: LobbyUIOptions = {},
    initialState: LobbyState = {
      roomCode: "----",
      players: [],
      connected: false,
      countdown: null,
      capacity: 8,
    },
  ) {
    this.state = initialState;
    this.element = document.createElement("section");
    this.element.className = "lobby-ui";
    this.element.setAttribute("aria-label", "Match lobby");
    parent.append(this.element);
    this.render();
  }

  public update(state: LobbyState): void {
    this.state = state;
    this.render();
  }

  private render(): void {
    const state = this.state;
    this.element.replaceChildren();

    const header = document.createElement("div");
    header.className = "lobby-header";
    const titleWrap = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "PRIVATE SKYLINE";
    const title = document.createElement("h2");
    title.textContent = "Match lobby";
    titleWrap.append(eyebrow, title);

    const room = document.createElement("button");
    room.type = "button";
    room.className = "room-code";
    room.setAttribute("aria-label", `Copy room code ${state.roomCode}`);
    room.innerHTML = `<span>ROOM CODE</span><strong>${escapeText(state.roomCode)}</strong><small>Tap to copy</small>`;
    room.addEventListener("click", () => {
      void copyText(state.roomCode).then((copied) => {
        const hint = room.querySelector("small");
        if (hint) hint.textContent = copied ? "Copied!" : "Select and copy";
      });
      this.options.onAction?.("copy-room-code");
    });
    header.append(titleWrap, room);
    this.element.append(header);

    const status = document.createElement("div");
    status.className = "lobby-status";
    status.innerHTML = `<span class="status-dot ${state.connected ? "online" : "offline"}"></span>`;
    const statusText = document.createElement("span");
    statusText.textContent = state.connected
      ? `Connected${state.ping === undefined ? "" : ` · ${Math.round(state.ping)} ms`}`
      : "Reconnecting…";
    status.append(statusText);
    this.element.append(status);

    const list = document.createElement("ol");
    list.className = "player-list";
    list.setAttribute("aria-label", `${state.players.length} players in lobby`);
    for (const player of state.players) {
      const item = document.createElement("li");
      item.className = `lobby-player ${player.ready ? "is-ready" : ""}`;
      if (player.id === state.localPlayerId) item.classList.add("is-you");

      const swatch = document.createElement("span");
      swatch.className = "player-swatch";
      swatch.style.setProperty("--player-color", player.color);
      const name = document.createElement("strong");
      name.textContent = player.name;
      const badges = document.createElement("span");
      badges.className = "player-badges";
      if (player.host) {
        const host = document.createElement("em");
        host.textContent = "HOST";
        badges.append(host);
      }
      if (player.id === state.localPlayerId) {
        const you = document.createElement("em");
        you.textContent = "YOU";
        badges.append(you);
      }
      const ready = document.createElement("span");
      ready.className = "ready-state";
      ready.textContent = player.ready ? "READY ✓" : "TUNING UP";
      item.append(swatch, name, badges, ready);
      list.append(item);
    }

    const capacity = state.capacity ?? 8;
    for (let i = state.players.length; i < Math.min(capacity, 8); i += 1) {
      const empty = document.createElement("li");
      empty.className = "lobby-player empty";
      empty.textContent = "Waiting for runner…";
      list.append(empty);
    }
    this.element.append(list);

    const countdown = document.createElement("p");
    countdown.className = "lobby-countdown";
    countdown.setAttribute("aria-live", "polite");
    countdown.textContent =
      state.countdown !== null && state.countdown !== undefined
        ? `Launch in ${Math.max(0, Math.ceil(state.countdown))}`
        : state.players.length < 2
          ? "Waiting for another runner"
          : "Ready up to begin";
    this.element.append(countdown);

    const local = state.players.find((player) => player.id === state.localPlayerId);
    const actions = document.createElement("div");
    actions.className = "menu-actions horizontal";
    const leave = actionButton("Leave lobby", "secondary", () => this.options.onAction?.("leave"));
    const ready = actionButton(local?.ready ? "Not ready" : "Ready up", "primary", () =>
      this.options.onAction?.("ready"),
    );
    ready.disabled = !state.connected;
    actions.append(leave, ready);
    this.element.append(actions);
  }

  public focus(): void {
    this.element.querySelector<HTMLElement>("button")?.focus();
  }

  public destroy(): void {
    this.element.remove();
  }
}

function actionButton(
  label: string,
  kind: "primary" | "secondary",
  callback: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `neon-button ${kind}`;
  button.textContent = label;
  button.addEventListener("click", callback);
  return button;
}

function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character] ?? character;
  });
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    const input = document.createElement("textarea");
    input.value = value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  } catch {
    return false;
  }
}
