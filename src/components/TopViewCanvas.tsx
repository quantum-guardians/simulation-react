import { useEffect, useRef } from "react";
import type { Point, RawEdge } from "../simulation/graph";
import type { Corridor, JunctionHub } from "../simulation/corridors";
import {
  clearCanvas,
  drawAgents,
  drawCorridorFloor,
  drawGraphOverlay,
  drawOrientedArrows,
  hitTestNode,
} from "../simulation/draw";
import {
  createSfmWorld,
  rebuildWalls,
  stepSocialForce,
  FIXED_DT_MS,
  type SfmWorld,
} from "../simulation/socialForce";
import {
  computeDesiredDirections,
  constrainAgentsToRoutes,
  continueArrivedAgents,
  spawnAgent,
  type AdjacencyEntry,
  type AgentRuntimeState,
} from "../simulation/agents";
import {
  ADD_AGENTS_BATCH_INTERVAL_MS,
  ADD_AGENTS_BATCH_SIZE,
  AGENT_MAX_SPEED,
  AGENT_RADIUS,
  PRESSURE_CHECK_EVERY_TICKS,
  PRESSURE_DEATH_THRESHOLD,
  STUCK_PATIENCE_TICKS,
  STUCK_RAMP_TICKS,
} from "../simulation/presets";
import { computeCorridorOccupancy } from "../simulation/density";
import { updatePressureDeaths } from "../simulation/pressure";
import type { OrientedEdge } from "../api/types";

export interface SimulationConfig {
  /** Bump this (e.g. Date.now() or a counter) to trigger a fresh
   * physics world + agent population, such as on "Generate Paths". */
  generation: number;
  agentCount: number;
  leaves: string[];
  adjacency: Map<string, AdjacencyEntry[]>;
}

export interface AddAgentsRequest {
  /** Bump this (e.g. an incrementing counter) each time "Add" is clicked;
   * a repeated identical request object is ignored. */
  requestId: number;
  count: number;
}

export interface StuckAgentInfo {
  id: string;
  target: string;
  waypoint: number;
  stuckSeconds: number;
  x: number;
  y: number;
}

export interface SimulationStats {
  moving: number;
  arrived: number;
  dead: number;
  peakPressure: number;
  stuck: StuckAgentInfo[];
}

/** Changing this value intentionally remounts the canvas from App.tsx.
 * That also replaces a long-lived requestAnimationFrame closure during
 * Vite Hot Reload, so an old physics engine cannot survive a code update. */
export const SIMULATION_ENGINE_VERSION = "hybrid-social-force-v8-pressure";

export interface TopViewCanvasProps {
  width: number;
  height: number;
  nodeIds: string[];
  edges: RawEdge[];
  nodePositions: Map<string, Point>;
  onNodePositionsChange: (positions: Map<string, Point>) => void;
  orientedEdges?: OrientedEdge[];
  showGraphOverlay?: boolean;
  corridors?: Corridor[];
  hubs?: JunctionHub[];
  simulation?: SimulationConfig | null;
  addAgentsRequest?: AddAgentsRequest | null;
  isPlaying?: boolean;
  agentSpeed?: number;
  playbackRate?: number;
  onAgentCountChange?: (count: number) => void;
  onSimulationStatsChange?: (stats: SimulationStats) => void;
}

const DENSITY_CHECK_INTERVAL_MS = 250;

