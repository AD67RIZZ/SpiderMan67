import {
  type GameSettings,
  type GraphicsQuality,
  loadSettings,
  sanitizePlayerColor,
  sanitizePlayerName,
  saveSettings,
} from "../utils/Storage";
import { getDeviceCapabilities, setFullscreen } from "../utils/Device";

export interface SettingsPanelCallbacks {
  onChange?: (settings: GameSettings) => void;
  onClose?: () => void;
}

/**
 * Accessible settings form. Changes are applied and safely persisted
 * immediately, including when localStorage is blocked.
 */
export class SettingsPanel {
  public readonly element: HTMLElement;
  private settings: GameSettings;
  private destroyed = false;

  public constructor(
    parent: HTMLElement,
    private readonly callbacks: SettingsPanelCallbacks = {},
    initialSettings: GameSettings = loadSettings(),
  ) {
    this.settings = { ...initialSettings };
    this.element = document.createElement("section");
    this.element.className = "ngr-settings";
    this.element.setAttribute("aria-label", "Game settings");
    parent.append(this.element);
    this.applyDocumentClasses();
    document.addEventListener("fullscreenchange", this.onFullscreenChange);
    this.render();
  }

  public get value(): Readonly<GameSettings> {
    return this.settings;
  }

  public setValue(settings: GameSettings): void {
    this.settings = { ...settings };
    this.render();
  }

  private render(): void {
    const capabilities = getDeviceCapabilities();
    this.element.replaceChildren();

    const grid = document.createElement("div");
    grid.className = "settings-grid";
    grid.append(
      this.createRange("Master volume", "masterVolume", this.settings.masterVolume),
      this.createRange("Music & ambience", "musicVolume", this.settings.musicVolume),
      this.createRange("Sound effects", "sfxVolume", this.settings.sfxVolume),
      this.createSelect(
        "Graphics quality",
        "graphics",
        this.settings.graphics,
        capabilities.lowPower
          ? [
              ["low", "Low (recommended)"],
              ["medium", "Medium"],
              ["high", "High"],
            ]
          : [
              ["low", "Low"],
              ["medium", "Medium"],
              ["high", "High"],
            ],
      ),
      this.createRange("Camera sensitivity", "cameraSensitivity", this.settings.cameraSensitivity, 0.5, 2, 0.1),
      this.createToggle("Screen shake", "screenShake", this.settings.screenShake),
      this.createToggle("Reduced motion", "reducedMotion", this.settings.reducedMotion),
      this.createToggle("Control hints", "controlHints", this.settings.controlHints),
      this.createToggle("Haptic feedback", "haptics", this.settings.haptics, !capabilities.vibration),
      this.createText("Runner name", "playerName", this.settings.playerName),
      this.createColor("Runner colour", "playerColor", this.settings.playerColor),
    );
    this.element.append(grid);

    const footer = document.createElement("div");
    footer.className = "menu-actions settings-actions";

    const fullscreen = this.button(
      document.fullscreenElement ? "Exit fullscreen" : "Fullscreen",
      "secondary",
      async () => {
        await setFullscreen(document.fullscreenElement === null);
        this.render();
      },
    );
    fullscreen.disabled = !capabilities.fullscreen;
    fullscreen.title = capabilities.fullscreen ? "" : "Fullscreen is unavailable in this browser";

    const done = this.button("Done", "primary", () => this.callbacks.onClose?.());
    footer.append(fullscreen, done);
    this.element.append(footer);
  }

  private createField(labelText: string): { label: HTMLLabelElement; control: HTMLDivElement } {
    const label = document.createElement("label");
    label.className = "setting-field";
    const title = document.createElement("span");
    title.className = "setting-label";
    title.textContent = labelText;
    const control = document.createElement("div");
    control.className = "setting-control";
    label.append(title, control);
    return { label, control };
  }

