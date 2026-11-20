import { batteryStatus } from '../lib/battery';
import { useDashboard } from '../store/useDashboard';

const SMOOTH_SAMPLES = 75; // about 3 s at 25 Hz

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** A battery-shaped level meter; the fill is the charge, not a stepped icon. */
function Meter({ percent }: { percent: number }) {
  return (
    <span className="batt" aria-hidden="true">
      <span className="batt-body"><span className="batt-fill" style={{ width: `${Math.max(4, percent)}%` }} /></span>
      <span className="batt-nub" />
    </span>
  );
}

/** Battery voltage and estimated charge, smoothed so motor load doesn't make it jump. */
export function Battery() {
  useDashboard((s) => s.telemetry); // re-render as packets arrive
  const ring = useDashboard((s) => s.ring);
  const replayRows = useDashboard((s) => s.replayRows);
  const replayIndex = useDashboard((s) => s.replayIndex);
  const rows = replayRows.length
    ? replayRows.slice(Math.max(0, replayIndex - SMOOTH_SAMPLES + 1), replayIndex + 1)
    : ring.recent(SMOOTH_SAMPLES);
  const status = batteryStatus(median(rows.map((r) => r.vbat)));

  if (!status) {
    return (
      <div className="battery" data-level="none" title="The robot sends 0 V for the battery, so it isn't being measured.">
        <span className="batt" aria-hidden="true"><span className="batt-body" /><span className="batt-nub" /></span>
        <span className="battery-meta">No reading</span>
      </div>
    );
  }
  const { volts, cells, percent, level } = status;
  return (
    <div className="battery" data-level={level} role="status"
      aria-label={`Battery about ${percent} percent, ${volts.toFixed(1)} volts`}
      title={`Estimated from a ${cells}-cell pack's voltage. It reads lower while the motors work hard.`}>
      <Meter percent={percent} />
      <span className="battery-pct">{percent}%</span>
      <span className="battery-meta">{volts.toFixed(1)} V</span>
    </div>
  );
}
