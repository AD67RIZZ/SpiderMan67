export type PlayerAction =
  | 'idle'
  | 'run'
  | 'jump'
  | 'fall'
  | 'grapple'
  | 'dash'
  | 'wall-run'
  | 'rail'
  | 'slide'
  | 'land'
  | 'respawn';

export interface PlayerInputState {
  /** Left/right input in the -1..1 range. */
  steer: number;
  /** Optional forward influence: -1 brakes/slides, +1 pumps speed. */
  forward?: number;
  jump?: boolean;
  grapple?: boolean;
  dash?: boolean;
  respawn?: boolean;
}

export interface PlayerMovementModifiers {
  speedMultiplier: number;
  steeringAssist: number;
}

export interface CompactPlayerState {
  p: [number, number, number];
  v: [number, number, number];
  yaw: number;
  action: PlayerAction;
  flags: number;
  checkpoint: number;
  grappleAnchor: string | null;
  sequence: number;
}

export type PlayerControllerEvent =
  | { type: 'jump' }
  | { type: 'dash' }
  | { type: 'grapple-attach'; anchorId: string }
  | { type: 'grapple-release'; speed: number; clean: boolean }
  | { type: 'wall-run'; side: -1 | 1 }
  | { type: 'rail'; railId: string }
  | { type: 'land'; impact: number; hard: boolean }
  | { type: 'hazard'; shielded: boolean }
  | { type: 'crash'; reason: 'fall' | 'manual' | 'physics' }
  | { type: 'respawn'; checkpoint: number };
