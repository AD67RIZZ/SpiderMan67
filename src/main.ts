import "./styles.css";
import { Game, webGLFailure } from "./game/Game";

const root = document.querySelector<HTMLElement>("#game-root");

if (!root) {
  throw new Error("The Neon Grapple Rush root element is missing.");
}

if (!webGLFailure(root)) {
  try {
    const game = new Game(root);
    void game.start();
    window.addEventListener("pagehide", () => game.dispose(), { once: true });
  } catch (error) {
    root.replaceChildren();
    const panel = document.createElement("main");
    panel.className = "compatibility-panel";
    const title = document.createElement("h1");
    title.textContent = "The skyline could not start";
    const message = document.createElement("p");
    message.textContent =
      error instanceof Error
        ? error.message
        : "An unexpected graphics error stopped the game from loading.";
    const retry = document.createElement("button");
    retry.className = "neon-button primary";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => window.location.reload());
    panel.append(title, message, retry);
    root.append(panel);
    console.error("[Neon Grapple Rush] Startup failure", error);
  }
}
