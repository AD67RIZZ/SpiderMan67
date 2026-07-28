export interface GameError {
  title: string;
  message: string;
  recoverable: boolean;
  cause?: unknown;
}

export type GameErrorHandler = (error: GameError) => void;

export function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: false }) ||
          canvas.getContext("webgl", { failIfMajorPerformanceCaveat: false })),
    );
  } catch {
    return false;
  }
}

export function getWebGLCompatibilityError(): GameError | null {
  if (supportsWebGL()) return null;
  return {
    title: "3D graphics unavailable",
    message:
      "This browser could not start WebGL. Try updating the browser, enabling hardware acceleration, or switching to another device.",
    recoverable: false,
  };
}

/**
 * Converts uncaught browser failures into a readable game error callback while
 * still logging useful detail during development.
 */
export class ErrorBoundary {
  private installed = false;

  public constructor(private readonly handler: GameErrorHandler) {}

  private readonly onError = (event: ErrorEvent): void => {
    this.report({
      title: "Something went off-course",
      message: event.message || "An unexpected game error occurred.",
      recoverable: true,
      cause: event.error,
    });
  };

  private readonly onRejection = (event: PromiseRejectionEvent): void => {
    const reason = event.reason;
    this.report({
      title: "A game task failed",
      message: reason instanceof Error ? reason.message : "An unexpected background task failed.",
      recoverable: true,
      cause: reason,
    });
  };

  public install(): void {
    if (this.installed) return;
    this.installed = true;
    window.addEventListener("error", this.onError);
    window.addEventListener("unhandledrejection", this.onRejection);
  }

  public report(error: GameError): void {
    if (import.meta.env.DEV) console.error("[Neon Grapple Rush]", error.title, error.cause ?? error.message);
    this.handler(error);
  }

  public guard<T>(title: string, action: () => T, fallback: T): T {
    try {
      return action();
    } catch (cause) {
      this.report({
        title,
        message: cause instanceof Error ? cause.message : "An optional game feature could not start.",
        recoverable: true,
        cause,
      });
      return fallback;
    }
  }

  public dispose(): void {
    if (!this.installed) return;
    this.installed = false;
    window.removeEventListener("error", this.onError);
    window.removeEventListener("unhandledrejection", this.onRejection);
  }
}

export function watchWebGLContext(
  canvas: HTMLCanvasElement,
  handler: GameErrorHandler,
  onRestored?: () => void,
): () => void {
  const lost = (event: Event): void => {
    event.preventDefault();
    handler({
      title: "Graphics connection lost",
      message: "The browser paused the 3D renderer. You can retry when the graphics connection returns.",
      recoverable: true,
    });
  };
  const restored = (): void => onRestored?.();
  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", restored);
  return () => {
    canvas.removeEventListener("webglcontextlost", lost);
    canvas.removeEventListener("webglcontextrestored", restored);
  };
}

