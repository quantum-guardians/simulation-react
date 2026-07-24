import { useEffect, useState } from "react";
import { GraphCsvInput } from "./components/GraphCsvInput";
import { ControlPanel } from "./components/ControlPanel";
import { SolverPanel } from "./components/SolverPanel";
import { ScorePanel } from "./components/ScorePanel";
import { WarningsPanel } from "./components/WarningsPanel";
import { DensityLegend } from "./components/DensityLegend";
import {
  TopViewCanvas,
  SIMULATION_ENGINE_VERSION,
  type AddAgentsRequest,
  type SimulationConfig,
  type SimulationStats,
} from "./components/TopViewCanvas";
import {
  computeForceDirectedLayout,
  findLeafNodes,
  parseEdgeListCsv,
  type ParsedCsvGraph,
  type Point,
} from "./simulation/graph";
import { buildCorridors, type Corridor, type JunctionHub } from "./simulation/corridors";
import { buildAdjacency, orientedEdgesToLookup } from "./simulation/agents";
import {
  AGENT_MAX_SPEED,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  CORRIDOR_WIDTH_OPTIONS,
  DEFAULT_AGENT_COUNT,
} from "./simulation/presets";
import { getHealth, solveOrientation } from "./api/client";
import type { OrientationScore, OrientedEdge, SolverType } from "./api/types";

type Stage = "input" | "layout" | "simulating";

