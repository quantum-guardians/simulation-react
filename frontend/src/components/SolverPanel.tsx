import { useEffect, useState } from "react";
import { getSolvers } from "../api/client";
import type { SolverInfo, SolverType } from "../api/types";

const FALLBACK_SOLVERS: SolverInfo[] = [
  { key: "robbin", label: "Robbin", available: true, reason: null },
  { key: "ils", label: "Iterated Local Search", available: true, reason: null },
  { key: "sa", label: "Simulated Annealing", available: true, reason: null },
  { key: "qubo", label: "QUBO", available: true, reason: null },
  { key: "qubo_sa", label: "QUBO - SA", available: true, reason: null },
  { key: "qubo_qa", label: "QUBO - QA", available: false, reason: null },
  { key: "dnc_sa", label: "Divide & Conquer - SA", available: true, reason: null },
  { key: "dnc_qubo", label: "Divide & Conquer - QUBO", available: true, reason: null },
  { key: "dnc_qubo_sa", label: "Divide & Conquer - QUBO SA", available: true, reason: null },
  { key: "dnc_qubo_qa", label: "Divide & Conquer - QUBO QA", available: false, reason: null },
];

export interface SolverPanelProps {
  solver: SolverType;
  onSolverChange: (solver: SolverType) => void;
  onRunSolver: () => void;
  isRunning: boolean;
  disabled: boolean;
}

export function SolverPanel({ solver, onSolverChange, onRunSolver, isRunning, disabled }: SolverPanelProps) {
  const [solvers, setSolvers] = useState<SolverInfo[]>(FALLBACK_SOLVERS);

  useEffect(() => {
    let cancelled = false;
    getSolvers()
      .then((res) => {
        if (!cancelled) setSolvers(res.solvers);
      })
      .catch(() => {
        // Backend may not be reachable yet; keep the static fallback list
        // so the UI stays usable rather than breaking.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="solver-panel">
      <label htmlFor="solver-select">Solver</label>
      <select
        id="solver-select"
        value={solver}
        onChange={(e) => onSolverChange(e.target.value as SolverType)}
      >
        {solvers.map((s) => (
          <option key={s.key} value={s.key} disabled={!s.available} title={s.reason ?? undefined}>
            {s.label}
            {!s.available ? " (unavailable)" : ""}
          </option>
        ))}
      </select>
      <button type="button" onClick={onRunSolver} disabled={disabled || isRunning}>
        {isRunning ? "Running…" : "Run Solver"}
      </button>
    </div>
  );
}
