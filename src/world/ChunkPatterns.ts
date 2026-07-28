import { SeededRandom, hashSeed } from './SeededRandom';
import { deterministicPowerUpKind } from '../shared/protocol';
import type {
  AnchorSpec,
  CheckpointSpec,
  ChunkKind,
  CourseChunk,
  CourseLayout,
  HazardSpec,
  PlatformSpec,
  PowerUpSpec,
  RaceMode,
  RailSpec,
  ShardSpec,
  Vec3Tuple,
} from './types';

interface BuildState {
  seed: number;
  rng: SeededRandom;
  chunks: CourseChunk[];
  platforms: PlatformSpec[];
  anchors: AnchorSpec[];
  checkpoints: CheckpointSpec[];
  shards: ShardSpec[];
  powerUps: PowerUpSpec[];
  rails: RailSpec[];
  hazards: HazardSpec[];
  x: number;
  y: number;
  z: number;
  chunk: number;
}

const CHUNK_LENGTH = 52;
const ROOF_HEIGHT = 2;

function platform(
  state: BuildState,
  suffix: string,
  x: number,
  y: number,
  z: number,
  width: number,
  length: number,
  neon: number,
  kind: PlatformSpec['kind'] = 'roof',
  movement?: PlatformSpec['movement'],
): void {
  state.platforms.push({
    id: `platform-${state.chunk}-${suffix}`,
    chunk: state.chunk,
    position: [x, y, z],
    size: [width, kind === 'wall' ? 12 : ROOF_HEIGHT, length],
    neon,
    kind,
    ...(movement === undefined ? {} : { movement }),
  });
}

function anchor(state: BuildState, suffix: string, position: Vec3Tuple, range = 36): void {
  state.anchors.push({
    id: `anchor-${state.chunk}-${suffix}`,
    chunk: state.chunk,
    position,
    range,
  });
}

function shardLine(
  state: BuildState,
  suffix: string,
  from: Vec3Tuple,
  to: Vec3Tuple,
  count: number,
  risky = false,
): void {
  for (let index = 0; index < count; index += 1) {
    const t = count === 1 ? 0.5 : index / (count - 1);
    state.shards.push({
      id: `shard-${state.chunk}-${suffix}-${index}`,
      position: [
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
      ],
      risky,
    });
  }
}

function checkpoint(state: BuildState, suffix: string, x: number, y: number, z: number): void {
  const index = state.checkpoints.length;
  state.checkpoints.push({
    id: `checkpoint-${suffix}`,
    index,
    position: [x, y + 2.5, z],
    width: 14,
    respawn: [x, y + 2.2, z - 4],
  });
}

function beginChunk(state: BuildState, kind: ChunkKind): number {
  const startZ = state.z;
  state.chunks.push({
    id: `chunk-${state.chunk}-${kind}`,
    index: state.chunk,
    kind,
    startZ,
    endZ: startZ + CHUNK_LENGTH,
  });
  return startZ;
}

function endChunk(state: BuildState): void {
  state.z += CHUNK_LENGTH;
  state.chunk += 1;
}

function beginner(state: BuildState): void {
  const z = beginChunk(state, 'beginner');
  platform(state, 'wide', state.x, state.y, z + 23, 22, 48, 0x27d9ff);
  shardLine(state, 'warmup', [state.x, state.y + 2, z + 4], [state.x, state.y + 2, z + 42], 8);
  anchor(state, 'tutorial', [state.x, state.y + 10, z + 35], 32);
  checkpoint(state, 'start', state.x, state.y, z + 2);
  endChunk(state);
}

function grappleGap(state: BuildState): void {
  const z = beginChunk(state, 'grapple');
  const nextX = state.x + state.rng.sign() * state.rng.range(3, 6);
  platform(state, 'launch', state.x, state.y, z + 7, 18, 15, 0x7b5cff);
  platform(state, 'landing', nextX, state.y + 1, z + 40, 20, 22, 0x27d9ff);
  anchor(state, 'gap-a', [state.x + 2, state.y + 13, z + 21]);
  anchor(state, 'gap-b', [nextX - 2, state.y + 15, z + 32]);
  shardLine(state, 'arc', [state.x, state.y + 5, z + 15], [nextX, state.y + 6, z + 36], 7, true);
  state.x = nextX;
  state.y += 1;
  endChunk(state);
}

