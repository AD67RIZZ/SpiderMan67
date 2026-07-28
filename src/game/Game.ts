import * as THREE from "three";
import type {
  RaceResult,
  RoomView,
  StartMessage,
} from "../shared/protocol";
import { AudioManager } from "../audio/AudioManager";
import { MultiplayerClient } from "../multiplayer/MultiplayerClient";
import type { MenuAction, MenuActionPayload, MenuScreen, ResultsData } from "../ui/MenuUI";
import { HUD } from "../ui/HUD";
import { MenuUI } from "../ui/MenuUI";
import { MobileControls } from "../ui/MobileControls";
import { isNarrowPortrait, onOrientationCapabilityChange } from "../utils/Device";
import {
  ErrorBoundary,
  getWebGLCompatibilityError,
  watchWebGLContext,
} from "../utils/ErrorBoundary";
import {
  loadRecords,
  loadSettings,
  saveRecords,
  type GameSettings,
  updateBestScore,
} from "../utils/Storage";
import { RaceScene } from "../scenes/RaceScene";
import type { GameMode, RaceSummary } from "./GameState";
import { GameLoop, type GameLoopTarget } from "./GameLoop";
import { InputManager } from "./InputManager";
import { MenuBackdrop } from "./MenuBackdrop";

export class Game implements GameLoopTarget {
  private readonly root: HTMLElement;
  private readonly sceneRoot: HTMLElement;
  private readonly uiRoot: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(68, 1, 0.1, 650);
  private readonly menu: MenuUI;
  private readonly hud: HUD;
  private readonly mobile: MobileControls;
  private readonly input: InputManager;
  private readonly audio: AudioManager;
  private readonly multiplayer: MultiplayerClient;
  private readonly loop: GameLoop;
  private readonly errors: ErrorBoundary;
  private readonly cleanups: Array<() => void> = [];
  private settings: GameSettings;
  private scene = new THREE.Scene();
  private backdrop?: MenuBackdrop;
  private race?: RaceScene;
  private currentRoom?: RoomView;
  private currentMode: GameMode | null = null;
  private previousMenu: MenuScreen = "main";
  private visibleElapsed = 0;
  private lobbyRefreshElapsed = 0;
  private disposed = false;
  private pausedByVisibility = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.settings = loadSettings();
    document.documentElement.classList.toggle("reduced-motion", this.settings.reducedMotion);
    this.root.replaceChildren();
    this.root.className = "game-shell";

    this.sceneRoot = document.createElement("div");
    this.sceneRoot.className = "scene-root";
    this.uiRoot = document.createElement("div");
    this.uiRoot.className = "ui-root";
    this.root.append(this.sceneRoot, this.uiRoot);

