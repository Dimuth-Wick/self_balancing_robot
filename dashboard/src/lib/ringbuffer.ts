export class RingBuffer {
  readonly capacity: number;
  private data: TelemetryRingRow[];
  private start = 0;
  private size = 0;
  constructor(capacity = 60000) {
    this.capacity = capacity;
    this.data = new Array<TelemetryRingRow>(capacity);
  }
  push(row: TelemetryRingRow) {
    if (this.size < this.capacity) {
      this.data[(this.start + this.size) % this.capacity] = row;
      this.size++;
    } else {
      this.data[this.start] = row;
      this.start = (this.start + 1) % this.capacity;
    }
  }
  values(): TelemetryRingRow[] {
    return Array.from({ length: this.size }, (_, i) => this.data[(this.start + i) % this.capacity]);
  }
  /** The newest `n` rows, oldest first, without copying the whole buffer. */
  recent(n: number): TelemetryRingRow[] {
    const count = Math.max(0, Math.min(n, this.size));
    const first = this.size - count;
    return Array.from({ length: count }, (_, i) => this.data[(this.start + first + i) % this.capacity]);
  }
  clear() { this.start = 0; this.size = 0; }
  get length() { return this.size; }
}
export type TelemetryRingRow = {
  t: number; angle: number; gyro: number; sp: number;
  p: number; i: number; d: number; out: number; pwmL: number; pwmR: number;
  vbat: number; state: number;
  /** Floor position in metres; estimated from PWM when xEstimated. */
  x: number; xEstimated: boolean;
};
