import { useEffect, useRef, useState } from 'react';
import {
  ArrowCounterClockwise, CheckCircle, Copy, DownloadSimple, HandPalm, Lightbulb, Moon,
  Pause, Play, Record, Stop, Sun, UploadSimple, WarningCircle, X, Crosshair,
} from '@phosphor-icons/react';
import './App.css';
import { LineBuffer, parseLine } from './lib/protocol';
import { Simulator } from './lib/simulator';
import { WebSerial } from './lib/serial';
import { analyze, coachHint } from './lib/metrics';
import { downloadJson, exportCsv } from './lib/export';
import { readLS, useDashboard, writeLS } from './store/useDashboard';
import { RobotPanel } from './components/RobotPanel';
import { Charts } from './components/Charts';
import { Battery } from './components/Battery';
import { Button, IconButton, Segmented, Switch, Tip } from './components/ui';
import { fillMissingX } from './lib/positionEstimator';

const TIPS: Record<string, string> = {
  Kp: 'Controls response to tilt. Too high: fast oscillation. Too low: cannot catch the fall.',
  Ki: 'Removes a steady lean from uneven load. Too high: slow wobble that grows. It will NOT stop a run-away — fix the setpoint for that.',
  Kd: 'Damps motion like friction. Too high: noisy or sluggish. Too low: wobble grows.',
  Setpoint: 'The angle the robot tries to hold. If it is off from the true balance angle, the robot runs away in one direction and falls.',
  'Mounting offset': 'Simulator only: pretend the sensor is mounted crooked by this many degrees. Try 0.5° and watch it run away, then press Zero angle.',
};

function Gain({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string;
  onChange: (n: number) => void;
}) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  return <div className="gain">
    <div className="gain-head">
      <span className="gain-label">{label}<Tip text={TIPS[label] ?? 'Control parameter'} /></span>
      <span className="gain-field" data-unit={unit ? true : undefined}>
        <input aria-label={`${label} numeric`} type="number" value={value} min={min} max={max} step={step}
          onChange={(e) => onChange(Number(e.target.value))} />
        {unit && <span className="gain-unit" aria-hidden="true">{unit}</span>}
      </span>
    </div>
    <input className="range" aria-label={`${label} slider`} type="range" value={value} min={min} max={max} step={step}
      style={{ ['--pct' as string]: `${pct}%` }} onChange={(e) => onChange(Number(e.target.value))} />
  </div>;
}

const close = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 0.005;