function splitRoute(state: BuildState): void {
  const z = beginChunk(state, 'split');
  const side = state.rng.sign();
  platform(state, 'center', state.x, state.y, z + 4, 19, 12, 0xff3fd1);
  platform(state, 'safe', state.x - side * 7, state.y, z + 28, 11, 36, 0x27d9ff);
  platform(state, 'risk', state.x + side * 8, state.y + 3, z + 28, 8, 32, 0xffb126);
  platform(state, 'merge', state.x, state.y + 1, z + 49, 20, 10, 0x7b5cff);
  anchor(state, 'split-safe', [state.x - side * 5, state.y + 11, z + 22]);
  anchor(state, 'split-risk', [state.x + side * 8, state.y + 15, z + 24]);
  shardLine(
    state,
    'safe',
    [state.x - side * 7, state.y + 2, z + 15],
    [state.x - side * 7, state.y + 2, z + 41],
    5,
  );
  shardLine(
    state,
    'risk',
    [state.x + side * 8, state.y + 5, z + 15],
    [state.x + side * 8, state.y + 5, z + 41],
    8,
    true,
  );
  state.y += 1;
  checkpoint(state, `split-${state.chunk}`, state.x, state.y, z + 48);
  endChunk(state);
}

function curvedRoute(state: BuildState): void {
  const z = beginChunk(state, 'curved');
  const side = state.rng.sign();
  for (let index = 0; index < 4; index += 1) {
    const t = index / 3;
    const x = state.x + side * Math.sin(t * Math.PI * 0.55) * 9;
    platform(state, `curve-${index}`, x, state.y + t * 2, z + 6 + index * 14, 15, 16, 0x27d9ff);
    state.shards.push({
      id: `shard-${state.chunk}-curve-${index}`,
      position: [x, state.y + 2.3 + t * 2, z + 6 + index * 14],
      risky: index > 1,
    });
  }
  anchor(state, 'curve-a', [state.x + side * 6, state.y + 13, z + 21]);
  anchor(state, 'curve-b', [state.x + side * 10, state.y + 15, z + 39]);
  state.x += side * 9;
  state.y += 2;
  endChunk(state);
}

function wallRun(state: BuildState): void {
  const z = beginChunk(state, 'wall-run');
  const side = state.rng.sign();
  platform(state, 'launch', state.x, state.y, z + 7, 18, 16, 0xff3fd1);
  platform(state, 'wall', state.x + side * 7, state.y + 5, z + 28, 1.5, 30, 0xffb126, 'wall');
  platform(state, 'landing', state.x + side * 3, state.y + 1, z + 45, 19, 18, 0x27d9ff);
  anchor(state, 'rescue', [state.x - side * 4, state.y + 14, z + 31], 34);
  shardLine(
    state,
    'wall',
    [state.x + side * 5.8, state.y + 5, z + 17],
    [state.x + side * 5.8, state.y + 6, z + 38],
    7,
    true,
  );
  state.x += side * 3;
  state.y += 1;
  endChunk(state);
}

function railRoute(state: BuildState): void {
  const z = beginChunk(state, 'rail');
  const side = state.rng.sign();
  platform(state, 'launch', state.x, state.y, z + 7, 18, 16, 0x27d9ff);
  platform(state, 'landing', state.x + side * 6, state.y, z + 46, 19, 16, 0x7b5cff);
  state.rails.push({
    id: `rail-${state.chunk}`,
    start: [state.x + side * 2, state.y + 2, z + 13],
    end: [state.x + side * 6, state.y + 3, z + 40],
    neon: 0xff3fd1,
  });
  shardLine(
    state,
    'rail',
    [state.x + side * 2, state.y + 3.1, z + 15],
    [state.x + side * 6, state.y + 4.1, z + 38],
    8,
    true,
  );
  anchor(state, 'rail-rescue', [state.x - side * 4, state.y + 14, z + 29], 35);
  state.x += side * 6;
  endChunk(state);
}

