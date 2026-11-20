import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import './App.css';
import { LineBuffer, parseLine } from './lib/protocol';
import { Simulator } from './lib/simulator';
import { WebSerial } from './lib/serial';
import { analyze, coachHint } from './lib/metrics';
import { downloadJson, exportCsv } from './lib/export';
import { useDashboard } from './store/useDashboard';
import { RobotPanel } from './components/RobotPanel';
import { fillMissingX } from './lib/positionEstimator';

function Gain({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (n: number) => void;
}) {
  const tips: Record<string, string> = {
    Kp: 'Controls response to tilt. Too high: fast oscillation. Too low: cannot catch the fall.',
    Ki: 'Removes a steady lean from uneven load. Too high: slow wobble that grows. It will NOT stop a run-away — fix the setpoint for that.',
    Kd: 'Damps motion like friction. Too high: noisy or sluggish. Too low: wobble grows.',
    Setpoint: 'The angle the robot tries to hold. If it is off from the true balance angle, the robot runs away in one direction and falls.',
    'Mounting offset': 'Simulator only: pretend the sensor is mounted crooked by this many degrees. Try 0.5° and watch it run away, then press Zero angle.',
  };
  return <div className="gain">
    <div className="gain-label"><label>{label} <span title={tips[label] || 'Control parameter'}>ⓘ</span></label>
      <input aria-label={`${label} numeric`} type="number" value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(Number(e.target.value))} /></div>
    <input aria-label={`${label} slider`} type="range" value={value} min={min} max={max} step={step}
      onChange={(e) => onChange(Number(e.target.value))} />
  </div>;
}

function Chart({ title, series }: { title: string; series: { label: string; color: string; values: number[] }[] }) {
  const el = useRef<HTMLDivElement>(null);
  const ring = useDashboard((s) => s.ring);
  const paused = useDashboard((s) => s.paused);
  const windowSeconds = useDashboard((s) => s.windowSeconds);
  const replay = useDashboard((s) => s.replayRows);
  const replayIndex = useDashboard((s) => s.replayIndex);
  useEffect(() => {
    if (!el.current) return;
    const plot = new uPlot({
      width: Math.max(300, el.current.clientWidth),
      height: 150,
      legend: { show: false },
      scales: { x: { time: false }, y: { range: (_u, min, max) => [Math.min(min, -20), Math.max(max, 20)] } },
      axes: [{ stroke: '#8790a5', grid: { stroke: '#252b3b' } }, { stroke: '#8790a5', grid: { stroke: '#252b3b' } }],
      series: [{}, ...series.map((s) => ({ label: s.label, stroke: s.color, width: 1.5 }))],
      cursor: { sync: { key: 'robot-charts' } },
    }, [[], ...series.map(() => [])], el.current);
    const id = window.setInterval(() => {
      if (paused) return;
      const rows = replay.length ? replay.slice(0, replayIndex + 1) : ring.values();
      const recent = rows.filter((r) => !rows.length || r.t >= (rows.at(-1)?.t ?? 0) - windowSeconds);
      const data: uPlot.AlignedData = [
        recent.map((r) => r.t),
        ...series.map((s) => recent.map((r) => s.values[recent.indexOf(r)] ?? (s.label === 'Angle' ? r.angle : s.label === 'Setpoint' ? r.sp : s.label === 'Gyro' ? r.gyro : s.label === 'Battery' ? r.vbat : s.label === 'P' ? r.p : s.label === 'I' ? r.i : s.label === 'D' ? r.d : s.label === 'PWM L' ? r.pwmL : s.label === 'PWM R' ? r.pwmR : r.out))),
      ];
      plot.setData(data);
    }, 50);
    return () => { clearInterval(id); plot.destroy(); };
  }, [ring, paused, windowSeconds, replay, replayIndex, series]);
  return <section className="panel chart-panel"><h3>{title}</h3><div ref={el} className="chart"/></section>;
}

