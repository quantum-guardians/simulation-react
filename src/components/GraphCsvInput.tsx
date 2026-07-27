import { useState } from "react";
import {
  generateRandomConnectedGraphCsv,
  MAX_RANDOM_GRAPH_NODES,
  MIN_RANDOM_GRAPH_NODES,
} from "../simulation/graph";
import type { LayoutMode } from "../simulation/planarLayout";

export interface GraphCsvInputProps {
  onParsed: (raw: string, layoutMode: LayoutMode) => { errors: string[] } | void;
}

const PLACEHOLDER = "A,B,1\nB,C,2\nC,D,1\nB,D,3";

export function GraphCsvInput({ onParsed }: GraphCsvInputProps) {
  const [raw, setRaw] = useState("");
  const [randomNodeCount, setRandomNodeCount] = useState(5);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("force");
  const [errors, setErrors] = useState<string[]>([]);

  function parseAndLayout(value: string, mode: LayoutMode = layoutMode) {
    const result = onParsed(value, mode);
    setErrors(result?.errors ?? []);
  }

  function handleRandomGraph() {
    const generated = generateRandomConnectedGraphCsv(randomNodeCount);
    setRaw(generated);
    parseAndLayout(generated);
  }

  /**
   * Re-lay out immediately instead of waiting for another "Parse & Layout"
   * click: a mode picker that leaves the drawing unchanged reads as if the
   * mode itself did nothing.
   */
  function handleLayoutModeChange(mode: LayoutMode) {
    setLayoutMode(mode);
    if (raw.trim().length > 0) parseAndLayout(raw, mode);
  }

  return (
    <div className="graph-csv-input">
      <label htmlFor="csv-textarea">Edge list CSV (node1,node2,weight)</label>
      <textarea
        id="csv-textarea"
        rows={8}
        placeholder={PLACEHOLDER}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
      />
      <div className="layout-mode-row">
        <label htmlFor="layout-mode">Layout</label>
        <select
          id="layout-mode"
          value={layoutMode}
          onChange={(event) => handleLayoutModeChange(event.target.value as LayoutMode)}
        >
          <option value="force">Force-directed</option>
          <option value="planar">Planar (no crossings)</option>
        </select>
      </div>
      <button type="button" onClick={() => parseAndLayout(raw)}>
        Parse &amp; Layout
      </button>
      <div className="random-graph-row">
        <label htmlFor="random-node-count">Random graph</label>
        <input
          id="random-node-count"
          type="number"
          min={MIN_RANDOM_GRAPH_NODES}
          max={MAX_RANDOM_GRAPH_NODES}
          value={randomNodeCount}
          onChange={(event) =>
            setRandomNodeCount(
              Math.min(
                MAX_RANDOM_GRAPH_NODES,
                Math.max(MIN_RANDOM_GRAPH_NODES, Number(event.target.value) || MIN_RANDOM_GRAPH_NODES)
              )
            )
          }
        />
        <button type="button" onClick={handleRandomGraph}>
          Generate
        </button>
      </div>
      {errors.length > 0 && (
        <ul className="csv-errors">
          {errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