function movingRoute(state: BuildState): void {
  const z = beginChunk(state, 'moving');
  platform(state, 'start', state.x, state.y, z + 5, 18, 14, 0x27d9ff);
  for (let index = 0; index < 3; index += 1) {
    platform(
      state,
      `moving-${index}`,
      state.x,
      state.y + index * 0.75,
      z + 18 + index * 11,
      10,
      9,
      index % 2 === 0 ? 0xffb126 : 0x7b5cff,
      'moving',
      {
        axis: index === 1 ? 'y' : 'x',
        distance: index === 1 ? 2 : 4,
        period: Math.max(2.75, 3.4 + index * 0.6 - state.chunk * 0.012),
        phase: state.rng.range(0, Math.PI * 2),
      },
    );
  }
  platform(state, 'landing', state.x, state.y + 2, z + 49, 18, 12, 0x27d9ff);
  anchor(state, 'moving-a', [state.x - 6, state.y + 14, z + 25]);
  anchor(state, 'moving-b', [state.x + 6, state.y + 15, z + 38]);
  shardLine(state, 'moving', [state.x, state.y + 4, z + 16], [state.x, state.y + 5, z + 45], 7);
  state.y += 2;
  checkpoint(state, `moving-${state.chunk}`, state.x, state.y, z + 49);
  endChunk(state);
}

function hazardRoute(state: BuildState): void {
  const z = beginChunk(state, 'hazard');
  platform(state, 'hazard-roof', state.x, state.y, z + 25, 24, 50, 0xff3fd1);
  state.hazards.push(
    {
      id: `laser-${state.chunk}`,
      kind: 'laser',
      position: [state.x, state.y + 2, z + 16],
      options: { width: 21, height: 5, phase: state.rng.range(0, 5), safeOffset: state.rng.sign() * 4 },
    },
    {
      id: `drone-${state.chunk}`,
      kind: 'drone',
      position: [state.x + state.rng.sign() * 6, state.y + 5, z + 30],
      options: { patrol: 5, phase: state.rng.range(0, Math.PI * 2) },
    },
    {
      id: `electric-${state.chunk}`,
      kind: 'electric',
      position: [state.x - 5, state.y + 1.1, z + 40],
      options: { width: 5, depth: 7, phase: state.rng.range(0, 4) },
    },
  );
  if (state.chunk >= 24) {
    state.hazards.push({
      id: `sign-${state.chunk}`,
      kind: 'sign',
      position: [state.x + state.rng.sign() * 7, state.y + 7, z + 47],
      options: { phase: state.rng.range(0, 5) },
    });
  }
  if (state.chunk >= 38) {
    state.hazards.push({
      id: `electric-extra-${state.chunk}`,
      kind: 'electric',
      position: [state.x + 5, state.y + 1.1, z + 7],
      options: { width: 4.5, depth: 6, phase: state.rng.range(0, 4) },
    });
  }
  shardLine(state, 'hazard-left', [state.x - 6, state.y + 2, z + 7], [state.x - 6, state.y + 2, z + 46], 6);
  shardLine(state, 'hazard-right', [state.x + 6, state.y + 2, z + 7], [state.x + 6, state.y + 2, z + 46], 6, true);
  const powerUpId = `power-${state.chunk}`;
  state.powerUps.push({
    id: powerUpId,
    position: [state.x + state.rng.sign() * 8, state.y + 2.3, z + 45],
    kind: deterministicPowerUpKind(state.seed, powerUpId) ?? 'shield',
  });
  endChunk(state);
}

