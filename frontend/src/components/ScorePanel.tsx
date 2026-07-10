import type { ScorePayload } from "../api/types";

export interface ScorePanelProps {
  score: ScorePayload | null;
}

function formatValue(value: number | null, whenNull = "N/A"): string {
  if (value === null) return whenNull;
  return value.toFixed(2);
}

export function ScorePanel({ score }: ScorePanelProps) {
  if (!score) return null;
  return (
    <div className="score-panel">
      <strong>Score</strong>
      {/* apsp_sum is null exactly when the graph isn't strongly connected,
       * which the backend represents as the (non-JSON-safe) float('inf'); shown as ∞ here. */}
      <div>APSP Sum: {formatValue(score.apsp_sum, "∞")}</div>
      <div>Strong Connect Rate: {formatValue(score.strong_connect_rate)}</div>
      <div>Flow Score: {formatValue(score.flow_score)}</div>
      <div>Sample Score: {formatValue(score.sample_score)}</div>
    </div>
  );
}
