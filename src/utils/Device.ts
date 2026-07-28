import type { GraphicsQuality } from "./Storage";

export interface DeviceCapabilities {
  touch: boolean;
  coarsePointer: boolean;
  hover: boolean;
  lowPower: boolean;
  preferredGraphics: GraphicsQuality;
  fullscreen: boolean;
  vibration: boolean;
}

/** Touch detection uses browser capabilities, never a user-agent string. */
export function hasTouchInput(): boolean {
  return (
    navigator.maxTouchPoints > 0 ||
    ("ontouchstart" in window && window.matchMedia("(pointer: coarse)").matches)
  );
}

export function isLowPowerDevice(): boolean {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return (
    (typeof memory === "number" && memory <= 4) ||
    navigator.hardwareConcurrency <= 4 ||
    (hasTouchInput() && window.devicePixelRatio >= 2.5)
  );
}

export function recommendedGraphicsQuality(): GraphicsQuality {
  if (isLowPowerDevice()) return "low";
  if (navigator.hardwareConcurrency >= 8 && window.devicePixelRatio <= 2) return "high";
  return "medium";
}

/** Sensible renderer pixel ratio cap for the selected graphics preset. */
export function cappedDevicePixelRatio(quality: GraphicsQuality): number {
  const cap = quality === "low" ? 1 : quality === "medium" ? 1.5 : 2;
  return Math.max(1, Math.min(window.devicePixelRatio || 1, cap));
}

export function getDeviceCapabilities(): DeviceCapabilities {
  return {
    touch: hasTouchInput(),
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    hover: window.matchMedia("(hover: hover)").matches,
    lowPower: isLowPowerDevice(),
    preferredGraphics: recommendedGraphicsQuality(),
    fullscreen: document.fullscreenEnabled === true,
    vibration: typeof navigator.vibrate === "function",
  };
}

export function isNarrowPortrait(): boolean {
  return (
    window.matchMedia("(orientation: portrait)").matches &&
    window.innerWidth < 720 &&
    window.innerHeight > window.innerWidth
  );
}

export function vibrate(pattern: number | number[], enabled = true): boolean {
  if (!enabled || typeof navigator.vibrate !== "function") return false;
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

export async function setFullscreen(
  enabled: boolean,
  element: HTMLElement = document.documentElement,
): Promise<boolean> {
  try {
    if (enabled) {
      if (!document.fullscreenEnabled || document.fullscreenElement) {
        return document.fullscreenElement !== null;
      }
      await element.requestFullscreen({ navigationUI: "hide" });
      return true;
    }
    if (document.fullscreenElement) await document.exitFullscreen();
    return document.fullscreenElement !== null;
  } catch {
    if (enabled && !document.fullscreenElement) {
      try {
        await element.requestFullscreen();
        return true;
      } catch {
        return false;
      }
    }
    return document.fullscreenElement !== null;
  }
}

export function onOrientationCapabilityChange(listener: () => void): () => void {
  const orientation = window.matchMedia("(orientation: portrait)");
  const pointer = window.matchMedia("(pointer: coarse)");
  orientation.addEventListener("change", listener);
  pointer.addEventListener("change", listener);
  window.addEventListener("resize", listener);
  return () => {
    orientation.removeEventListener("change", listener);
    pointer.removeEventListener("change", listener);
    window.removeEventListener("resize", listener);
  };
}

export function onVisibilityChange(listener: (visible: boolean) => void): () => void {
  const handler = (): void => listener(!document.hidden);
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}