function finalRoute(state: BuildState): void {
  const z = beginChunk(state, 'final');
  platform(state, 'final', state.x, state.y, z + 25, 24, 52, 0x27d9ff);
  state.hazards.push({
    id: `sign-${state.chunk}`,
    kind: 'sign',
    position: [state.x + state.rng.sign() * 7, state.y + 7, z + 20],
    options: { phase: state.rng.range(0, 5) },
  });
  shardLine(state, 'finish', [state.x, state.y + 2, z + 5], [state.x, state.y + 2, z + 45], 9);
  checkpoint(state, 'finish', state.x, state.y, z + 46);
  endChunk(state);
}

const BUILDERS: Readonly<Record<ChunkKind, (state: BuildState) => void>> = {
  beginner,
  grapple: grappleGap,
  split: splitRoute,
  curved: curvedRoute,
  'wall-run': wallRun,
  rail: railRoute,
  moving: movingRoute,
  hazard: hazardRoute,
  final: finalRoute,
};

/**
 * Produces a course made from deliberately safe authored patterns. Randomness
 * changes route side, timing and rewards, never the maximum playable gap.
 */
export function generateCourseLayout(
  seedInput: number | string,
  mode: RaceMode = 'practice',
  length: 'short' | 'standard' | 'long' = 'standard',
): CourseLayout {
  const seed = hashSeed(seedInput);
  const state: BuildState = {
    seed,
    rng: new SeededRandom(seed),
    chunks: [],
    platforms: [],
    anchors: [],
    checkpoints: [],
    shards: [],
    powerUps: [],
    rails: [],
    hazards: [],
    x: 0,
    y: 30,
    z: 0,
    chunk: 0,
  };

  let order: ChunkKind[];
  if (mode === 'tutorial') {
    order = ['beginner', 'grapple', 'split', 'wall-run', 'rail', 'hazard', 'final'];
  } else if (length === 'short') {
    order = ['beginner', 'grapple', 'split', 'rail', 'hazard', 'final'];
  } else {
    // 49 chunks / 2.542 km. The opening teaches every route family with an
    // extra grapple rehearsal, then their order varies and hazards layer up.
    order = [
      'beginner',
      'grapple',
      'split',
      'curved',
      'wall-run',
      'grapple',
      'rail',
      'moving',
      'hazard',
      'grapple',
      'split',
      'curved',
      'wall-run',
      'rail',
      'moving',
      'hazard',
      'split',
      'grapple',
      'curved',
      'wall-run',
      'rail',
      'moving',
      'hazard',
      'grapple',
      'curved',
      'split',
      'wall-run',
      'moving',
      'rail',
      'hazard',
      'split',
      'grapple',
      'wall-run',
      'curved',
      'rail',
      'moving',
      'hazard',
      'grapple',
      'split',
      'curved',
      'wall-run',
      'moving',
      'rail',
      'hazard',
      'grapple',
      'split',
      'moving',
      'hazard',
      'final',
    ];
    if (length === 'long') {
      order.splice(
        order.length - 1,
        0,
        'grapple',
        'curved',
        'wall-run',
        'rail',
        'moving',
        'hazard',
        'split',
        'grapple',
        'moving',
        'hazard',
      );
    }
  }

  for (const kind of order) {
    BUILDERS[kind](state);
  }

  const finalCheckpoint = state.checkpoints[state.checkpoints.length - 1];
  const finish: Vec3Tuple =
    finalCheckpoint === undefined
      ? [state.x, state.y + 2, state.z - 6]
      : [finalCheckpoint.position[0], finalCheckpoint.position[1], finalCheckpoint.position[2] + 2];

  return {
    seed,
    chunks: state.chunks,
    platforms: state.platforms,
    anchors: state.anchors,
    checkpoints: state.checkpoints,
    shards: state.shards,
    powerUps: state.powerUps,
    rails: state.rails,
    hazards: state.hazards,
    spawn: [0, 32.25, 2],
    finish,
    totalDistance: Math.max(1, finish[2] - 2),
  };
}
