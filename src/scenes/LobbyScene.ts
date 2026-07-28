export class LobbyScene {
  roomCode = "";
  ready = false;
  countdown = 0;

  reset(): void {
    this.roomCode = "";
    this.ready = false;
    this.countdown = 0;
  }
}
