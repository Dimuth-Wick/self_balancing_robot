import type { RingBuffer } from './ringbuffer';
export function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(name, blob);
}
export function exportCsv(ring: RingBuffer) {
  const header = 'pc_timestamp,angle,gyro,setpoint,p,i,d,out,pwmL,pwmR,vbat,state\n';
  const body = ring.values().map((r) => `${r.t},${r.angle},${r.gyro},${r.sp},${r.p},${r.i},${r.d},${r.out},${r.pwmL},${r.pwmR},${r.vbat},${r.state}`).join('\n');
  downloadBlob('robot-run.csv', new Blob([header + body], { type: 'text/csv' }));
}
function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
