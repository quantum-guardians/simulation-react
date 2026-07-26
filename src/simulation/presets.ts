export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 560;

export const CORRIDOR_WIDTH_OPTIONS = {
  minWidth: 24,
  maxWidth: 100,
  widthScale: 6,
};

// A 4 px body leaves enough clearance for two directed lanes in the
// narrowest practical corridor (weight 1 => 30 px) while still reading as
// a pedestrian at the current canvas scale.
export const AGENT_RADIUS = 4;
export const AGENT_MAX_SPEED = 25; // px/s
export const ARRIVAL_RADIUS = 10; // px
/** Offset from the corridor centerline used for right-hand traffic. Opposite
 * directions therefore use opposite physical sides instead of meeting on
 * one centerline and forming a face-to-face arch. */
export const AGENT_LANE_OFFSET = 5;

export const respawnOnArrival = true;

export const DEFAULT_AGENT_COUNT = 20;

/** "Add" spawns agents a few at a time on this interval instead of dumping
 * the whole requested count in one frame, which would drop a pile of
 * deeply-overlapping bodies on the floor at once. */
export const ADD_AGENTS_BATCH_SIZE = 5;
export const ADD_AGENTS_BATCH_INTERVAL_MS = 200;

/** Caps how many arrived agents get respawned per RESPAWN_CHECK_INTERVAL_MS
 * tick. Agents that traveled together tend to arrive together; respawning
 * all of them in the same instant dumps a fresh crush back onto whatever
 * node they land on, re-creating the exact entrance-congestion pile this is
 * meant to avoid. The rest simply wait for the next check instead of
 * disappearing. */
export const RESPAWN_BATCH_SIZE = 3;

// ---------------------------------------------------------------------------
// Social Force Model (Helbing & Molnár) constants.
//
// Pixel scale: AGENT_RADIUS 4 px ≈ 0.2 m ⇒ 20 px/m. Mass is normalized to 1
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
export const SFM_K_BODY = 700;

/** Sliding-friction coefficient (1/(px·s)): 2.4e5 kg/(m·s) ÷ 80 kg ÷ 20 px/m. */
export const SFM_KAPPA = 30;

/** Clamp on the summed repulsive acceleration per agent (px/s²), so a deep
 * spawn overlap can't launch anyone across the map in one step. */
export const SFM_MAX_ACCEL = 2500;

/** Speed cap as a multiple of the desired speed (Helbing's v_max/v0). */
export const SFM_SPEED_FACTOR = 1.3;

/** Interactions beyond r + CUTOFF_FACTOR·B are skipped (exp term < 0.7%). */
export const SFM_CUTOFF_FACTOR = 5;

/** Anisotropic perception floor (Helbing & Molnár 1995): pedestrians weigh
 * the long-range social force by how far the other person is from their
 * forward field of view - full strength for someone ahead, only this
 * fraction for someone directly behind. Never applied to the hard
 * body-contact spring, so actual touch is still felt at full strength
 * regardless of facing. Without this, every agent dodges people behind it
 * as strongly as people it's walking toward, which reads as unnaturally
 * omniscient. 1 = isotropic (old behavior). */
export const SFM_ANISOTROPY_LAMBDA = 0.5;

/** Per-agent desired-speed multiplier range, assigned once at spawn. Real
 * pedestrians don't all walk at one identical pace; without this every
 * agent in a cleared crowd converges to the exact same cruise speed, which
 * reads as a swarm of clones rather than individuals. */
export const AGENT_SPEED_VARIANCE_MIN = 0.82;
export const AGENT_SPEED_VARIANCE_MAX = 1.18;

// ---------------------------------------------------------------------------
// Impatience ("faster is slower" clog-breaking).
//
// A bottleneck narrower than the crowd trying to pass it can jam: every
// agent's forward push is exactly balanced by neighbors' repulsion, so
// nobody's velocity ever grows enough to widen the gap that would let
// someone through. Real crowds break this by pushing harder the longer
// they're stuck (Helbing & Johansson's "panic"/motivation increase). An
// agent moving well below its own desired speed for a while gets a growing
// speed boost - i.e. a stronger driving force toward its actual goal, not a
// random nudge - until it breaks free, then relaxes back to normal.
// ---------------------------------------------------------------------------

/** Below this fraction of an agent's own desired speed counts as "stuck" this tick. */
export const STUCK_SPEED_FRACTION = 0.3;

/** Ticks (at 60 Hz) of continuous stuck state tolerated before impatience starts. */
export const STUCK_PATIENCE_TICKS = 90; // 1.5 s

/** Ticks of sustained stuck-ness to go from zero impatience to the max boost. */
export const STUCK_RAMP_TICKS = 120; // 2 s

/** Maximum extra fraction added to desired speed once fully impatient. */
export const STUCK_BOOST_MAX = 1;

/** At full impatience, keep only this fraction of the long-range social
 * repulsion. Hard contact and wall collision remain at full strength. This
 * is the final deadlock breaker: an agent can squeeze through a stationary
 * social-force equilibrium without ever passing through another body. */
export const STUCK_SOCIAL_FORCE_MIN = 0;

// ---------------------------------------------------------------------------
// Crowd-pressure injury model.
// ---------------------------------------------------------------------------

/** Distance beyond physical contact over which compression starts building. */
export const PRESSURE_CONTACT_RANGE_PX = 3;

/** Normalized simultaneous compression needed to start fatal exposure. */
export const PRESSURE_DEATH_THRESHOLD = 3.5;

/** Sustained simulated seconds above the threshold before an agent dies. */
export const PRESSURE_DEATH_SECONDS = 3;

/** Exposure recovers this many times faster than it accumulates. */
export const PRESSURE_RECOVERY_RATE = 3;

/** Pressure is sampled every this many physics ticks (with exposure scaled
 * by the same factor) instead of at 60 Hz - death needs seconds of
 * sustained exposure, so per-tick sampling only costs an extra O(n) pass. */
export const PRESSURE_CHECK_EVERY_TICKS = 4;

/** Maximum random deviation (radians) applied to a stuck agent's desired
 * direction, scaled by the same impatience fraction as the speed boost.
 * A pure speed increase can't break a geometric arch at a bottleneck - the
 * forces around it are in exact balance regardless of how hard any one
 * agent pushes straight ahead, the classic granular-flow "clog" (Helbing
 * 2000). This is the model's fluctuation term ξ (present in the original
 * Helbing & Molnár 1995 formulation but otherwise unused here): a stuck
 * agent tries a slightly different angle each tick instead of pushing on
 * the same locked line, which is enough to break the arch. Agents that
 * aren't stuck (boost 0) are completely unaffected - no jitter is added to
 * normal flow. */
export const STUCK_JITTER_MAX_RAD = Math.PI / 8; // 22.5°
