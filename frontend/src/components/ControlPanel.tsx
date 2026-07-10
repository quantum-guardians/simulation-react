export interface ControlPanelProps {
  agentCountInput: number;
  onAgentCountInputChange: (count: number) => void;
  onGeneratePaths: () => void;
  canGeneratePaths: boolean;
  onAddAgents: () => void;
  canAddAgents: boolean;
  agentSpeed: number;
  onAgentSpeedChange: (speed: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  canPlay: boolean;
  showGraphOverlay: boolean;
  onToggleGraphOverlay: () => void;
}

export function ControlPanel({
  agentCountInput,
  onAgentCountInputChange,
  onGeneratePaths,
  canGeneratePaths,
  onAddAgents,
  canAddAgents,
  agentSpeed,
  onAgentSpeedChange,
  isPlaying,
  onTogglePlay,
  canPlay,
  showGraphOverlay,
  onToggleGraphOverlay,
}: ControlPanelProps) {
  return (
    <div className="control-panel-inner">
      <label htmlFor="agent-count-input">Number of people</label>
      <div className="agent-count-row">
        <input
          id="agent-count-input"
          type="number"
          min={1}
          max={2000}
          value={agentCountInput}
          onChange={(e) => onAgentCountInputChange(Math.max(1, Number(e.target.value) || 1))}
        />
        <button type="button" onClick={onAddAgents} disabled={!canAddAgents}>
          Add
        </button>
      </div>

      <label htmlFor="agent-speed-input">Speed (px/s)</label>
      <input
        id="agent-speed-input"
        type="number"
        min={1}
        max={500}
        value={agentSpeed}
        onChange={(e) => onAgentSpeedChange(Math.max(1, Number(e.target.value) || 1))}
      />

      <button type="button" onClick={onGeneratePaths} disabled={!canGeneratePaths}>
        Generate Paths
      </button>

      <button type="button" onClick={onTogglePlay} disabled={!canPlay}>
        {isPlaying ? "Pause" : "Play"}
      </button>

      <label className="checkbox-row">
        <input type="checkbox" checked={showGraphOverlay} onChange={onToggleGraphOverlay} />
        Show graph overlay
      </label>
    </div>
  );
}