  private createRange(
    labelText: string,
    key: "masterVolume" | "musicVolume" | "sfxVolume" | "cameraSensitivity",
    value: number,
    minimum = 0,
    maximum = 1,
    step = 0.05,
  ): HTMLLabelElement {
    const { label, control } = this.createField(labelText);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(minimum);
    input.max = String(maximum);
    input.step = String(step);
    input.value = String(value);
    const output = document.createElement("output");
    output.textContent =
      maximum === 1 ? `${Math.round(value * 100)}%` : `${Math.round(value * 10) / 10}×`;
    input.addEventListener("input", () => {
      const next = Number(input.value);
      this.settings[key] = next;
      output.textContent =
        maximum === 1 ? `${Math.round(next * 100)}%` : `${Math.round(next * 10) / 10}×`;
      this.commit();
    });
    control.append(input, output);
    return label;
  }

  private createSelect(
    labelText: string,
    key: "graphics",
    value: GraphicsQuality,
    values: ReadonlyArray<readonly [GraphicsQuality, string]>,
  ): HTMLLabelElement {
    const { label, control } = this.createField(labelText);
    const select = document.createElement("select");
    for (const [optionValue, text] of values) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = text;
      option.selected = optionValue === value;
      select.append(option);
    }
    select.addEventListener("change", () => {
      this.settings[key] = select.value as GraphicsQuality;
      this.commit();
    });
    control.append(select);
    return label;
  }

  private createToggle(
    labelText: string,
    key: "screenShake" | "reducedMotion" | "controlHints" | "haptics",
    value: boolean,
    disabled = false,
  ): HTMLLabelElement {
    const { label, control } = this.createField(labelText);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "toggle-input";
    input.checked = value;
    input.disabled = disabled;
    input.addEventListener("change", () => {
      this.settings[key] = input.checked;
      if (key === "reducedMotion") {
        document.documentElement.classList.toggle("reduced-motion", input.checked);
      }
      this.commit();
    });
    const slider = document.createElement("span");
    slider.className = "toggle-track";
    slider.setAttribute("aria-hidden", "true");
    control.append(input, slider);
    return label;
  }

  private createText(
    labelText: string,
    key: "playerName",
    value: string,
  ): HTMLLabelElement {
    const { label, control } = this.createField(labelText);
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 20;
    input.setAttribute("autocomplete", "nickname");
    input.value = value;
    input.placeholder = "Neon Runner";
    input.addEventListener("change", () => {
      const cleaned = sanitizePlayerName(input.value);
      input.value = cleaned;
      this.settings[key] = cleaned;
      this.commit();
    });
    control.append(input);
    return label;
  }

  private createColor(
    labelText: string,
    key: "playerColor",
    value: string,
  ): HTMLLabelElement {
    const { label, control } = this.createField(labelText);
    const input = document.createElement("input");
    input.type = "color";
    input.value = sanitizePlayerColor(value);
    input.addEventListener("input", () => {
      this.settings[key] = sanitizePlayerColor(input.value);
      this.commit();
    });
    control.append(input);
    return label;
  }

  private button(label: string, kind: "primary" | "secondary", action: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `neon-button ${kind}`;
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }

  private commit(): void {
    if (this.destroyed) return;
    this.applyDocumentClasses();
    saveSettings(this.settings);
    this.callbacks.onChange?.({ ...this.settings });
  }

  private applyDocumentClasses(): void {
    document.documentElement.classList.toggle("reduced-motion", this.settings.reducedMotion);
    document.documentElement.classList.remove("graphics-low", "graphics-medium", "graphics-high");
    document.documentElement.classList.add(`graphics-${this.settings.graphics}`);
  }

  public focus(): void {
    this.element.querySelector<HTMLElement>("input, select, button")?.focus();
  }

  public destroy(): void {
    this.destroyed = true;
    document.removeEventListener("fullscreenchange", this.onFullscreenChange);
    this.element.remove();
  }

  private readonly onFullscreenChange = (): void => {
    if (!this.destroyed) this.render();
  };
}