function App() {
  const [stage, setStage] = useState<Stage>("input");
  const [csvGraph, setCsvGraph] = useState<ParsedCsvGraph | null>(null);
  const [nodePositions, setNodePositions] = useState<Map<string, Point>>(new Map());
  const [csvWarnings, setCsvWarnings] = useState<string[]>([]);
  const [corridors, setCorridors] = useState<Corridor[]>([]);
  const [hubs, setHubs] = useState<JunctionHub[]>([]);
  const [agentCountInput, setAgentCountInput] = useState(DEFAULT_AGENT_COUNT);
  const [agentSpeed, setAgentSpeed] = useState(AGENT_MAX_SPEED);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [simulation, setSimulation] = useState<SimulationConfig | null>(null);
  const [addAgentsRequest, setAddAgentsRequest] = useState<AddAgentsRequest | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showGraphOverlay, setShowGraphOverlay] = useState(true);
  const [agentCount, setAgentCount] = useState(0);
  const [simulationStats, setSimulationStats] = useState<SimulationStats | null>(null);

  const [solver, setSolver] = useState<SolverType>("mr2s");
  const [isRunningSolver, setIsRunningSolver] = useState(false);
  const [orientedEdges, setOrientedEdges] = useState<OrientedEdge[]>([]);
  const [score, setScore] = useState<OrientationScore | null>(null);
  const [solverWarnings, setSolverWarnings] = useState<string[]>([]);
  const [backendStatus, setBackendStatus] = useState<string>("checking backend…");

  useEffect(() => {
    getHealth()
      .then(() => setBackendStatus("backend connected"))
      .catch(() => setBackendStatus("backend unreachable"));
  }, []);

  function handleCsvParsed(raw: string): { errors: string[] } | void {
    const result = parseEdgeListCsv(raw);
    if (!result.ok) {
      return { errors: result.errors };
    }
    const layout = computeForceDirectedLayout(result.graph.nodeIds, result.graph.edges, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
    });
    setCsvGraph(result.graph);
    setNodePositions(layout);
    setCsvWarnings(result.graph.warnings);
    setCorridors([]);
    setHubs([]);
    setSimulation(null);
    setAddAgentsRequest(null);
    setIsPlaying(false);
    setOrientedEdges([]);
    setScore(null);
    setSolverWarnings([]);
    setSimulationStats(null);
    setStage("layout");
  }

  function handleGeneratePaths() {
    if (!csvGraph) return;
    const result = buildCorridors(nodePositions, csvGraph.edges, CORRIDOR_WIDTH_OPTIONS);
    setCorridors(result.corridors);
    setHubs(result.hubs);

    const leaves = findLeafNodes(csvGraph.nodeIds, csvGraph.edges);
    // Edges the solver has already oriented (if "Run Solver" was clicked
    // before "Generate Paths") become one-way from the start; anything
    // undetermined (not yet solved) stays walkable both ways.
    const adjacency = buildAdjacency(csvGraph.nodeIds, csvGraph.edges, orientedEdgesToLookup(orientedEdges));
    setSimulation({
      generation: Date.now(),
      agentCount: agentCountInput,
      leaves,
      adjacency,
    });
    setIsPlaying(true);
    setStage("simulating");
  }

  function handleAddAgents() {
    setAddAgentsRequest((prev) => ({
      requestId: (prev?.requestId ?? 0) + 1,
      count: agentCountInput,
    }));
  }

  function handleNodePositionsChange(next: Map<string, Point>) {
    setNodePositions(next);
    if (csvGraph && corridors.length > 0) {
      const result = buildCorridors(next, csvGraph.edges, CORRIDOR_WIDTH_OPTIONS);
      setCorridors(result.corridors);
      setHubs(result.hubs);
    }
  }

  async function handleRunSolver() {
    if (!csvGraph) return;
    setIsRunningSolver(true);
    setSolverWarnings([]);
    try {
      const graphPayload = {
        nodes: csvGraph.nodeIds.map((id) => ({ id })),
        edges: csvGraph.edges.map((e) => ({
          id: `${e.source}--${e.target}`,
          source: e.source,
          target: e.target,
          weight: e.weight,
        })),
      };
      const result = await solveOrientation(graphPayload, solver);
      setOrientedEdges(result.orientedEdges);
      setScore(result.score);
      setSolverWarnings(result.warnings);

      // Re-route future spawns/respawns to respect the newly-solved
      // direction, without resetting the world or agents already mid-walk
      // (same generation - see TopViewCanvas's handling of this).
      if (csvGraph) {
        const lookup = orientedEdgesToLookup(result.orientedEdges);
        const nextAdjacency = buildAdjacency(csvGraph.nodeIds, csvGraph.edges, lookup);
        setSimulation((prev) => (prev ? { ...prev, adjacency: nextAdjacency } : prev));
      }
    } catch (err) {
      setOrientedEdges([]);
      setScore(null);
      setSolverWarnings([err instanceof Error ? err.message : "solver request failed"]);
    } finally {
      setIsRunningSolver(false);
    }
  }

  const allWarnings = [...csvWarnings, ...solverWarnings];

  return (
    <>
      <header className="app-header">
        <h1>MR2S Crowd Orientation Top View</h1>
        <span className="backend-status">{backendStatus}</span>
      </header>
      <div className="app-layout">
        <aside className="control-panel">
          <GraphCsvInput onParsed={handleCsvParsed} />
          {stage !== "input" && (
            <ControlPanel
              agentCountInput={agentCountInput}
              onAgentCountInputChange={setAgentCountInput}
              onGeneratePaths={handleGeneratePaths}
              canGeneratePaths
              onAddAgents={handleAddAgents}
              canAddAgents={stage === "simulating"}
              agentSpeed={agentSpeed}
              onAgentSpeedChange={setAgentSpeed}
              playbackRate={playbackRate}
              onPlaybackRateChange={setPlaybackRate}
              isPlaying={isPlaying}
              onTogglePlay={() => setIsPlaying((p) => !p)}
              canPlay={stage === "simulating"}
              showGraphOverlay={showGraphOverlay}
              onToggleGraphOverlay={() => setShowGraphOverlay((v) => !v)}
            />
          )}
          {stage !== "input" && (
            <SolverPanel
              solver={solver}
              onSolverChange={setSolver}
              onRunSolver={handleRunSolver}
              isRunning={isRunningSolver}
              disabled={!csvGraph}
            />
          )}
          {stage === "simulating" && (
            <div className="simulation-stats">
              <p>Engine: {SIMULATION_ENGINE_VERSION}</p>
              <p>
                Agents: {agentCount}
                {simulationStats &&
                  ` · Moving: ${simulationStats.moving} · Stuck: ${simulationStats.stuck.length}`}
              </p>
              {simulationStats && simulationStats.stuck.length > 0 && (
                <details open>
                  <summary>Stuck agent diagnostics</summary>
                  <ul>
                    {simulationStats.stuck.map((agent) => (
                      <li key={agent.id}>
                        {agent.id} → {agent.target}, waypoint {agent.waypoint},{" "}
                        {agent.stuckSeconds.toFixed(1)}s at ({agent.x.toFixed(0)},{" "}
                        {agent.y.toFixed(0)})
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {stage === "simulating" && <DensityLegend />}
          <ScorePanel score={score} />
          <WarningsPanel warnings={allWarnings} />
        </aside>
        <main>
          <div className="canvas-wrapper">
            <TopViewCanvas
              key={SIMULATION_ENGINE_VERSION}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              nodeIds={csvGraph?.nodeIds ?? []}
              edges={csvGraph?.edges ?? []}
              nodePositions={nodePositions}
              onNodePositionsChange={handleNodePositionsChange}
              corridors={corridors}
              hubs={hubs}
              simulation={simulation}
              addAgentsRequest={addAgentsRequest}
              agentSpeed={agentSpeed}
              playbackRate={playbackRate}
              isPlaying={isPlaying}
              showGraphOverlay={showGraphOverlay}
              orientedEdges={orientedEdges}
              onAgentCountChange={setAgentCount}
              onSimulationStatsChange={setSimulationStats}
            />
          </div>
          {stage === "input" && <p>Paste a CSV edge list and click "Parse &amp; Layout" to begin.</p>}
          {stage === "layout" && (
            <p>Drag nodes to adjust the layout, then click "Generate Paths" to build corridors.</p>
          )}
        </main>
      </div>
    </>
  );
}

export default App;
