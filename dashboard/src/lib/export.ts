import type { RingBuffer, TelemetryRingRow } from './ringbuffer';
export function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(name, blob);
}
export function csvText(rows: TelemetryRingRow[]): string {
  const header = 'pc_timestamp,angle,gyro,setpoint,p,i,d,out,pwmL,pwmR,vbat,state,x,x_estimated\n';
  const body = rows.map((r) => `${r.t},${r.angle},${r.gyro},${r.sp},${r.p},${r.i},${r.d},${r.out},${r.pwmL},${r.pwmR},${r.vbat},${r.state},${r.x},${r.xEstimated ? 1 : 0}`).join('\n');
  return header + body;
}
export function exportCsv(ring: RingBuffer) {
  downloadBlob('robot-run.csv', new Blob([csvText(ring.values())], { type: 'text/csv' }));
}
function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
