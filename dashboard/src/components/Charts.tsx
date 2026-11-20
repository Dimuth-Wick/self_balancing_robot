import { memo, useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { Pause, Play } from '@phosphor-icons/react';
import type { TelemetryRingRow } from '../lib/ringbuffer';
import { useDashboard, writeLS } from '../store/useDashboard';
import { fitRange } from '../lib/chartRange';
import { Button, Segmented } from './ui';

type Series = { label: string; color: string; pick: (r: TelemetryRingRow) => number; dash?: boolean };
type ChartDef = { id: string; title: string; unit: string; series: Series[]; minSpan: number; height: number };

// Colours are CSS custom properties so they follow the theme.
const CHARTS: ChartDef[] = [
  { id: 'angle', title: 'Angle', unit: '°', minSpan: 0.2, height: 150, series: [
    { label: 'Angle', color: '--chart-1', pick: (r) => r.angle },
    { label: 'Setpoint', color: '--chart-muted', pick: (r) => r.sp, dash: true },
  ] },
  { id: 'gyro', title: 'Gyro rate', unit: '°/s', minSpan: 2, height: 110, series: [
    { label: 'Gyro', color: '--chart-1', pick: (r) => r.gyro },
  ] },
  { id: 'pid', title: 'PID terms', unit: '', minSpan: 2, height: 120, series: [
    { label: 'P', color: '--chart-1', pick: (r) => r.p },
    { label: 'I', color: '--chart-2', pick: (r) => r.i },
    { label: 'D', color: '--chart-3', pick: (r) => r.d },
  ] },
  { id: 'pwm', title: 'Motor PWM', unit: '', minSpan: 4, height: 110, series: [
    { label: 'Left', color: '--chart-1', pick: (r) => r.pwmL },
    { label: 'Right', color: '--chart-2', pick: (r) => r.pwmR, dash: true },
  ] },
];

const MAX_RATE_HZ = 60;
const REDRAW_MS = 50;

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

const Chart = memo(function Chart({ def }: { def: ChartDef }) {
  const host = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const theme = useDashboard((s) => s.theme);
  const [hidden, setHidden] = useState<boolean[]>(() => def.series.map(() => false));

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const faint = cssVar('--text-faint');
    const grid = cssVar('--line');
    const axis = { stroke: faint, grid: { stroke: grid, width: 1 }, ticks: { show: false }, font: '11px system-ui, sans-serif', size: 46 };
    // The plot fills its box: CSS gives it a fixed height in a scrolling page,
    // or a share of the column when the dashboard fits the window.
    const size = () => ({ width: Math.max(240, el.clientWidth), height: Math.max(80, el.clientHeight || def.height) });
    const plot = new uPlot({
      ...size(),
      legend: { show: false },
      padding: [6, 4, 0, 0],
      scales: {
        x: { time: false },
        y: { range: (_u, min, max) => fitRange(min, max, def.minSpan) },
      },
      axes: [
        { ...axis, incrs: [1, 2, 5, 10, 15, 30, 60], values: (_u, vals) => vals.map((v) => `${v}s`) },
        // Ticks may sit closer than uPlot's default so short charts still get a scale.
        { ...axis, space: 26, values: (_u, vals) => vals.map((v) => `${+v.toFixed(2)}${def.unit}`) },
      ],
      series: [{}, ...def.series.map((s) => ({ label: s.label, stroke: cssVar(s.color), width: 1.5, dash: s.dash ? [4, 4] : undefined, points: { show: false } }))],
      cursor: { sync: { key: 'robot-charts' }, points: { size: 6 } },
    }, [[], ...def.series.map(() => [])], el);
    plotRef.current = plot;

    const resize = new ResizeObserver(() => plot.setSize(size()));
    resize.observe(el);

    const id = window.setInterval(() => {
      const s = useDashboard.getState();
      if (s.paused && !s.replayRows.length) return;
      const span = s.windowSeconds;
      const rows = s.replayRows.length
        ? s.replayRows.slice(Math.max(0, s.replayIndex - span * MAX_RATE_HZ), s.replayIndex + 1)
        : s.ring.recent(span * MAX_RATE_HZ);
      const last = rows.at(-1)?.t ?? 0;
      const recent = rows.filter((r) => r.t >= last - span);
      plot.setData([recent.map((r) => r.t - last), ...def.series.map((sr) => recent.map(sr.pick))], true);
      plot.setScale('x', { min: -span, max: 0 });
    }, REDRAW_MS);

    return () => { clearInterval(id); resize.disconnect(); plot.destroy(); plotRef.current = null; };
  }, [def, theme]);

  const toggle = (i: number) => {
    setHidden((h) => {
      const next = h.map((v, j) => (j === i ? !v : v));
      plotRef.current?.setSeries(i + 1, { show: !next[i] });
      return next;
    });
  };

  return (
    <section className="chart" aria-label={`${def.title} chart`}>
      <div className="chart-head">
        <div className="chart-title">{def.title}</div>
        {def.series.length > 1 && (
          <div className="legend">
            {def.series.map((s, i) => (
              <button key={s.label} type="button" className="legend-item" aria-pressed={!hidden[i]} onClick={() => toggle(i)}>
                <span className="legend-swatch" data-dash={s.dash || undefined} style={{ ['--swatch' as string]: `var(${s.color})` }} />
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div ref={host} className="chart-plot" style={{ ['--h' as string]: `${def.height}px` }} />
    </section>
  );
});

export const Charts = memo(function Charts() {
  const windowSeconds = useDashboard((s) => s.windowSeconds);
  const paused = useDashboard((s) => s.paused);
  const setWindow = (n: number) => { useDashboard.setState({ windowSeconds: n }); writeLS('dashboard-window', String(n)); };
  return (
    <div className="panel charts">
      <div className="panel-head">
        <div className="panel-title">Telemetry</div>
        <div className="panel-tools">
          <Segmented size="small" label="Time window" value={windowSeconds} onChange={setWindow}
            options={[5, 10, 30, 60].map((n) => ({ value: n, label: `${n}s` }))} />
          <Button size="small" variant="ghost" onClick={() => useDashboard.setState({ paused: !paused })}
            icon={paused ? <Play size={14} weight="fill" /> : <Pause size={14} weight="fill" />}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
        </div>
      </div>
      {CHARTS.map((def) => <Chart key={def.id} def={def} />)}
    </div>
  );
});
