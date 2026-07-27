export interface ControlPanelProps {
  agentCountInput: number;
  onAgentCountInputChange: (count: number) => void;
  onGeneratePaths: () => void;
  canGeneratePaths: boolean;
  onAddAgents: () => void;
  canAddAgents: boolean;
  onRemoveDeadAgents: () => void;
  onRemoveAllAgents: () => void;
  canRemoveAgents: boolean;
  onClearOrientation: () => void;
  canClearOrientation: boolean;
  agentSpeed: number;
  onAgentSpeedChange: (speed: number) => void;
  playbackRate: number;
  onPlaybackRateChange: (rate: number) => void;
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
  onRemoveDeadAgents,
  onRemoveAllAgents,
  canRemoveAgents,
  onClearOrientation,
  canClearOrientation,
  agentSpeed,
  onAgentSpeedChange,
  playbackRate,
  onPlaybackRateChange,
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

      <div className="agent-count-row">
        <button type="button" onClick={onRemoveDeadAgents} disabled={!canRemoveAgents}>
          Remove dead
        </button>
        <button type="button" onClick={onRemoveAllAgents} disabled={!canRemoveAgents}>
          Remove all
        </button>
      </div>

      <button type="button" onClick={onClearOrientation} disabled={!canClearOrientation}>
        Clear directions
      </button>

      <label htmlFor="agent-speed-input">Speed (px/s)</label>
      <input
        id="agent-speed-input"
        type="number"
        min={1}
        max={500}
        value={agentSpeed}
        onChange={(e) => onAgentSpeedChange(Math.max(1, Number(e.target.value) || 1))}
      />

      <label htmlFor="playback-rate-select">Playback speed</label>
      <select
        id="playback-rate-select"
        value={playbackRate}
        onChange={(e) => onPlaybackRateChange(Number(e.target.value))}
      >
        <option value={0.25}>0.25×</option>
        <option value={0.5}>0.5×</option>
        <option value={1}>1×</option>
        <option value={2}>2×</option>
        <option value={4}>4×</option>
      </select>

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
