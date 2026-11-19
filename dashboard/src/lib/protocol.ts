export type Telemetry = {
  ms: number; angle: number; gyro: number; sp: number;
  pT: number; iT: number; dT: number; out: number;
  pwmL: number; pwmR: number; kp: number; ki: number; kd: number;
  vbat: number; state: number; pcTimestamp: number;
  /** Floor position in metres (optional 17th field). */
  x?: number;
};
export type ParsedLine =
  | { kind: 'telemetry'; data: Telemetry }
  | { kind: 'info' | 'ack' | 'error'; text: string }
  | { kind: 'unknown'; text: string };

export function parseLine(line: string): ParsedLine | null {
  const parts = line.trim().replace(/\r$/, '').split(',');
  if (!parts.length || !parts[0]) return null;
  if (parts[0] === 'D') {
    if (parts.length !== 16 && parts.length !== 17) return null;
    const raw = parts.slice(1);
    if (raw.some((r) => r.trim() === '')) return null;
    const nums = raw.map(Number);
    if (nums.some((n) => !Number.isFinite(n))) return null;
    const [ms, angle, gyro, sp, pT, iT, dT, out, pwmL, pwmR, kp, ki, kd, vbat, state, x] = nums;
    const data: Telemetry = {
      ms, angle, gyro, sp, pT, iT, dT, out, pwmL, pwmR, kp, ki, kd, vbat, state,
      pcTimestamp: Date.now(),
    };
    if (x !== undefined) data.x = x;
    return { kind: 'telemetry', data };
  }
  if (parts[0] === 'I') return { kind: 'info', text: parts.slice(1).join(',') };
  if (parts[0] === 'A') return { kind: 'ack', text: parts.slice(1).join(',') };
  if (parts[0] === 'E') return { kind: 'error', text: parts.slice(1).join(',') };
  return { kind: 'unknown', text: line };
}

export class LineBuffer {
  private buffer = '';
  feed(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    return lines.map((line) => line.replace(/\r$/, ''));
  }
  flush(): string[] {
    if (!this.buffer) return [];
    const line = this.buffer;
    this.buffer = '';
    return [line];
  }
}
