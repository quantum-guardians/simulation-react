import type { OrientationScore } from "../api/types";

export interface ScorePanelProps {
  score: OrientationScore | null;
}

function formatValue(value: number | null, whenNull: string): string {
  if (value === null) return whenNull;
  return value.toFixed(2);
}

export function ScorePanel({ score }: ScorePanelProps) {
  if (!score) return null;
  const improvement =
    score.optimizedApsp !== null && score.bidirectionalApsp !== null
      ? score.bidirectionalApsp - score.optimizedApsp
      : null;
  return (
    <div className="score-panel">
      <strong>Score</strong>
      {/* The backend reports -1 (adapted to null) when the oriented graph
       * isn't strongly connected, i.e. some pairs are unreachable. */}
      <div>Optimized APSP: {formatValue(score.optimizedApsp, "not strongly connected")}</div>
      <div>Bidirectional APSP: {formatValue(score.bidirectionalApsp, "not connected")}</div>
      {improvement !== null && <div>Δ vs bidirectional: {improvement.toFixed(2)}</div>}
    </div>
  );
}
