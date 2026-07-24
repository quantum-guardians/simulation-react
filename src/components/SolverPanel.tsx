import type { SolverType } from "../api/types";

const SOLVER_OPTIONS: { key: SolverType; label: string }[] = [
  { key: "mr2s", label: "MR2S (QUBO)" },
  { key: "raw-sa", label: "Simulated Annealing" },
  { key: "brute-force", label: "Brute Force (small graphs only)" },
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
          <option key={s.key} value={s.key}>
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
