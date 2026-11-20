// Battery charge from pack voltage, for a lithium-ion / LiPo pack.
// Voltage-to-charge is approximate (it sags under motor load), so the UI
// shows the voltage as the fact and the percentage as an estimate.

/** Per-cell voltage → charge %, a typical Li-ion discharge curve under light load. */
const CELL_CURVE: [number, number][] = [
  [3.2, 0], [3.45, 5], [3.6, 12], [3.68, 20], [3.74, 32], [3.8, 45],
  [3.87, 60], [3.95, 72], [4.05, 85], [4.2, 100],
];

export type BatteryLevel = 'ok' | 'low' | 'critical';
export type BatteryStatus = { volts: number; cells: number; percent: number; level: BatteryLevel };

/** Cell count guessed from the pack voltage (1S–4S). */
function cellCount(volts: number): number {
  if (volts > 13.2) return 4;
  if (volts > 8.8) return 3;
  if (volts > 4.5) return 2;
  return 1;
}

function cellPercent(cellVolts: number): number {
  if (cellVolts <= CELL_CURVE[0][0]) return 0;
  for (let i = 1; i < CELL_CURVE.length; i++) {
    const [v1, p1] = CELL_CURVE[i];
    if (cellVolts <= v1) {
      const [v0, p0] = CELL_CURVE[i - 1];
      return p0 + ((cellVolts - v0) / (v1 - v0)) * (p1 - p0);
    }
  }
  return 100;
}

/** Null when the robot doesn't measure its battery (sends 0 V). */
export function batteryStatus(volts: number): BatteryStatus | null {
  if (!Number.isFinite(volts) || volts <= 0.5) return null;
  const cells = cellCount(volts);
  const percent = Math.round(cellPercent(volts / cells));
  const level: BatteryLevel = percent < 10 ? 'critical' : percent < 25 ? 'low' : 'ok';
  return { volts, cells, percent, level };
}