    this.renderer = new THREE.WebGLRenderer({
      antialias: this.settings.graphics !== "low",
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.domElement.className = "game-canvas";
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute("aria-label", "Neon Grapple Rush 3D city");
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.sceneRoot.append(this.renderer.domElement);
    this.applyGraphicsSettings();

    this.menu = new MenuUI(this.uiRoot, {
      onAction: (action, payload) => void this.handleMenuAction(action, payload),
    });
    this.hud = new HUD(this.uiRoot);
    this.mobile = new MobileControls(this.uiRoot, { haptics: this.settings.haptics });
    this.mobile.setVisible(false);
    this.input = new InputManager(this.renderer.domElement);
    this.input.setMobileSource(this.mobile);

    this.audio = new AudioManager({ settings: this.settings });
    this.audio.attachGestureUnlock(this.root);
    this.audio.startAmbience();
    this.multiplayer = new MultiplayerClient({
      profile: {
        name: this.settings.playerName,
        color: this.settings.playerColor,
      },
    });
    this.errors = new ErrorBoundary((error) => {
      this.menu.showError(error.title, error.message, {
        retry: error.recoverable,
        solo: error.recoverable,
        menu: true,
      });
    });
    this.errors.install();

    this.loop = new GameLoop(this);
    this.createMenuScene();
    this.bindEvents();
    this.resize();
    if (import.meta.env.DEV) {
      (window as typeof window & { __NEON_GRAPPLE_DEBUG__?: () => unknown }).__NEON_GRAPPLE_DEBUG__ =
        () => ({
          screen: this.menu.screen,
          mode: this.currentMode,
          race: this.race
            ? {
                position: this.race.player.position.toArray(),
                velocity: this.race.player.velocity.toArray(),
                speed: this.race.player.speed,
                action: this.race.player.action,
                grounded: this.race.player.grounded,
                active: this.race.player.active,
                checkpoint: this.race.player.checkpointIndex,
                score: this.race.score.score,
              }
            : null,
          multiplayer: {
            status: this.multiplayer.status,
            roomCode: this.multiplayer.roomCode,
            playerId: this.multiplayer.playerId,
            ping: this.multiplayer.ping,
          },
        });
    }
  }

  async start(): Promise<void> {
    this.menu.show("loading", {
      loading: { progress: 0.2, message: "Charging energy tethers…" },
    });
    this.loop.start();
    await nextFrame();
    this.menu.updateLoading(0.58, "Building the rooftop route…");
    await nextFrame();
    this.menu.updateLoading(1, "Skyline ready.");
    await delay(180);
    this.showMainMenu();
    void this.multiplayer.checkAvailability();
  }

  fixedUpdate(dt: number): void {
    if (this.disposed) return;
    const input = this.input.snapshot();
    if (input.pause && this.race) {
      this.togglePause();
      return;
    }
    this.race?.fixedUpdate(dt, input);
    if (import.meta.env.DEV) {
      this.root.dataset.debugNetwork = this.multiplayer.status;
      this.root.dataset.debugRoom = this.multiplayer.roomCode ?? "";
      this.root.dataset.debugPlayer = this.multiplayer.playerId ?? "";
      this.root.dataset.debugPing = String(this.multiplayer.ping);
      if (this.race) {
        this.root.dataset.debugPosition = this.race.player.position.toArray().map((value) => value.toFixed(2)).join(",");
        this.root.dataset.debugVelocity = this.race.player.velocity.toArray().map((value) => value.toFixed(2)).join(",");
        this.root.dataset.debugSpeed = this.race.player.speed.toFixed(2);
        this.root.dataset.debugAction = this.race.player.action;
        this.root.dataset.debugGrounded = String(this.race.player.grounded);
        this.root.dataset.debugActive = String(this.race.player.active);
        this.root.dataset.debugRemotePlayers = String(this.race.remotePlayerCount);
      }
    }

    if (this.menu.screen === "lobby" && this.currentRoom) {
      this.lobbyRefreshElapsed += dt;
      if (this.lobbyRefreshElapsed >= 0.5) {
        this.lobbyRefreshElapsed = 0;
        this.menu.updateLobby(this.toLobbyState(this.currentRoom));
      }
    } else {
      this.lobbyRefreshElapsed = 0;
    }
    this.mobile.setDashAvailable(this.race?.player.dashAvailable ?? true);
  }

  render(_interpolation: number, frameSeconds: number): void {
    if (this.disposed) return;
    this.visibleElapsed += frameSeconds;
    if (this.race) this.race.renderUpdate(frameSeconds);
    else this.backdrop?.update(this.visibleElapsed, this.settings.reducedMotion);
    this.renderer.render(this.scene, this.camera);
  }

  private bindEvents(): void {
    this.cleanups.push(
      this.multiplayer.on("availability", ({ available, message }) => {
        this.menu.setOnlineStatus(available, message);
      }),
      this.multiplayer.on("status", ({ status, message }) => {
        const online = status === "connected";
        if (this.menu.screen === "main") this.menu.setOnlineStatus(online, message);
      }),
      this.multiplayer.on("welcome", (message) => {
        this.currentRoom = message.room;
        this.menu.hideOverlay();
        this.menu.show("lobby", { lobby: this.toLobbyState(message.room) });
      }),
      this.multiplayer.on("room", (room) => {
        this.currentRoom = room;
        if (!this.race && (room.phase === "lobby" || room.phase === "countdown")) {
          this.menu.show("lobby", { lobby: this.toLobbyState(room) });
        } else if (this.menu.screen === "lobby") {
          this.menu.updateLobby(this.toLobbyState(room));
        }
      }),
      this.multiplayer.on("countdown", (message) => {
        const seconds = Math.max(0, (message.startsAt - Date.now()) / 1_000);
        this.hud.showCountdown(seconds);
        this.audio.play("countdown");
      }),
      this.multiplayer.on("start", (message) => this.startMultiplayerRace(message)),
      this.multiplayer.on("snapshot", (message) => this.race?.handleSnapshot(message)),
      this.multiplayer.on("respawn", (message) => this.race?.handleServerRespawn(message)),
      this.multiplayer.on("power_up_state", (message) => this.race?.handlePowerUpState(message)),
      this.multiplayer.on("power_up_rejected", ({ objectId }) => {
        if (objectId !== null) this.race?.rejectPowerUp(objectId);
      }),
      this.multiplayer.on("finish", (message) => {
        if (message.playerId === this.multiplayer.playerId) {
          this.hud.banner(`FINISHED #${message.placement}`, "Official placement locked");
        }
      }),
      this.multiplayer.on("results", (results) => this.showOfficialResults(results)),
      this.multiplayer.on("disconnected", ({ reconnecting }) => {
        if (this.race && this.currentMode === "multiplayer") {
          this.menu.showConnectionLost(
            reconnecting
              ? "The signal dropped. Reconnection is already in progress."
              : "The multiplayer link closed. You can retry or continue in Solo Practice.",
          );
        }
      }),
      this.multiplayer.on("error", (error) => {
        if (error.code === "rate_limited" || error.code === "stale_sequence") return;
        this.menu.showError("Multiplayer notice", error.message, {
          retry: error.retryable,
          solo: true,
          menu: true,
        });
      }),
    );

    const removeOrientation = onOrientationCapabilityChange(() => {
      this.menu.setRotateDeviceVisible(isNarrowPortrait() && Boolean(this.race));
    });
    this.cleanups.push(removeOrientation);

    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.cleanups.push(() => window.removeEventListener("resize", this.resize));
    this.cleanups.push(() => document.removeEventListener("visibilitychange", this.onVisibilityChange));
    this.cleanups.push(
      watchWebGLContext(
        this.renderer.domElement,
        (error) => this.menu.showError(error.title, error.message),
        () => this.resize(),
      ),
    );
  }

  private async handleMenuAction(action: MenuAction, payload?: MenuActionPayload): Promise<void> {
    this.audio.play("button", 0.65);
    switch (action) {
      case "quick-match":
        await this.connect(() => this.multiplayer.quickMatch(this.profile()), "Finding a live race…");
        break;
      case "private-room":
        this.previousMenu = "main";
        this.menu.show("private-room");
        break;
      case "create-private":
        await this.connect(() => this.multiplayer.createPrivate(this.profile()), "Creating a private skyline…");
        break;
      case "join-private":
        await this.connect(
          () => this.multiplayer.joinPrivate(payload?.roomCode ?? "", this.profile()),
          "Joining the private skyline…",
        );
        break;
      case "solo-practice":
        this.menu.hideOverlay();
        this.multiplayer.leave();
        this.startRace("solo", randomSeed());
        break;
      case "tutorial":
        this.previousMenu = this.menu.screen;
        this.menu.hideOverlay();
        this.startRace("tutorial", 0x4e4752);
        break;
      case "settings":
        this.previousMenu = this.race ? "pause" : this.menu.screen === "settings" ? "main" : this.menu.screen;
        this.menu.show("settings");
        break;
      case "settings-change":
        if (payload?.settings) this.applySettings(payload.settings);
        break;
      case "how-to":
        this.previousMenu = this.menu.screen;
        this.menu.show("how-to");
        break;
      case "credits":
        this.previousMenu = this.menu.screen;
        this.menu.show("credits");
        break;
      case "back":
        if (this.race && this.previousMenu === "pause") {
          this.menu.show("pause");
        } else if (this.menu.screen === "private-room" || this.menu.screen === "multiplayer") {
          this.showMainMenu();
        } else {
          this.menu.show(this.previousMenu === "hidden" ? "main" : this.previousMenu);
        }
        break;
      case "ready": {
        const local = this.currentRoom?.players.find((player) => player.id === this.multiplayer.playerId);
        this.multiplayer.setReady(!(local?.ready ?? false));
        break;
      }
      case "leave-lobby":
        this.multiplayer.leave();
        this.currentRoom = undefined;
        this.showMainMenu();
        break;
      case "copy-room-code":
        await this.copyRoomCode();
        break;
      case "resume":
        this.setPaused(false);
        break;
      case "restart":
        this.race?.restartFromCheckpoint();
        this.setPaused(false);
        break;
      case "play-again":
        if (this.currentMode === "multiplayer") {
          this.multiplayer.playAgain();
          this.disposeRace();
          if (this.currentRoom) this.menu.show("lobby", { lobby: this.toLobbyState(this.currentRoom) });
        } else {
          this.startRace(this.currentMode ?? "solo", randomSeed());
        }
        break;
      case "return-lobby":
        this.multiplayer.playAgain();
        this.disposeRace();
        if (this.currentRoom) this.menu.show("lobby", { lobby: this.toLobbyState(this.currentRoom) });
        break;
      case "main-menu":
        this.multiplayer.leave();
        this.currentRoom = undefined;
        this.disposeRace();
        this.createMenuScene();
        this.showMainMenu();
        void this.multiplayer.checkAvailability();
        break;
      case "retry":
        this.menu.hideOverlay();
        if (!(await this.multiplayer.reconnectLastSession().catch(() => false))) {
          void this.multiplayer.checkAvailability();
        }
        break;
      case "dismiss":
        this.menu.hideOverlay();
        break;
    }
  }

  private async connect(operation: () => Promise<void>, message: string): Promise<void> {
    this.menu.show("loading", { loading: { progress: 0.45, message } });
    try {
      await operation();
    } catch (error) {
      this.menu.showError(
        "Couldn’t connect",
        error instanceof Error ? error.message : "The multiplayer server could not be reached.",
        { retry: true, solo: true, menu: true },
      );
      this.showMainMenu();
    }
  }

  private startMultiplayerRace(message: StartMessage): void {
    this.menu.hideOverlay();
    this.startRace("multiplayer", message.course.seed);
    this.race?.setServerTiming(message.startedAt, message.endsAt, message.course.hazardEpoch);
  }

  private startRace(mode: GameMode, seed: number): void {
    this.disposeRace();
    this.backdrop?.dispose();
    this.backdrop = undefined;
    this.scene = new THREE.Scene();
    this.currentMode = mode;
    this.race = new RaceScene({
      scene: this.scene,
      camera: this.camera,
      mode,
      seed,
      settings: this.settings,
      hud: this.hud,
      audio: this.audio,
      ...(mode === "multiplayer" ? { multiplayer: this.multiplayer } : {}),
      onFinish: (summary) => this.showLocalResults(summary),
    });
    this.menu.hide();
    this.mobile.setVisible(true);
    this.menu.setRotateDeviceVisible(isNarrowPortrait());
    this.pausedByVisibility = false;
  }

  private showLocalResults(summary: RaceSummary): void {
    if (this.currentMode === "solo") updateBestScore("solo", summary.score);
    if (this.currentMode === "tutorial") {
      const records = loadRecords();
      records.tutorialComplete = true;
      saveRecords(records);
    }
    this.race?.setPaused(true);
    this.hud.setVisible(false);
    this.mobile.setVisible(false);
    this.menu.show("results", {
      results: this.summaryToResults(summary, false),
    });
  }

  private showOfficialResults(results: RaceResult[]): void {
    const local = results.find((result) => result.playerId === this.multiplayer.playerId);
    if (!local) return;
    updateBestScore("multiplayer", local.score.total);
    this.race?.setPaused(true);
    this.hud.setVisible(false);
    this.mobile.setVisible(false);
    const data: ResultsData = {
      multiplayer: true,
      placement: local.placement,
      score: local.score.total,
      finishTime: local.finishTimeMs === null ? null : local.finishTimeMs / 1_000,
      distance: local.distance,
      maxCombo: local.maximumCombo,
      shards: local.shardsCollected,
      drones: local.dronesDestroyed,
      crashes: local.crashes,
      pingSummary: formatPing(local.pingQuality),
      players: results.map((result) => ({
        id: result.playerId,
        name: result.name,
        color: result.color,
        placement: result.placement,
        score: result.score.total,
        finishTime: result.finishTimeMs === null ? null : result.finishTimeMs / 1_000,
      })),
      roomActive: true,
    };
    this.menu.hideOverlay();
    this.menu.show("results", { results: data });
  }

  private summaryToResults(summary: RaceSummary, multiplayer: boolean): ResultsData {
    return {
      multiplayer,
      placement: summary.placement,
      score: summary.score,
      finishTime: summary.finishTimeMs / 1_000,
      distance: summary.distance,
      maxCombo: summary.maxCombo,
      shards: summary.shards,
      drones: summary.drones,
      crashes: summary.crashes,
      pingSummary: multiplayer ? `${Math.round(summary.ping)} ms average` : undefined,
      rank: summary.rank,
      roomActive: false,
    };
  }

  private togglePause(): void {
    this.setPaused(!this.race?.isPaused);
  }

  private setPaused(paused: boolean): void {
    if (!this.race) return;
    this.race.setPaused(paused);
    this.mobile.setVisible(!paused);
    this.hud.setVisible(!paused);
    if (paused) {
      this.previousMenu = "pause";
      this.menu.show("pause", { pausedByVisibility: this.pausedByVisibility });
    } else {
      this.pausedByVisibility = false;
      this.menu.hide();
    }
  }

  private showMainMenu(): void {
    if (!this.backdrop && !this.race) this.createMenuScene();
    const records = loadRecords();
    this.menu.show("main", {
      main: {
        bestScore: Math.max(records.bestSoloScore, records.bestMultiplayerScore),
        online: this.multiplayer.status === "connected",
        connectionText:
          this.multiplayer.status === "connected"
            ? "Multiplayer online."
            : "Checking multiplayer…",
      },
    });
    this.hud.setVisible(false);
    this.mobile.setVisible(false);
  }

  private createMenuScene(): void {
    this.backdrop?.dispose();
    this.scene = new THREE.Scene();
    this.camera.position.set(0, 11, -18);
    this.backdrop = new MenuBackdrop(this.scene, this.camera);
    this.visibleElapsed = 0;
  }

  private disposeRace(): void {
    this.race?.dispose();
    this.race = undefined;
    this.currentMode = null;
    this.hud.setVisible(false);
    this.mobile.setVisible(false);
    this.menu.setRotateDeviceVisible(false);
  }

  private toLobbyState(room: RoomView) {
    return {
      roomCode: room.code,
      players: room.players.map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        ready: player.ready,
        host: player.host,
        connected: player.connected,
      })),
      localPlayerId: this.multiplayer.playerId ?? undefined,
      connected: this.multiplayer.connected,
      ping: this.multiplayer.ping ?? undefined,
      countdown:
        room.countdownEndsAt === null
          ? null
          : Math.max(0, (room.countdownEndsAt - Date.now()) / 1_000),
      capacity: room.maxPlayers,
    };
  }

  private profile(): { name: string; color: string } {
    return { name: this.settings.playerName, color: this.settings.playerColor };
  }

  private applySettings(settings: GameSettings): void {
    Object.assign(this.settings, settings);
    this.audio.updateSettings(this.settings);
    this.mobile.setHaptics(this.settings.haptics);
    this.multiplayer.setProfile(this.profile());
    document.documentElement.classList.toggle("reduced-motion", this.settings.reducedMotion);
    this.applyGraphicsSettings();
  }

  private applyGraphicsSettings(): void {
    const cap = this.settings.graphics === "high" ? 2 : this.settings.graphics === "medium" ? 1.5 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    this.renderer.shadowMap.enabled = this.settings.graphics === "high";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.resize();
  }

  private async copyRoomCode(): Promise<void> {
    const code = this.currentRoom?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      this.hud.notice(`Room code ${code} copied`, "info");
    } catch {
      this.menu.showOverlay({
        title: "Room code",
        message: code,
        actions: [{ label: "Close", action: "dismiss", primary: true }],
      });
    }
  }

  private readonly resize = (): void => {
    const width = Math.max(1, this.root.clientWidth || window.innerWidth);
    const height = Math.max(1, this.root.clientHeight || window.innerHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  private readonly onVisibilityChange = (): void => {
    if (!this.race || this.currentMode === "multiplayer") return;
    if (document.hidden && !this.race.isPaused) {
      this.pausedByVisibility = true;
      this.race.setPaused(true);
    } else if (!document.hidden && this.pausedByVisibility) {
      this.hud.setVisible(false);
      this.mobile.setVisible(false);
      this.menu.show("pause", { pausedByVisibility: true });
    }
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    this.disposeRace();
    this.backdrop?.dispose();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.input.dispose();
    this.mobile.dispose();
    this.hud.destroy();
    this.menu.destroy();
    this.multiplayer.dispose();
    void this.audio.dispose();
    this.errors.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    delete (window as typeof window & { __NEON_GRAPPLE_DEBUG__?: () => unknown }).__NEON_GRAPPLE_DEBUG__;
    this.root.replaceChildren();
    delete this.root.dataset.debugPosition;
    delete this.root.dataset.debugVelocity;
    delete this.root.dataset.debugSpeed;
    delete this.root.dataset.debugAction;
    delete this.root.dataset.debugGrounded;
    delete this.root.dataset.debugActive;
    delete this.root.dataset.debugNetwork;
    delete this.root.dataset.debugRoom;
    delete this.root.dataset.debugPlayer;
    delete this.root.dataset.debugPing;
    delete this.root.dataset.debugRemotePlayers;
  }
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now();
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function formatPing(quality: RaceResult["pingQuality"]): string {
  if (quality === "great") return "Great connection";
  if (quality === "good") return "Good connection";
  if (quality === "fair") return "Fair connection";
  if (quality === "poor") return "Unstable connection";
  return "Connection not measured";
}

export function webGLFailure(root: HTMLElement): boolean {
  const error = getWebGLCompatibilityError();
  if (!error) return false;
  root.replaceChildren();
  const panel = document.createElement("main");
  panel.className = "compatibility-panel";
  const title = document.createElement("h1");
  title.textContent = error.title;
  const message = document.createElement("p");
  message.textContent = error.message;
  const retry = document.createElement("button");
  retry.className = "neon-button primary";
  retry.textContent = "Retry";
  retry.addEventListener("click", () => window.location.reload());
  panel.append(title, message, retry);
  root.append(panel);
  return true;
}
