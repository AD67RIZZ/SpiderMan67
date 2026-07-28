/** Clamp a number to an inclusive range. */
export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Linear interpolation without allocating temporary objects. */
export function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

/** Return a 0..1 position between two values. */
export function inverseLerp(from: number, to: number, value: number): number {
  if (Math.abs(to - from) < Number.EPSILON) return 0;
  return clamp((value - from) / (to - from), 0, 1);
}

/**
 * Frame-rate-independent smoothing.
 * `sharpness` is roughly how quickly the value catches the target.
 */
export function damp(
  current: number,
  target: number,
  sharpness: number,
  deltaSeconds: number,
): number {
  return lerp(current, target, 1 - Math.exp(-Math.max(0, sharpness) * Math.max(0, deltaSeconds)));
}

export function remap(
  value: number,
  inputMinimum: number,
  inputMaximum: number,
  outputMinimum: number,
  outputMaximum: number,
): number {
  return lerp(outputMinimum, outputMaximum, inverseLerp(inputMinimum, inputMaximum, value));
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = inverseLerp(edge0, edge1, value);
  return t * t * (3 - 2 * t);
}

export function wrap(value: number, minimum: number, maximum: number): number {
  const range = maximum - minimum;
  if (range <= 0) return minimum;
  return ((((value - minimum) % range) + range) % range) + minimum;
}

export function randomRange(minimum: number, maximum: number): number {
  return minimum + Math.random() * (maximum - minimum);
}

/** A small deterministic integer hash suitable for cosmetic seeded variation. */
export function hashNumber(value: number): number {
  let hash = value | 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function formatTime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  const tenths = Math.floor((Math.max(0, totalSeconds) % 1) * 10);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${tenths}`;
}

export function formatCompactNumber(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (absolute >= 10_000) return `${(value / 1_000).toFixed(1)}k`;
  return Math.round(value).toLocaleString();
}

