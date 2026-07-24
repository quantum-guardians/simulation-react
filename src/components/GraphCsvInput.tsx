import { useState } from "react";

export interface GraphCsvInputProps {
  onParsed: (raw: string) => { errors: string[] } | void;
}

const PLACEHOLDER = "A,B,1\nB,C,2\nC,D,1\nB,D,3";

export function GraphCsvInput({ onParsed }: GraphCsvInputProps) {
  const [raw, setRaw] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  function handleSubmit() {
    const result = onParsed(raw);
    setErrors(result?.errors ?? []);
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
      <button type="button" onClick={handleSubmit}>
        Parse &amp; Layout
      </button>
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
