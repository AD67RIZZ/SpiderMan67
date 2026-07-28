import type { CourseLayout, RaceMode } from './types';
import { generateCourseLayout } from './ChunkPatterns';

/**
 * Kept as a tiny facade so menu previews, servers and RaceWorld can all use
 * exactly the same deterministic course recipe.
 */
export class CityGenerator {
  static generate(
    seed: number | string,
    mode: RaceMode = 'practice',
    length: 'short' | 'standard' | 'long' = 'standard',
  ): CourseLayout {
    return generateCourseLayout(seed, mode, length);
  }
}
