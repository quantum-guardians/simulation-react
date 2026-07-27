import type { SolverType } from "../api/types";

// Keys match the backend's canonical solver names (GET /api/v2/solvers).
const SOLVER_OPTIONS: { key: SolverType; label: string; title: string }[] = [
  {
    key: "qubo",
    label: "QUBO (divide & conquer)",
    title: "Partitions the graph, solves each part as a QUBO with simulated annealing",
  },
  {
    key: "raw-sa",
    label: "Simulated Annealing",
    title: "Anneals edge directions directly against APSP and flow metrics",
  },
  {
    key: "robin",
    label: "Robin (Robbins orientation)",
    title: "One DFS pass orients every edge; fastest, but needs a bridgeless graph",
  },
];

export interface SolverPanelProps {
  solver: SolverType;
  onSolverChange: (solver: SolverType) => void;
  onRunSolver: () => void;
  isRunning: boolean;
  disabled: boolean;
}

export function SolverPanel({ solver, onSolverChange, onRunSolver, isRunning, disabled }: SolverPanelProps) {
  return (
    <div className="solver-panel">
      <label htmlFor="solver-select">Solver</label>
      <select
        id="solver-select"
        value={solver}
        onChange={(e) => onSolverChange(e.target.value as SolverType)}
      >
        {SOLVER_OPTIONS.map((s) => (
          <option key={s.key} value={s.key} title={s.title}>
            {s.label}
          </option>
        ))}
      </select>
      <button type="button" onClick={onRunSolver} disabled={disabled || isRunning}>
        {isRunning ? "Running…" : "Run Solver"}
      </button>
    </div>
  );
}
