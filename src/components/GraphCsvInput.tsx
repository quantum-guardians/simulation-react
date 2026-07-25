import { useState } from "react";
import {
  generateRandomConnectedGraphCsv,
  MAX_RANDOM_GRAPH_NODES,
  MIN_RANDOM_GRAPH_NODES,
} from "../simulation/graph";

export interface GraphCsvInputProps {
  onParsed: (raw: string) => { errors: string[] } | void;
}

const PLACEHOLDER = "A,B,1\nB,C,2\nC,D,1\nB,D,3";

export function GraphCsvInput({ onParsed }: GraphCsvInputProps) {
  const [raw, setRaw] = useState("");
  const [randomNodeCount, setRandomNodeCount] = useState(5);
  const [errors, setErrors] = useState<string[]>([]);

  function parseAndLayout(value: string) {
    const result = onParsed(value);
    setErrors(result?.errors ?? []);
  }

  function handleRandomGraph() {
    const generated = generateRandomConnectedGraphCsv(randomNodeCount);
    setRaw(generated);
    parseAndLayout(generated);
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
