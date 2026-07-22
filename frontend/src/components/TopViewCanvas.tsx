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
  enforceContainment,
  respawnArrivedAgents,
  spawnAgent,
  type AdjacencyEntry,
  type AgentRuntimeState,
} from "../simulation/agents";
import { AGENT_MAX_SPEED, AGENT_RADIUS } from "../simulation/presets";
import { computeCorridorOccupancy } from "../simulation/density";
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
  onAgentCountChange?: (count: number) => void;
}

const RESPAWN_CHECK_INTERVAL_MS = 250;

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
  onAgentCountChange,
}: TopViewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const positionsRef = useRef<Map<string, Point>>(new Map(nodePositions));
  const draggingNodeIdRef = useRef<string | null>(null);
  const dragOffsetRef = useRef<Point>({ x: 0, y: 0 });

  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const propsRef = useRef({ corridors, hubs, orientedEdges, showGraphOverlay, nodeIds, edges, agentSpeed });
  useEffect(() => {
    propsRef.current = { corridors, hubs, orientedEdges, showGraphOverlay, nodeIds, edges, agentSpeed };
  }, [corridors, hubs, orientedEdges, showGraphOverlay, nodeIds, edges, agentSpeed]);

  const physicsWorldRef = useRef<SfmWorld | null>(null);
  const agentsRef = useRef<AgentRuntimeState[]>([]);
  const simulationConfigRef = useRef<SimulationConfig | null>(null);
  const nodePositionsForSimRef = useRef<Map<string, Point>>(new Map(nodePositions));
  const densityByCorridorRef = useRef<Map<string, number>>(new Map());
  const nextAgentIndexRef = useRef(0);
  const lastAddRequestIdRef = useRef<number | null>(null);
  const lastValidPositionsRef = useRef<Map<string, Point>>(new Map());

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

    const agents: AgentRuntimeState[] = [];
    for (let i = 0; i < simulation.agentCount; i++) {
      const agent = spawnAgent(`agent-${nextAgentIndexRef.current++}`, {
        world,
        nodePositions: nodePositionsForSimRef.current,
        adjacency: simulation.adjacency,
        nodeIds,
        leaves: simulation.leaves,
        lastValidPositions: lastValidPositionsRef.current,
      });
      if (agent) agents.push(agent);
    }
    agentsRef.current = agents;
    onAgentCountChange?.(agents.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulation, corridors, hubs, nodeIds]);

  // Spawn additional agents into the CURRENT running world/population
  // whenever the user clicks "Add" - independent of the full
  // generation-reset above, so adding people doesn't restart everyone
  // already mid-corridor.
  useEffect(() => {
    if (!addAgentsRequest) return;
    if (lastAddRequestIdRef.current === addAgentsRequest.requestId) return;
    lastAddRequestIdRef.current = addAgentsRequest.requestId;

    const world = physicsWorldRef.current;
    const config = simulationConfigRef.current;
    if (!world || !config) return;

    const added: AgentRuntimeState[] = [];
    for (let i = 0; i < addAgentsRequest.count; i++) {
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
    agentsRef.current = [...agentsRef.current, ...added];
    onAgentCountChange?.(agentsRef.current.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const agentPositions = Array.from(world.agents.values()).map((a) => a.position);
      drawAgents(ctx, agentPositions, AGENT_RADIUS);
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
    let lastRespawnCheck = 0;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const delta = Math.min(now - last, 200);
      last = now;

      const world = physicsWorldRef.current;
      if (isPlayingRef.current && world) {
        acc += delta;
        // Steering (incl. waypoint-arrival checks) runs inside the same
        // per-tick loop as the physics step, not once per frame - otherwise
        // a slow frame lets an agent overshoot several ticks' worth of
        // distance before the next arrival check, which reads as the agent
        // suddenly reversing direction.
        while (acc >= FIXED_DT_MS) {
          const desired = computeDesiredDirections(agentsRef.current, world, propsRef.current.agentSpeed);
          stepSocialForce(world, desired, FIXED_DT_MS, propsRef.current.agentSpeed);
          enforceContainment(
            world,
            propsRef.current.corridors,
            propsRef.current.hubs,
            lastValidPositionsRef.current
          );
          acc -= FIXED_DT_MS;
        }

        lastRespawnCheck += delta;
        if (lastRespawnCheck >= RESPAWN_CHECK_INTERVAL_MS) {
          lastRespawnCheck = 0;
          if (simulationConfigRef.current) {
            const config = simulationConfigRef.current;
            agentsRef.current = respawnArrivedAgents(agentsRef.current, {
              world,
              nodePositions: nodePositionsForSimRef.current,
              adjacency: config.adjacency,
              nodeIds: propsRef.current.nodeIds,
              leaves: config.leaves,
              lastValidPositions: lastValidPositionsRef.current,
            });
          }
          const agentPositions = Array.from(world.agents.values()).map((a) => a.position);
          densityByCorridorRef.current = computeCorridorOccupancy(propsRef.current.corridors, agentPositions);
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
