import { BatteryEmpty, BatteryFull, BatteryHigh, BatteryLow, BatteryMedium, BatteryWarning } from '@phosphor-icons/react';
import { batteryStatus } from '../lib/battery';
import { useDashboard } from '../store/useDashboard';

const SMOOTH_SAMPLES = 75; // about 3 s at 25 Hz

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
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
        <BatteryEmpty size={16} weight="fill" />
        <span className="battery-meta">No battery reading</span>
      </div>
    );
  }
  const { volts, cells, percent, level } = status;
  const Icon = level === 'critical' ? BatteryWarning
    : percent >= 80 ? BatteryFull : percent >= 55 ? BatteryHigh : percent >= 30 ? BatteryMedium : BatteryLow;
  return (
    <div className="battery" data-level={level} role="status"
      aria-label={`Battery ${volts.toFixed(1)} volts, about ${percent} percent`}
      title={`Estimated from a ${cells}-cell pack's voltage. It reads lower while the motors work hard.`}>
      <Icon size={16} weight="fill" />
      <span className="battery-volts">{volts.toFixed(1)} V</span>
      <span className="battery-meta">{percent}%</span>
    </div>
  );
}
