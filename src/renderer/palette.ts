/**
 * Renderer color palette (spec §20-21, §41-44): "observing digital life through a
 * microscope" — black background, dim scientific glows, minimal color use. Kept as plain
 * constants (numbers three.js accepts as hex colors) so the whole visual language lives
 * in one place.
 *
 * IMPORTANT (spec §9/§11/§32): Signal A/B colors are an arbitrary visual key so the two
 * kinds can be told apart on screen. They carry no semantic meaning and nothing in this
 * file (or elsewhere in the renderer) may map a signal to a concept.
 */

export const COLORS = {
  /** WebGLRenderer clear color: the dark space the world floats in. */
  background: 0x050508,

  /** Faint square outline marking the (wrapping) world bounds. */
  worldBounds: 0x8fa5b8,
  worldBoundsOpacity: 0.25,

  /** Bug hue base (HSL hue, 0..1) and per-generation hue drift, spec §43. */
  bugHueBase: 0.55,
  bugHuePerGeneration: 0.045,
  bugSaturation: 0.7,

  /** Selected-bug highlight ring. */
  selectionRing: 0xffffff,

  /** Predators: a big, slow, cool-white/magenta glow with a darker core. */
  predatorGlow: 0xd9a8ff,
  predatorCore: 0x241026,

  /** Food: tiny, dim green-ish points. */
  food: 0x4fdc82,
} as const;

/** Visual key for the two emittable signal kinds. Arbitrary — see file header. */
export const SIGNAL_COLORS: Readonly<Record<'A' | 'B', number>> = {
  A: 0x4fd1ff,
  B: 0xffb347,
};

/** Base point sizes in world units (before the camera's pixels-per-world-unit scale). */
export const SIZES = {
  bug: 0.9,
  food: 0.3,
  predator: 1.8,
  selectionRing: 1.4,
} as const;
