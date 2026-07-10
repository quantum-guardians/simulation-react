import Matter from "matter-js";
import { buildHubRimWalls, type Corridor, type JunctionHub } from "./corridors";
import { AGENT_MAX_SPEED, AGENT_RADIUS } from "./presets";

const { Engine, Composite, Bodies } = Matter;

export const COLLISION_CATEGORY = {
  WALL: 0x0001,
  AGENT: 0x0002,
};

export interface PhysicsWorld {
  engine: Matter.Engine;
  wallBodies: Matter.Body[];
  agentBodies: Map<string, Matter.Body>;
}

const WALL_THICKNESS = 14;

export function createPhysicsWorld(): PhysicsWorld {
  const engine = Engine.create();
  engine.gravity.x = 0;
  engine.gravity.y = 0; // top-view: no downward pull, agents only move via steering
  // Higher than Matter's defaults (6/4) so heavily-crowded corridors (many
  // simultaneous agent-agent/agent-wall contacts) still converge instead of
  // leaving residual overlap that can slowly leak through thin walls.
  engine.positionIterations = 10;
  engine.velocityIterations = 8;
  return { engine, wallBodies: [], agentBodies: new Map() };
}

/**
 * Full teardown + rebuild of every wall body from the current corridor
 * floor plan. Intended to be called once per "Generate Paths" click or
 * node-drag mouseup (see plan) - not per animation frame or mousemove,
 * since tearing down/recreating dozens of static bodies at 60Hz would be
 * wasted work for what is fundamentally a floor-plan-editing interaction.
 *
 * Each corridor gets two long thin static rectangles (its left/right
 * walls), offset perpendicular to the corridor's direction by half its
 * width. Junction hub rims are closed with tessellated chord segments
 * (buildHubRimWalls), open only where corridors attach - crowd pressure
 * at a junction previously squeezed agents out through the open rim.
 */
export function rebuildWalls(
  world: PhysicsWorld,
  corridors: Corridor[],
  hubs: JunctionHub[]
): void {
  if (world.wallBodies.length > 0) {
    Composite.remove(world.engine.world, world.wallBodies);
  }

  const newWalls: Matter.Body[] = [];
  const wallOptions = {
    isStatic: true,
    friction: 0,
    restitution: 0,
    collisionFilter: { category: COLLISION_CATEGORY.WALL, mask: COLLISION_CATEGORY.AGENT },
  };

  for (const corridor of corridors) {
    if (corridor.length <= 0) continue;
    const halfWidth = corridor.width / 2;
    const midX = (corridor.a.x + corridor.b.x) / 2;
    const midY = (corridor.a.y + corridor.b.y) / 2;
    const perpX = -Math.sin(corridor.angle);
    const perpY = Math.cos(corridor.angle);
    const offset = halfWidth + WALL_THICKNESS / 2;

    newWalls.push(
      Bodies.rectangle(
        midX + perpX * offset,
        midY + perpY * offset,
        corridor.length,
        WALL_THICKNESS,
        { ...wallOptions, angle: corridor.angle }
      ),
      Bodies.rectangle(
        midX - perpX * offset,
        midY - perpY * offset,
        corridor.length,
        WALL_THICKNESS,
        { ...wallOptions, angle: corridor.angle }
      )
    );
  }

  for (const segment of buildHubRimWalls(hubs, corridors, WALL_THICKNESS)) {
    newWalls.push(
      Bodies.rectangle(segment.center.x, segment.center.y, segment.length, WALL_THICKNESS, {
        ...wallOptions,
        angle: segment.angle,
      })
    );
  }

  Composite.add(world.engine.world, newWalls);
  world.wallBodies = newWalls;
}

export function addAgentBody(
  world: PhysicsWorld,
  id: string,
  x: number,
  y: number,
  radius: number = AGENT_RADIUS
): Matter.Body {
  const body = Bodies.circle(x, y, radius, {
    inertia: Infinity, // prevents spurious spin from off-center collisions
    frictionAir: 0.08,
    friction: 0,
    // No bounce: a crowd should queue/slide against walls and each other,
    // not bounce back (bouncing read as agents "reversing direction").
    restitution: 0,
    collisionFilter: {
      category: COLLISION_CATEGORY.AGENT,
      mask: COLLISION_CATEGORY.AGENT | COLLISION_CATEGORY.WALL,
    },
  });
  Composite.add(world.engine.world, body);
  world.agentBodies.set(id, body);
  return body;
}

export function removeAgentBody(world: PhysicsWorld, id: string): void {
  const body = world.agentBodies.get(id);
  if (!body) return;
  Composite.remove(world.engine.world, body);
  world.agentBodies.delete(id);
}

export const FIXED_DT_MS = 1000 / 60;

// Max distance any body may travel within a single Engine.update. Matter
// has no continuous collision detection, so per-step displacement must
// stay well under the agent radius (5) and wall thickness (14) or fast
// bodies can embed past a wall's midplane and get ejected out the far side.
const MAX_STEP_DISPLACEMENT_PX = 3;

/** One fixed-size physics step, internally subdivided so no body can move
 * more than MAX_STEP_DISPLACEMENT_PX per Engine.update at the given max
 * speed. Callers accumulate variable rAF deltas and call this in a
 * `while (acc >= FIXED_DT_MS)` loop. At the default 25 px/s this is a
 * single update (no overhead); at 500 px/s it becomes 3 sub-updates. */
export function stepPhysicsFixed(
  world: PhysicsWorld,
  dtMs: number = FIXED_DT_MS,
  maxSpeedPxPerSec: number = AGENT_MAX_SPEED
): void {
  const displacementPerStep = (maxSpeedPxPerSec * dtMs) / 1000;
  const substeps = Math.max(1, Math.ceil(displacementPerStep / MAX_STEP_DISPLACEMENT_PX));
  const subDt = dtMs / substeps;
  for (let i = 0; i < substeps; i++) {
    Engine.update(world.engine, subDt);
  }
}

export function destroyPhysicsWorld(world: PhysicsWorld): void {
  Composite.clear(world.engine.world, false);
  Engine.clear(world.engine);
}
