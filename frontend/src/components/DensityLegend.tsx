const LEGEND_ITEMS = [
  { color: "#7f8b45", label: "Low (< 0.2)" },
  { color: "#8a7a3a", label: "Medium (0.2 - 0.6)" },
  { color: "#8a5a3a", label: "High (0.6 - 0.85)" },
  { color: "#9a4b4b", label: "Critical (>= 0.85)" },
];

export function DensityLegend() {
  return (
    <div className="density-legend">
      <strong>Density</strong>
      {LEGEND_ITEMS.map((item) => (
        <div key={item.label} className="density-legend-row">
          <span className="density-swatch" style={{ background: item.color }} />
          {item.label}
        </div>
      ))}
    </div>
  );
}
