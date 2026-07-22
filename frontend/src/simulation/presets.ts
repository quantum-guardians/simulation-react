export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 560;

export const CORRIDOR_WIDTH_OPTIONS = {
  minWidth: 20,
  maxWidth: 100,
  widthScale: 6,
};

export const AGENT_RADIUS = 5;
export const AGENT_MAX_SPEED = 25; // px/s
export const ARRIVAL_RADIUS = 10; // px

export const respawnOnArrival = true;

export const DEFAULT_AGENT_COUNT = 20;

// ---------------------------------------------------------------------------
// Social Force Model (Helbing & Molnár) constants.
//
// Pixel scale: AGENT_RADIUS 5 px ≈ 0.25 m ⇒ 20 px/m. Mass is normalized to 1
// (Helbing 2000's Newton-valued constants divided by the 80 kg reference
// pedestrian), so every "force" below is an acceleration in px/s².
// Deviations from the paper's values are deliberate tuning for this app's
// geometry (corridors as narrow as 20 px) and 60 Hz integration.
// ---------------------------------------------------------------------------

/** Relaxation time of the driving force (s). */
export const SFM_TAU = 0.5;

/** Agent-agent social repulsion strength (px/s²). Paper: 2000 N ≈ 500 px/s²;
 * softened so two opposing agents can still pass in a 20 px corridor. */
export const SFM_A_AGENT = 300;

/** Agent-agent repulsion range (px). Paper: 0.08 m ≈ 1.6 px; widened so the
 * default-speed equilibrium spacing lands near one body diameter. */
export const SFM_B_AGENT = 4;

/** Wall repulsion strength (px/s²). Stronger than the agent term so crowd
 * pressure squeezes people along a wall rather than through it. */
export const SFM_A_WALL = 500;

/** Wall repulsion range (px). */
export const SFM_B_WALL = 4;

/** Body-contact spring (1/s², unit-invariant): 1.2e5 kg/s² ÷ 80 kg. */
export const SFM_K_BODY = 1500;

/** Sliding-friction coefficient (1/(px·s)): 2.4e5 kg/(m·s) ÷ 80 kg ÷ 20 px/m. */
export const SFM_KAPPA = 150;

/** Clamp on the summed repulsive acceleration per agent (px/s²), so a deep
 * spawn overlap can't launch anyone across the map in one step. */
export const SFM_MAX_ACCEL = 2500;

/** Speed cap as a multiple of the desired speed (Helbing's v_max/v0). */
export const SFM_SPEED_FACTOR = 1.3;

/** Interactions beyond r + CUTOFF_FACTOR·B are skipped (exp term < 0.7%). */
export const SFM_CUTOFF_FACTOR = 5;
