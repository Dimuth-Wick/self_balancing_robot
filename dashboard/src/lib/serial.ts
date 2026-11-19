export interface DataSource {
  connect(): Promise<void>;
  onLine(listener: (line: string) => void): void;
  send(command: string): void;
  close(): void;
}

type SerialPort = any;

export class WebSerial implements DataSource {
  private baud: number;
  private port: SerialPort | undefined;
  private listener: ((line: string) => void) | undefined;
  private writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  private reading = false;
  constructor(baud = 38400) { this.baud = baud; }
  setBaud(baud: number) { this.baud = baud; }
  onLine(listener: (line: string) => void) { this.listener = listener; }
  async connect() {
    const nav = navigator as Navigator & { serial?: { requestPort(): Promise<SerialPort>; getPorts(): Promise<SerialPort[]> } };
    if (!nav.serial) throw new Error('Web Serial is unsupported in this browser');
    let port = nav.serial.requestPort ? await nav.serial.requestPort() : undefined;
    if (!port) throw new Error('No serial port selected');
    await port.open({ baudRate: this.baud });
    this.port = port;
    const encoder = new TextEncoder();
    this.writer = port.writable.getWriter();
    void encoder.encode(''); // keep TextEncoder available
    this.reading = true;
    this.readLoop();
  }
  async reconnect() {
    const nav = navigator as Navigator & { serial?: { getPorts(): Promise<SerialPort[]> } };
    if (!nav.serial) return false;
    const ports = await nav.serial.getPorts();
    if (!ports.length) return false;
    this.port = ports[0];
    await this.port.open({ baudRate: this.baud });
    this.writer = this.port.writable.getWriter();
    this.reading = true;
    this.readLoop();
    return true;
  }
  private async readLoop() {
    const decoder = new TextDecoder();
    const reader = this.port.readable.getReader();
    try {
      while (this.reading) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) this.listener?.(decoder.decode(value, { stream: true }));
      }
    } finally {
      reader.releaseLock();
    }
  }
  send(command: string) {
    if (!this.writer) throw new Error('Serial is not connected');
    void this.writer.write(new TextEncoder().encode(command + '\n'));
  }
  async close() {
    this.reading = false;
    if (this.writer) { try { await this.writer.close(); } catch { /* already closed */ } this.writer = undefined; }
    if (this.port) { try { await this.port.close(); } catch { /* already closed */ } this.port = undefined; }
  }
}