function Charts() {
  const [window, setWindow] = useState(useDashboard.getState().windowSeconds);
  const paused = useDashboard((s) => s.paused);
  useEffect(() => { useDashboard.setState({ windowSeconds: window }); localStorage.setItem('dashboard-window', String(window)); }, [window]);
  return <div className="charts">
    <div className="chart-toolbar"><div>{[5,10,30,60].map((n) => <button className={window === n ? 'active' : ''} key={n} onClick={() => setWindow(n)}>{n}s</button>)}</div>
      <button onClick={() => useDashboard.setState({ paused: !paused })}>{paused ? '▶ Resume' : 'Ⅱ Pause'}</button></div>
    <Chart title="Angle vs setpoint" series={[{ label: 'Angle', color: '#7c93ff', values: [] }, { label: 'Setpoint', color: '#54e0a1', values: [] }]}/>
    <Chart title="Gyro rate" series={[{ label: 'Gyro', color: '#e4b85c', values: [] }]}/>
    <Chart title="PID terms" series={[{ label: 'P', color: '#ff7676', values: [] }, { label: 'I', color: '#54e0a1', values: [] }, { label: 'D', color: '#7c93ff', values: [] }]}/>
    <Chart title="Motor PWM" series={[{ label: 'PWM L', color: '#e4b85c', values: [] }, { label: 'PWM R', color: '#c084fc', values: [] }]}/>
    <Chart title="Battery voltage" series={[{ label: 'Battery', color: '#54e0a1', values: [] }]}/>
  </div>;
}

