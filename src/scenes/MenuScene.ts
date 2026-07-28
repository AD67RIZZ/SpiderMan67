export class MenuScene {
  readonly name = "menu";
  active = false;

  enter(): void {
    this.active = true;
  }

  exit(): void {
    this.active = false;
  }
}