export function TopViewCanvas({
  width,
  height,
  nodeIds,
  edges,
  nodePositions,
  onNodePositionsChange,
  orientedEdges = [],
  showGraphOverlay = true,
  corridors = [],
  hubs = [],
  simulation = null,
  addAgentsRequest = null,
  isPlaying = false,
  agentSpeed = AGENT_MAX_SPEED,
  playbackRate = 1,
  onAgentCountChange,
  onSimulationStatsChange,
}: TopViewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const positionsRef = useRef<Map<string, Point>>(new Map(nodePositions));
  const draggingNodeIdRef = useRef<string | null>(null);
  const dragOffsetRef = useRef<Point>({ x: 0, y: 0 });

  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const onSimulationStatsChangeRef = useRef(onSimulationStatsChange);
  useEffect(() => {
    onSimulationStatsChangeRef.current = onSimulationStatsChange;
  }, [onSimulationStatsChange]);

  const propsRef = useRef({
    corridors,
    hubs,
    orientedEdges,
    showGraphOverlay,
    nodeIds,
    edges,
    agentSpeed,
    playbackRate,
  });
  useEffect(() => {
    propsRef.current = {
      corridors,
      hubs,
      orientedEdges,
      showGraphOverlay,
      nodeIds,
      edges,
      agentSpeed,
      playbackRate,
    };
  }, [
    corridors,
    hubs,
    orientedEdges,
    showGraphOverlay,
    nodeIds,
    edges,
    agentSpeed,
    playbackRate,
  ]);

  const physicsWorldRef = useRef<SfmWorld | null>(null);
  const agentsRef = useRef<AgentRuntimeState[]>([]);
  const simulationConfigRef = useRef<SimulationConfig | null>(null);
  const nodePositionsForSimRef = useRef<Map<string, Point>>(new Map(nodePositions));
  const densityByCorridorRef = useRef<Map<string, number>>(new Map());
  const nextAgentIndexRef = useRef(0);
  const lastAddRequestIdRef = useRef<number | null>(null);
  const lastValidPositionsRef = useRef<Map<string, Point>>(new Map());
  /** Agents still owed to the population from "Add" clicks, drained a few at
   * a time by the tick loop instead of spawned all at once. */
  const pendingAddCountRef = useRef(0);

  // Keep the live-drag ref in sync whenever the committed prop changes
  // (e.g. after "Generate Paths" recomputes a layout, or a drag commits).
  useEffect(() => {
    positionsRef.current = new Map(nodePositions);
    nodePositionsForSimRef.current = new Map(nodePositions);
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodePositions, edges, nodeIds, orientedEdges, showGraphOverlay, corridors, hubs]);

  // (Re)build the physics world + spawn the initial agent population
  // whenever `simulation.generation` changes - e.g. once per "Generate
  // Paths" click - not on every render.
  useEffect(() => {
    if (!simulation) {
      physicsWorldRef.current = null;
      agentsRef.current = [];
      simulationConfigRef.current = null;
      pendingAddCountRef.current = 0;
      return;
    }
    const isNewGeneration = simulationConfigRef.current?.generation !== simulation.generation;
    // Always adopt the latest config (e.g. a re-solved, updated adjacency
    // after "Run Solver") so future spawns/respawns route by it, even when
    // this isn't a new generation and we're about to bail out below
    // without touching the already-running world/agents.
    simulationConfigRef.current = simulation;
    if (!isNewGeneration) return;

    const world = createSfmWorld();
    rebuildWalls(world, corridors, hubs);
    physicsWorldRef.current = world;
    nextAgentIndexRef.current = 0;
    lastValidPositionsRef.current.clear();
    pendingAddCountRef.current = 0;

    // Initial population uses the same paced queue as later "Add" clicks.
    // Spawning a large population at once creates a physically impossible
    // pile at a handful of leaf nodes and is the main source of persistent
    // entrance jams.
    agentsRef.current = [];
    pendingAddCountRef.current = simulation.agentCount;
    onAgentCountChange?.(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulation, corridors, hubs, nodeIds]);

  // Queue additional agents for the CURRENT running world/population
  // whenever the user clicks "Add" - independent of the full
  // generation-reset above, so adding people doesn't restart everyone
  // already mid-corridor. The tick loop below drains this queue a few
  // agents at a time instead of spawning the whole batch in one frame.
  useEffect(() => {
    if (!addAgentsRequest) return;
    if (lastAddRequestIdRef.current === addAgentsRequest.requestId) return;
    lastAddRequestIdRef.current = addAgentsRequest.requestId;
    pendingAddCountRef.current += addAgentsRequest.count;
  }, [addAgentsRequest]);

  // Rebuild wall bodies (without respawning agents) whenever the corridor
  // floor plan itself changes, e.g. after a node drag commits mid-sim.
  // Stale last-valid positions from the OLD floor plan could pin agents to
  // spots outside the new one, so drop them; agents inside the new floor
  // re-record on the next tick.
  useEffect(() => {
    if (physicsWorldRef.current) {
      rebuildWalls(physicsWorldRef.current, corridors, hubs);
      lastValidPositionsRef.current.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corridors, hubs]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { corridors, hubs, orientedEdges, showGraphOverlay, nodeIds, edges } = propsRef.current;

    clearCanvas(ctx, width, height);
    if (corridors.length > 0) {
      drawCorridorFloor(ctx, corridors, hubs, densityByCorridorRef.current);
    }
    if (showGraphOverlay) {
      drawGraphOverlay(ctx, nodeIds, edges, positionsRef.current, draggingNodeIdRef.current);
    }
    if (orientedEdges.length > 0) {
      drawOrientedArrows(ctx, positionsRef.current, orientedEdges);
    }
    const world = physicsWorldRef.current;
    if (world && world.agents.size > 0) {
      // Iterate runtime states and look bodies up in the world's Map
      // directly - building an id→state Map here every frame (60 Hz ×
      // agent count) was measurable GC churn.
      const severeStuckTicks = STUCK_PATIENCE_TICKS + STUCK_RAMP_TICKS;
      const agentVisuals = [];
      for (const state of agentsRef.current) {
        const body = world.agents.get(state.id);
        if (!body) continue;
        agentVisuals.push({
          x: body.position.x,
          y: body.position.y,
          id: body.id,
          vx: body.velocity.x,
          vy: body.velocity.y,
          targetLabel: state.targetLeaf,
          isDead: state.state === "dead",
          pressureRatio: Math.min(
            1,
            (state.pressure ?? 0) / PRESSURE_DEATH_THRESHOLD
          ),
          isStuck:
            state.state === "moving" &&
            (state.stuckTicks ?? 0) >= severeStuckTicks,
        });
      }
      drawAgents(ctx, agentVisuals, AGENT_RADIUS);
    }
  }

  // Single rAF loop: steers agents, steps physics on a fixed-timestep
  // accumulator, and redraws every frame. Runs for the component's whole
  // lifetime; isPlayingRef gates whether physics actually advances so
  // toggling play/pause doesn't need to re-subscribe this effect.
  useEffect(() => {
    let raf: number;
    let acc = 0;
    let last = performance.now();
    let lastDensityCheck = 0;
    let lastAddBatchCheck = 0;
    let ticksSincePressureCheck = 0;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const delta = Math.min(now - last, 200);
      last = now;

      const world = physicsWorldRef.current;

      // Drain the "Add" queue a few agents at a time on a fixed interval,
      // independent of isPlaying, so a paused sim still grows its
      // population once resumed instead of losing the request.
      if (world && simulationConfigRef.current) {
        lastAddBatchCheck += delta;
        if (lastAddBatchCheck >= ADD_AGENTS_BATCH_INTERVAL_MS && pendingAddCountRef.current > 0) {
          lastAddBatchCheck = 0;
          const config = simulationConfigRef.current;
          const batchSize = Math.min(ADD_AGENTS_BATCH_SIZE, pendingAddCountRef.current);
          const added: AgentRuntimeState[] = [];
          for (let i = 0; i < batchSize; i++) {
            const agent = spawnAgent(`agent-${nextAgentIndexRef.current++}`, {
              world,
              nodePositions: nodePositionsForSimRef.current,
              adjacency: config.adjacency,
              nodeIds: propsRef.current.nodeIds,
              leaves: config.leaves,
              lastValidPositions: lastValidPositionsRef.current,
            });
            if (agent) added.push(agent);
          }
          pendingAddCountRef.current -= batchSize;
          agentsRef.current = [...agentsRef.current, ...added];
          onAgentCountChange?.(agentsRef.current.length);
        }
      }

      if (isPlayingRef.current && world) {
        acc += delta * propsRef.current.playbackRate;
        // Steering (incl. waypoint-arrival checks) runs inside the same
        // per-tick loop as the physics step, not once per frame - otherwise
        // a slow frame lets an agent overshoot several ticks' worth of
        // distance before the next arrival check, which reads as the agent
        // suddenly reversing direction.
        let stepsThisFrame = 0;
        while (acc >= FIXED_DT_MS && stepsThisFrame < 12) {
          if (simulationConfigRef.current) {
            const config = simulationConfigRef.current;
            agentsRef.current = continueArrivedAgents(agentsRef.current, {
              world,
              nodePositions: nodePositionsForSimRef.current,
              adjacency: config.adjacency,
              nodeIds: propsRef.current.nodeIds,
              leaves: config.leaves,
              lastValidPositions: lastValidPositionsRef.current,
            });
          }
          const desired = computeDesiredDirections(agentsRef.current, world, propsRef.current.agentSpeed);
          stepSocialForce(world, desired, FIXED_DT_MS, propsRef.current.agentSpeed);
          constrainAgentsToRoutes(agentsRef.current, world);
          // Pressure death needs seconds of sustained exposure; sample it
          // on a coarser cadence with the elapsed tick count instead of
          // paying the contact scan every physics tick.
          ticksSincePressureCheck++;
          if (ticksSincePressureCheck >= PRESSURE_CHECK_EVERY_TICKS) {
            updatePressureDeaths(agentsRef.current, world, ticksSincePressureCheck);
            ticksSincePressureCheck = 0;
          }
          acc -= FIXED_DT_MS;
          stepsThisFrame++;
        }
        // Do not attempt to replay a long background-tab pause in one frame.
        if (stepsThisFrame === 12) acc = Math.min(acc, FIXED_DT_MS);

        lastDensityCheck += delta;
        if (lastDensityCheck >= DENSITY_CHECK_INTERVAL_MS) {
          lastDensityCheck = 0;
          const agentPositions = Array.from(world.agents.values()).map((a) => a.position);
          densityByCorridorRef.current = computeCorridorOccupancy(propsRef.current.corridors, agentPositions);

          const severeStuckTicks = STUCK_PATIENCE_TICKS + STUCK_RAMP_TICKS;
          const stuck = agentsRef.current
            .filter(
              (agent) =>
                agent.state === "moving" && (agent.stuckTicks ?? 0) >= severeStuckTicks
            )
            .map((agent) => {
              const body = world.agents.get(agent.id);
              return {
                id: agent.id,
                target: agent.targetLeaf,
                waypoint: agent.waypointIndex,
                stuckSeconds: (agent.stuckTicks ?? 0) / 60,
                x: body?.position.x ?? 0,
                y: body?.position.y ?? 0,
              };
            });
          onSimulationStatsChangeRef.current?.({
            moving: agentsRef.current.filter((agent) => agent.state === "moving").length,
            arrived: agentsRef.current.filter((agent) => agent.state === "arrived").length,
            dead: agentsRef.current.filter((agent) => agent.state === "dead").length,
            peakPressure: agentsRef.current.reduce(
              (maximum, agent) => Math.max(maximum, agent.pressure ?? 0),
              0
            ),
            stuck,
          });
        }
      }
      draw();
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getCanvasPoint(e: React.MouseEvent<HTMLCanvasElement>): Point {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const point = getCanvasPoint(e);
    const hitId = hitTestNode(positionsRef.current, point.x, point.y);
    if (!hitId) return;
    draggingNodeIdRef.current = hitId;
    const nodePos = positionsRef.current.get(hitId)!;
    dragOffsetRef.current = { x: nodePos.x - point.x, y: nodePos.y - point.y };
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const draggingId = draggingNodeIdRef.current;
    if (!draggingId) return;
    const point = getCanvasPoint(e);
    const next = {
      x: point.x + dragOffsetRef.current.x,
      y: point.y + dragOffsetRef.current.y,
    };
    positionsRef.current.set(draggingId, next);
  }

  function commitDrag() {
    if (!draggingNodeIdRef.current) return;
    draggingNodeIdRef.current = null;
    nodePositionsForSimRef.current = new Map(positionsRef.current);
    onNodePositionsChange(new Map(positionsRef.current));
  }

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={commitDrag}
      onMouseLeave={commitDrag}
      style={{ background: "#1c1f26" }}
    />
  );
}