function App() {
  const sim = useRef(new Simulator());
  const serial = useRef(new WebSerial());
  const buffer = useRef(new LineBuffer());
  const source = useRef<{ kind: 'sim'|'serial'; ref: Simulator|WebSerial }>({ kind: 'sim', ref: sim.current });
  const state = useDashboard();
  const [manual, setManual] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [baud, setBaud] = useState(Number(localStorage.getItem('dashboard-baud') || 38400));
  const [tab, setTab] = useState<'event'|'console'|'coach'>('coach');
  const [toast, setToast] = useState('');
  const [manualCommand, setManualCommand] = useState('');
  const [mountOffset, setMountOffset] = useState(0);

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
      useDashboard.setState({ packets: 0 });
    }, 1000);
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') { e.preventDefault(); sendCommand('RUN=0'); }
      if (e.key.toLowerCase() === 'r') useDashboard.setState({ recording: !useDashboard.getState().recording });
      if (e.key.toLowerCase() === 'p') useDashboard.setState({ paused: !useDashboard.getState().paused });
      if (e.key === '?') notify('Shortcuts: Space=STOP, R=record, P=pause, ?=help');
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
  const applyGain = (key: 'kp'|'ki'|'kd'|'sp', value: number) => {
    useDashboard.getState().setRequested({ [key]: value });
  };
  useEffect(() => {
    if (manual || state.requestedOrigin !== 'user') return;
    const id = window.setTimeout(() => {
      const r = useDashboard.getState().requested;
      sendCommand(`KP=${r.kp}`);
      sendCommand(`KI=${r.ki}`);
      sendCommand(`KD=${r.kd}`);
      sendCommand(`SP=${r.sp}`);
    }, 150);
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
      notify('Serial connected');
    } catch (e) { notify(e instanceof Error ? e.message : 'Connection failed'); }
  };
  const disconnect = async () => {
    await serial.current.close();
    source.current = { kind: 'sim', ref: sim.current };
    startSimulator();
    useDashboard.getState().addEvent('Disconnected; simulator active');
  };
  const copyConsole = async () => {
    await navigator.clipboard.writeText(useDashboard.getState().consoleLines.join('\n'));
    notify('Console copied');
  };
  const recentRows = state.ring.values().slice(-125);
  const coach = coachHint(recentRows.map((r) => r.angle), state.fallCount, state.requested.kd, state.requested.ki, state.requested.kp, recentRows.map((r) => r.x));
  const osc = analyze(state.ring.values().slice(-125).map((r) => r.angle), 0.04);
  const stale = state.lastPacketAt ? Date.now() - state.lastPacketAt > 1500 : false;
  const latest = state.telemetry;
  const rows = state.ring.values();
  const rms = analyze(rows.slice(-250).map((r) => r.angle), 0.04).rms;
  const saturation = rows.length ? rows.slice(-250).filter((r) => Math.abs(r.out) >= 255).length / Math.min(rows.length, 250) * 100 : 0;
  const [replaySpeed, setReplaySpeed] = useState(1);
  const importReplay = async (file: File) => {
    try {
      const json = JSON.parse(await file.text()) as { rows?: Parameters<typeof fillMissingX>[0] };
      if (!json.rows?.length) throw new Error('No telemetry rows found');
      useDashboard.setState({ replayRows: fillMissingX(json.rows), replayIndex: 0, replayPlaying: false, paused: true });
      notify(`Imported ${json.rows.length} replay samples`);
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

  const savePreset = () => {
    if (!presetName.trim()) { notify('Enter a preset name'); return; }
    try {
      const saved = JSON.parse(localStorage.getItem('dashboard-presets') || '{}') as Record<string, typeof state.requested>;
      saved[presetName.trim()] = state.requested;
      localStorage.setItem('dashboard-presets', JSON.stringify(saved));
      notify(`Saved preset ${presetName.trim()}`);
    } catch { notify('Could not save preset'); }
  };

  return <div className="app">
    <header className="connection-bar">
      <div className="brand">⚖ <span>Balance Lab</span></div>
      <div className="status"><i className={stale ? 'amber' : state.connected ? 'green' : 'red'} /> {stale ? 'STALE' : state.connected ? 'CONNECTED' : 'NOT CONNECTED'}</div>
      <select aria-label="Baud rate" value={baud} onChange={(e) => { const n = Number(e.target.value); setBaud(n); localStorage.setItem('dashboard-baud', String(n)); }}>
        {[9600,38400,115200].map((n) => <option key={n}>{n}</option>)}
      </select>
      <button onClick={state.simulator ? connectSerial : disconnect}>{state.simulator ? 'Connect' : 'Disconnect'}</button>
      <label className="switch"><input type="checkbox" checked={state.simulator} onChange={(e) => e.target.checked ? startSimulator() : connectSerial()}/> Simulator</label>
      <div className="live-stats"><span><b>{state.packets}</b> pkt/s</span><span><b>{state.badPackets}</b> bad</span><span><b>{stale ? '>1500' : state.lastPacketAt ? Date.now() - state.lastPacketAt : 0}</b> ms age</span></div>
      <button className={state.recording ? 'recording' : ''} onClick={() => useDashboard.setState({ recording: !state.recording })}>● {state.recording ? 'Recording' : 'Record'}</button>
      <button onClick={() => exportCsv(state.ring)}>Export CSV</button>
      <button onClick={() => downloadJson('robot-run.json', { events: state.events, rows: state.ring.values() })}>Export JSON</button>
      <label className="switch"><input type="file" accept=".json" onChange={(e) => { const f=e.target.files?.[0]; if(f) void importReplay(f); }}/> Import JSON</label>
      {state.replayRows.length > 0 && <><button onClick={() => useDashboard.setState({ replayPlaying: !state.replayPlaying })}>{state.replayPlaying?'Pause replay':'Play replay'}</button>
        <select aria-label="Replay speed" value={replaySpeed} onChange={(e)=>setReplaySpeed(Number(e.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select>
        <input aria-label="Replay position" type="range" min={0} max={Math.max(0,state.replayRows.length-1)} value={state.replayIndex} onChange={(e)=>useDashboard.setState({replayIndex:Number(e.target.value), paused:true})}/></>}
      <button aria-label="Toggle theme" onClick={() => { const theme = state.theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('dashboard-theme', theme); useDashboard.setState({ theme }); }}>{state.theme === 'dark' ? '☀' : '☾'}</button>
    </header>
    {typeof (navigator as Navigator & { serial?: unknown }).serial === 'undefined' && <div className="unsupported">Unsupported browser: Web Serial needs Chrome or Edge on desktop.</div>}
    <main className="dashboard-grid">
      <aside className="left-column">
        <RobotPanel/>
        <section className="panel tuner">
          <div className="panel-title"><h2>PID tuner</h2><label className="manual"><input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)}/> Manual Send</label></div>
          <Gain label="Kp" value={state.requested.kp} min={0} max={40} step={0.1} onChange={(n) => applyGain('kp',n)}/>
          <Gain label="Ki" value={state.requested.ki} min={0} max={5} step={0.05} onChange={(n) => applyGain('ki',n)}/>
          <Gain label="Kd" value={state.requested.kd} min={0} max={5} step={0.05} onChange={(n) => applyGain('kd',n)}/>
          <Gain label="Setpoint" value={state.requested.sp} min={-15} max={15} step={0.1} onChange={(n) => applyGain('sp',n)}/>
          <div className={`confirmed ${(latest && (latest.kp !== state.requested.kp || latest.ki !== state.requested.ki || latest.kd !== state.requested.kd)) ? 'mismatch' : ''}`}>
            Robot: Kp {latest?.kp?.toFixed(1) ?? '—'} · Ki {latest?.ki?.toFixed(2) ?? '—'} · Kd {latest?.kd?.toFixed(2) ?? '—'}
          </div>
          <div className="presets"><input aria-label="Preset name" value={presetName} onChange={(e)=>setPresetName(e.target.value)} placeholder="Preset name"/>
            <button onClick={savePreset}>Save</button>
            <select aria-label="Load preset" defaultValue="" onChange={(e)=>{if(!e.target.value)return;try{const p=JSON.parse(localStorage.getItem('dashboard-presets')||'{}') as Record<string,typeof state.requested>;useDashboard.getState().setRequested(p[e.target.value]);notify(`Loaded ${e.target.value}`);}catch{notify('Could not load preset');}}}><option value="">Load preset</option>{(()=>{try{const p=JSON.parse(localStorage.getItem('dashboard-presets')||'{}') as Record<string,unknown>;return Object.keys(p).map(n=><option key={n}>{n}</option>);}catch{return null;}})()}</select></div>
          <div className="tuner-actions">
            <button onClick={() => sendCommand('RUN=1')}>▶ Start</button>
            <button onClick={() => sendCommand('RUN=0')} className="stop">■ STOP</button>
            <button onClick={() => sendCommand('ZERO')}>Zero angle</button>
            {state.simulator && <button onClick={() => sim.current.disturbance()}>Disturbance</button>}
          </div>
          {state.simulator && <>
            <Gain label="Mounting offset" value={mountOffset} min={-3} max={3} step={0.1}
              onChange={(n) => { sim.current.setMountOffset(n); setMountOffset(sim.current.mountOffset); }}/>
            <button className="link-button" onClick={() => useDashboard.getState().resetSimGains()}>Reset to defaults</button>
          </>}
          {manual && <button className="send" onClick={() => { const r=state.requested; sendCommand(`KP=${r.kp}`); sendCommand(`KI=${r.ki}`); sendCommand(`KD=${r.kd}`); sendCommand(`SP=${r.sp}`); }}>Send requested values</button>}
        </section>
        <section className="panel stats">
          <h2>Session statistics</h2>
          <div className="stats-grid"><span>Max angle<b>{rows.length ? Math.max(...rows.slice(-250).map((r)=>Math.abs(r.angle))).toFixed(1) : '0'}°</b></span>
            <span>RMS error (10s)<b>{rms.toFixed(2)}°</b></span><span>Saturation<b>{saturation.toFixed(1)}%</b></span><span>Falls<b>{state.fallCount}</b></span></div>
        </section>
      </aside>
      <Charts/>
      <section className="panel bottom-panel">
        <div className="tabs"><button className={tab==='coach'?'active':''} onClick={()=>setTab('coach')}>Coach</button><button className={tab==='event'?'active':''} onClick={()=>setTab('event')}>Event log</button><button className={tab==='console'?'active':''} onClick={()=>setTab('console')}>Console</button></div>
        {tab==='coach' && <div className="coach"><ol><li>Set Ki = 0 and Kd = 0.</li><li>Raise Kp until it just oscillates.</li><li>Add Kd to damp the oscillation.</li><li>If it runs away in one direction, fix the setpoint or press Zero first; only then add a tiny Ki for a steady lean.</li></ol><div className="hint"><b>Live hint:</b> {coach}</div><div>Detected frequency <b>{osc.frequency.toFixed(2)} Hz</b> · amplitude <b>{osc.amplitude.toFixed(1)}°</b></div></div>}
        {tab==='event' && <div className="log"><button onClick={()=>exportCsv(state.ring)}>Export session</button>{state.events.slice(-100).reverse().map((e,i)=><div key={i}><time>{new Date(e.time).toLocaleTimeString()}</time><b className={e.kind}>{e.kind}</b>{e.text}</div>)}</div>}
        {tab==='console' && <div className="console"><div className="console-actions"><button onClick={copyConsole}>Copy</button></div><pre>{state.consoleLines.join('\n')}</pre><form onSubmit={(e)=>{e.preventDefault();sendCommand(manualCommand);setManualCommand('');}}><input aria-label="Manual command" value={manualCommand} onChange={(e)=>setManualCommand(e.target.value)} placeholder="KP=12.5"/><button>Send</button></form></div>}
      </section>
    </main>
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}

export default App;