function App() {
  const sim = useRef(new Simulator());
  const serial = useRef(new WebSerial());
  const buffer = useRef(new LineBuffer());
  const source = useRef<{ kind: 'sim'|'serial'; ref: Simulator|WebSerial }>({ kind: 'sim', ref: sim.current });
  const fileInput = useRef<HTMLInputElement>(null);
  const state = useDashboard();
  const [manual, setManual] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [baud, setBaud] = useState(Number(readLS('dashboard-baud') || 38400));
  const [tab, setTab] = useState<'coach'|'event'|'console'>('coach');
  const [toast, setToast] = useState('');
  const [manualCommand, setManualCommand] = useState('');
  const [mountOffset, setMountOffset] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [, setPresetVersion] = useState(0);

  const notify = (text: string) => { setToast(text); window.setTimeout(() => setToast(''), 2500); };
  const processChunk = (chunk: string) => {
    for (const line of buffer.current.feed(chunk)) handleLine(line);
  };
  const handleLine = (line: string) => {
    useDashboard.getState().addRaw(line);
    const parsed = parseLine(line);
    if (!parsed) useDashboard.setState((s) => ({ badPackets: s.badPackets + 1 }));
    else if (parsed.kind === 'telemetry') useDashboard.getState().setValue(parsed.data);
    else if (parsed.kind === 'info') useDashboard.getState().addEvent(`I: ${parsed.text}`);
    else if (parsed.kind === 'ack') useDashboard.getState().addEvent(`A: ${parsed.text}`, 'param');
    else if (parsed.kind === 'error') useDashboard.getState().addEvent(`E: ${parsed.text}`, 'warning');
  };
  const startSimulator = () => {
    // Never leave the serial link as the command target while the simulator runs.
    if (source.current.kind === 'serial') void serial.current.close();
    source.current = { kind: 'sim', ref: sim.current };
    sim.current.close();
    sim.current.onLine(processChunk);
    const store = useDashboard.getState();
    store.selectGainSet('sim');
    const g = useDashboard.getState().requested;
    for (const cmd of [`KP=${g.kp}`, `KI=${g.ki}`, `KD=${g.kd}`, `SP=${g.sp}`]) sim.current.send(cmd);
    sim.current.start();
    useDashboard.setState({ simulator: true, connected: true });
    useDashboard.getState().addEvent('Built-in simulator started');
  };
  useEffect(() => {
    startSimulator();
    const reconnect = async () => {
      try {
        serial.current.onLine(processChunk);
        serial.current.setBaud(baud);
        if (await serial.current.reconnect()) {
          source.current = { kind: 'serial', ref: serial.current };
          sim.current.close();
          useDashboard.setState({ simulator: false, connected: true });
          useDashboard.getState().selectGainSet('robot');
          useDashboard.setState({ awaitingRobotGains: true });
          serial.current.send('GET');
          useDashboard.getState().addEvent(`Reconnected at ${baud} baud`);
        }
      } catch { /* optional */ }
    };
    void reconnect();
    return () => { sim.current.close(); void serial.current.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);
  useEffect(() => {
    const packetsTimer = window.setInterval(() => {
      useDashboard.setState((s) => ({ packetRate: s.packets, packets: 0 }));
    }, 1000);
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') { e.preventDefault(); sendCommand('RUN=0'); }
      if (e.key.toLowerCase() === 'r') useDashboard.setState({ recording: !useDashboard.getState().recording });
      if (e.key.toLowerCase() === 'p') useDashboard.setState({ paused: !useDashboard.getState().paused });
      if (e.key === '?') notify('Shortcuts: Space = stop, R = record, P = pause');
    };
    window.addEventListener('keydown', key);
    return () => { clearInterval(packetsTimer); window.removeEventListener('keydown', key); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendCommand = (command: string) => {
    if (!command) return;
    try {
      if (source.current.kind === 'sim') sim.current.send(command);
      else serial.current.send(command);
      useDashboard.getState().addEvent(`Sent ${command}`, 'param');
    } catch (e) { notify(e instanceof Error ? e.message : 'Command failed'); }
  };
  const sendGains = () => {
    const r = useDashboard.getState().requested;
    sendCommand(`KP=${r.kp}`); sendCommand(`KI=${r.ki}`); sendCommand(`KD=${r.kd}`); sendCommand(`SP=${r.sp}`);
  };
  const applyGain = (key: 'kp'|'ki'|'kd'|'sp', value: number) => {
    useDashboard.getState().setRequested({ [key]: value });
  };
  useEffect(() => {
    if (manual || state.requestedOrigin !== 'user') return;
    const id = window.setTimeout(sendGains, 150);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.requested, state.requestedOrigin, manual]);

  const connectSerial = async () => {
    try {
      serial.current.setBaud(baud);
      serial.current.onLine(processChunk);
      await serial.current.connect();
      source.current = { kind: 'serial', ref: serial.current };
      sim.current.close();
      useDashboard.setState({ simulator: false, connected: true });
      useDashboard.getState().selectGainSet('robot');
      useDashboard.setState({ awaitingRobotGains: true });
      sendCommand('GET');
      useDashboard.getState().addEvent(`Connected at ${baud} baud`);
      notify('Robot connected');
    } catch (e) { notify(e instanceof Error ? e.message : 'Connection failed'); }
  };
  const disconnect = async () => {
    await serial.current.close();
    source.current = { kind: 'sim', ref: sim.current };
    startSimulator();
    useDashboard.getState().addEvent('Disconnected; simulator active');
  };
  const chooseSource = (v: 'sim' | 'robot') => {
    if (v === 'robot' && state.simulator) void connectSerial();
    if (v === 'sim' && !state.simulator) void disconnect();
  };
  const copyConsole = async () => {
    try { await navigator.clipboard.writeText(useDashboard.getState().consoleLines.join('\n')); notify('Console copied'); }
    catch { notify('Could not copy'); }
  };

  const recentRows = state.ring.recent(250);
  const last5s = recentRows.slice(-125);
  const coach = coachHint(last5s.map((r) => r.angle), state.fallCount, state.requested.kd, state.requested.ki, state.requested.kp, last5s.map((r) => r.x));
  const osc = analyze(last5s.map((r) => r.angle), 0.04);
  const age = state.lastPacketAt ? Date.now() - state.lastPacketAt : 0;
  const stale = state.lastPacketAt ? age > 1500 : false;
  const latest = state.telemetry;
  const rms = analyze(recentRows.map((r) => r.angle), 0.04).rms;
  const maxAngle = recentRows.length ? Math.max(...recentRows.map((r) => Math.abs(r.angle))) : 0;
  const saturation = recentRows.length ? recentRows.filter((r) => Math.abs(r.out) >= 255).length / recentRows.length * 100 : 0;
  const confirmed = latest && close(latest.kp, state.requested.kp) && close(latest.ki, state.requested.ki) && close(latest.kd, state.requested.kd);
  const serialSupported = typeof (navigator as Navigator & { serial?: unknown }).serial !== 'undefined';

  const importReplay = async (file: File) => {
    try {
      const json = JSON.parse(await file.text()) as { rows?: Parameters<typeof fillMissingX>[0] };
      if (!json.rows?.length) throw new Error('No telemetry rows found');
      useDashboard.setState({ replayRows: fillMissingX(json.rows), replayIndex: 0, replayPlaying: false, paused: true });
      notify(`Imported ${json.rows.length} samples`);
    } catch (e) { notify(e instanceof Error ? e.message : 'Import failed'); }
  };
  useEffect(() => {
    if (!state.replayPlaying || !state.replayRows.length) return;
    const id = window.setInterval(() => {
      const next = state.replayIndex + 1;
      if (next >= state.replayRows.length) useDashboard.setState({ replayPlaying: false });
      else useDashboard.setState({ replayIndex: next });
    }, 40 / replaySpeed);
    return () => clearInterval(id);
  }, [state.replayPlaying, state.replayIndex, state.replayRows, replaySpeed]);
  useEffect(() => {
    if (!state.replayRows.length) return;
    const row = state.replayRows[state.replayIndex];
    if (!row) return;
    useDashboard.getState().showReplayRow(row);
  }, [state.replayRows, state.replayIndex]);

  const readPresets = (): Record<string, typeof state.requested> => {
    try { return JSON.parse(readLS('dashboard-presets') || '{}'); } catch { return {}; }
  };
  const savePreset = () => {
    const name = presetName.trim();
    if (!name) { notify('Enter a preset name'); return; }
    writeLS('dashboard-presets', JSON.stringify({ ...readPresets(), [name]: state.requested }));
    setPresetName('');
    setPresetVersion((v) => v + 1);
    notify(`Saved preset “${name}”`);
  };
  const presets = Object.keys(readPresets());

  return <div className="app">
    <header className="topbar">
      <div className="wordmark">Balance Lab</div>
      <Segmented label="Data source" value={state.simulator ? 'sim' : 'robot'} onChange={chooseSource}
        options={[{ value: 'sim', label: 'Simulator' }, { value: 'robot', label: 'Robot' }]} />
      {!state.simulator && <span className="baud">{baud} baud</span>}
      {state.simulator && (
        <select className="select select-quiet" aria-label="Baud rate" value={baud}
          onChange={(e) => { const n = Number(e.target.value); setBaud(n); writeLS('dashboard-baud', String(n)); }}>
          {[9600, 38400, 115200].map((n) => <option key={n} value={n}>{n} baud</option>)}
        </select>
      )}
      <div className="status" data-state={stale ? 'stale' : state.connected ? 'live' : 'off'}
        title={state.lastPacketAt ? `Last packet ${age} ms ago` : 'No packets yet'}>
        <span className="status-dot" />
        <span className="status-label">{stale ? 'No data' : state.connected ? 'Live' : 'Offline'}</span>
        <span className="status-meta">{state.packetRate} Hz{state.badPackets > 0 && ` · ${state.badPackets} bad`}</span>
      </div>
      <Battery />
      <div className="topbar-actions">
        <Button variant="ghost" className="rec" data-on={state.recording || undefined}
          onClick={() => useDashboard.setState({ recording: !state.recording })}
          icon={<Record size={14} weight="fill" />}>{state.recording ? 'Recording' : 'Record'}</Button>
        <Button variant="ghost" icon={<UploadSimple size={14} weight="fill" />} onClick={() => fileInput.current?.click()}>Import</Button>
        <input ref={fileInput} type="file" accept=".json" hidden aria-label="Import recording"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importReplay(f); e.target.value = ''; }} />
        <Button variant="ghost" icon={<DownloadSimple size={14} weight="fill" />} onClick={() => exportCsv(state.ring)}>CSV</Button>
        <Button variant="ghost" icon={<DownloadSimple size={14} weight="fill" />}
          onClick={() => downloadJson('robot-run.json', { events: state.events, rows: state.ring.values() })}>JSON</Button>
        <IconButton label={state.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={() => { const theme = state.theme === 'dark' ? 'light' : 'dark'; writeLS('dashboard-theme', theme); useDashboard.setState({ theme }); }}>
          {state.theme === 'dark' ? <Sun size={16} weight="fill" /> : <Moon size={16} weight="fill" />}
        </IconButton>
        <Button variant="danger" icon={<Stop size={14} weight="fill" />} onClick={() => sendCommand('RUN=0')}
          title="Emergency stop (Space)">Stop</Button>
      </div>
    </header>

    {!state.simulator && !serialSupported && <div className="notice">Web Serial needs Chrome or Edge on a desktop.</div>}
    {state.replayRows.length > 0 && (
      <div className="replaybar">
        <span className="replay-label">Replay</span>
        <IconButton label={state.replayPlaying ? 'Pause replay' : 'Play replay'}
          onClick={() => useDashboard.setState({ replayPlaying: !state.replayPlaying })}>
          {state.replayPlaying ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}
        </IconButton>
        <input className="range replay-scrub" aria-label="Replay position" type="range" min={0} max={Math.max(0, state.replayRows.length - 1)}
          value={state.replayIndex} style={{ ['--pct' as string]: `${(state.replayIndex / Math.max(1, state.replayRows.length - 1)) * 100}%` }}
          onChange={(e) => useDashboard.setState({ replayIndex: Number(e.target.value), paused: true })} />
        <Segmented size="small" label="Replay speed" value={replaySpeed} onChange={setReplaySpeed}
          options={[0.5, 1, 2, 4].map((n) => ({ value: n, label: `${n}×` }))} />
        <Button size="small" variant="ghost" icon={<X size={14} weight="bold" />}
          onClick={() => useDashboard.setState({ replayRows: [], replayIndex: 0, replayPlaying: false, paused: false })}>Close</Button>
      </div>
    )}

    <main className="layout">
      <div className="col col-left">
        <RobotPanel/>
        <section className="panel tuner" aria-label="PID tuner">
          <div className="panel-head">
            <div className="panel-title">PID tuner</div>
            <Switch label="Live apply" on={!manual} onChange={(on) => setManual(!on)} />
          </div>
          <Gain label="Kp" value={state.requested.kp} min={0} max={40} step={0.1} onChange={(n) => applyGain('kp', n)}/>
          <Gain label="Ki" value={state.requested.ki} min={0} max={5} step={0.05} onChange={(n) => applyGain('ki', n)}/>
          <Gain label="Kd" value={state.requested.kd} min={0} max={5} step={0.05} onChange={(n) => applyGain('kd', n)}/>
          <Gain label="Setpoint" unit="°" value={state.requested.sp} min={-15} max={15} step={0.1} onChange={(n) => applyGain('sp', n)}/>
          <div className="confirm" data-state={latest ? (confirmed ? 'ok' : 'pending') : 'none'}>
            {latest && (confirmed ? <CheckCircle size={14} weight="fill" /> : <WarningCircle size={14} weight="fill" />)}
            <span>{latest ? (confirmed ? 'Robot is running these gains' : 'Robot reports') : 'Waiting for the robot'}</span>
            {latest && !confirmed && <span className="confirm-values">Kp {latest.kp.toFixed(1)} · Ki {latest.ki.toFixed(2)} · Kd {latest.kd.toFixed(2)}</span>}
          </div>
          {manual && <Button variant="primary" className="block" onClick={sendGains}>Send gains</Button>}
          <div className="actions">
            <Button icon={<Play size={14} weight="fill" />} onClick={() => sendCommand('RUN=1')}>Start</Button>
            <Button icon={<Crosshair size={14} weight="fill" />} onClick={() => sendCommand('ZERO')}>Zero angle</Button>
            {state.simulator && <Button icon={<HandPalm size={14} weight="fill" />} onClick={() => sim.current.disturbance()}>Push</Button>}
          </div>
          <div className="presets">
            <input className="input" aria-label="Preset name" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Name these gains"
              onKeyDown={(e) => { if (e.key === 'Enter') savePreset(); }} />
            <Button onClick={savePreset} disabled={!presetName.trim()}>Save</Button>
            <select className="select" aria-label="Load preset" value="" disabled={!presets.length}
              onChange={(e) => { const p = readPresets()[e.target.value]; if (p) { useDashboard.getState().setRequested(p); notify(`Loaded “${e.target.value}”`); } }}>
              <option value="">{presets.length ? 'Load…' : 'No presets'}</option>
              {presets.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          {state.simulator && <div className="sim-section">
            <div className="section-label">Simulator</div>
            <Gain label="Mounting offset" unit="°" value={mountOffset} min={-3} max={3} step={0.1}
              onChange={(n) => { sim.current.setMountOffset(n); setMountOffset(sim.current.mountOffset); }}/>
            <Button size="small" variant="ghost" icon={<ArrowCounterClockwise size={14} weight="bold" />}
              onClick={() => useDashboard.getState().resetSimGains()}>Reset gains to defaults</Button>
          </div>}
        </section>
      </div>

      <Charts/>

      <div className="col col-right">
        <section className="panel side" aria-label="Coach, events and console">
          <div className="tabs" role="tablist" aria-label="Side panel">
            {([['coach', 'Coach'], ['event', 'Events'], ['console', 'Console']] as const).map(([id, name]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className="tab" onClick={() => setTab(id)}>{name}</button>
            ))}
          </div>
          {tab === 'coach' && <div className="coach" role="tabpanel">
            <div className="hint"><Lightbulb size={16} weight="fill" /><p>{coach}</p></div>
            <div className="coach-metrics">
              <div><span>Wobble</span><b>{osc.frequency.toFixed(2)} Hz</b></div>
              <div><span>Amplitude</span><b>{osc.amplitude.toFixed(1)}°</b></div>
            </div>
            <div className="section-label">Tuning recipe</div>
            <ol className="recipe">
              <li>Set Ki and Kd to 0.</li>
              <li>Raise Kp until it just starts to oscillate.</li>
              <li>Add Kd to damp the oscillation.</li>
              <li>If it runs away in one direction, fix the setpoint or press Zero angle first. Only then add a tiny Ki for a steady lean.</li>
            </ol>
          </div>}
          {tab === 'event' && <div className="log" role="tabpanel">
            {state.events.length === 0 && <p className="empty">Nothing yet. Connections, falls and gain changes appear here.</p>}
            {state.events.slice(-100).reverse().map((e, i) => <div key={i} className="log-row">
              <time>{new Date(e.time).toLocaleTimeString([], { hour12: false })}</time>
              <span className="tag" data-kind={e.kind}>{e.kind === 'param' ? 'gain' : e.kind}</span>
              <span className="log-text">{e.text}</span>
            </div>)}
          </div>}
          {tab === 'console' && <div className="console" role="tabpanel">
            <pre aria-label="Raw serial lines">{state.consoleLines.slice(-200).join('\n')}</pre>
            <form className="console-form" onSubmit={(e) => { e.preventDefault(); sendCommand(manualCommand); setManualCommand(''); }}>
              <input className="input mono" aria-label="Manual command" value={manualCommand} onChange={(e) => setManualCommand(e.target.value)} placeholder="KP=12.5" />
              <Button type="submit" variant="primary">Send</Button>
              <IconButton label="Copy console" onClick={copyConsole}><Copy size={16} weight="fill" /></IconButton>
            </form>
          </div>}
        </section>
        <section className="panel stats" aria-label="Session statistics">
          <div className="panel-head"><div className="panel-title">Last 10 seconds</div></div>
          <dl className="stats-grid">
            <div><dt>Max angle</dt><dd>{maxAngle.toFixed(1)}°</dd></div>
            <div><dt>RMS error</dt><dd>{rms.toFixed(2)}°</dd></div>
            <div><dt>Motor saturation</dt><dd>{saturation.toFixed(0)}%</dd></div>
            <div><dt>Falls this session</dt><dd>{state.fallCount}</dd></div>
          </dl>
        </section>
      </div>
    </main>
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}

export default App;
