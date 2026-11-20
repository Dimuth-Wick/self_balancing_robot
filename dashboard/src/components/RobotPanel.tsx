import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { ArrowsOut, Crosshair, X } from '@phosphor-icons/react';
import { useDashboard } from '../store/useDashboard';
import { hasWebGL } from '../lib/webgl';
import { RobotSvg } from './RobotSvg';
import { IconButton, Tip } from './ui';

const Robot3D = lazy(() => import('./Robot3D'));
const GAUGE_RANGE = 45;
/** Fixed decimals without a stray minus sign on values that round to zero. */
const fmt = (v: number, d: number) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);

function Scene3D({ height, webgl }: { height: number | string; webgl: boolean }) {
  if (!webgl) return <RobotSvg />;
  return <Suspense fallback={<RobotSvg />}><Robot3D height={height} /></Suspense>;
}

const STATE_LABEL = ['Stopped', 'Balancing', 'Fallen'] as const;

export function RobotPanel() {
  const t = useDashboard((s) => s.telemetry);
  const pos = useDashboard((s) => s.pos);
  const origin = useDashboard((s) => s.displayOrigin);
  const fallCount = useDashboard((s) => s.fallCount);
  const [expanded, setExpanded] = useState(false);
  const webgl = useMemo(hasWebGL, []);
  const angle = t?.angle ?? 0;
  const state = t?.state ?? 0;
  const x = pos.x - origin;
  const abs = Math.abs(angle);
  const zone = abs < 3 ? 'ok' : abs < 15 ? 'warn' : 'bad';
  const zoneLabel = zone === 'ok' ? 'Upright' : zone === 'warn' ? 'Leaning' : 'Falling';
  const marker = 50 + (Math.max(-GAUGE_RANGE, Math.min(GAUGE_RANGE, angle)) / GAUGE_RANGE) * 50;

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  return <section className="panel robot" aria-label="Live robot">
    <div className="panel-head">
      <div className="panel-title">Live robot</div>
      <div className="panel-tools">
        <span className="state" data-state={state}>{STATE_LABEL[state] ?? 'Unknown'}</span>
        <IconButton label="Recenter position" onClick={() => useDashboard.getState().recenter()}><Crosshair size={16} weight="fill" /></IconButton>
        {webgl && <IconButton label="Expand 3D view" onClick={() => setExpanded(true)}><ArrowsOut size={16} weight="bold" /></IconButton>}
      </div>
    </div>
    <div className="robot-stage">
      {expanded
        ? <div className="robot-placeholder">Showing in the expanded view</div>
        : <Scene3D height={280} webgl={webgl} />}
    </div>
    <div className="readout">
      <div className="readout-main">
        <span className="readout-label">Angle <Tip text="Filtered tilt from upright. 0° is straight up; positive leans forward." /></span>
        <span className="readout-value">{fmt(angle, 1)}<span className="readout-unit">°</span></span>
        <span className="zone" data-zone={zone}>{zoneLabel}</span>
      </div>
      <div className="gauge" aria-hidden="true">
        <div className="gauge-track">
          <span className="gauge-band" data-zone="bad" /><span className="gauge-band" data-zone="warn" />
          <span className="gauge-band" data-zone="ok" />
          <span className="gauge-band" data-zone="warn" /><span className="gauge-band" data-zone="bad" />
        </div>
        <span className="gauge-marker" style={{ left: `${marker}%` }} />
        <div className="gauge-scale"><span>−45°</span><span>0°</span><span>+45°</span></div>
      </div>
      <dl className="readout-row">
        <div><dt>Gyro</dt><dd>{fmt(t?.gyro ?? 0, 1)} °/s</dd></div>
        <div>
          <dt>Position{pos.estimated && <Tip text="Estimated from motor PWM — the shape of the motion is right, the distance is approximate." />}</dt>
          <dd>{Number(fmt(x, 2)) < 0 ? '−' : '+'}{fmt(Math.abs(x), 2)} m{pos.estimated && <span className="est"> est.</span>}</dd>
        </div>
        <div><dt>Falls</dt><dd>{fallCount}</dd></div>
      </dl>
    </div>
    {expanded && <div className="overlay" role="dialog" aria-modal="true" aria-label="Expanded 3D robot view">
      <div className="overlay-head">
        <div className="panel-title">Live robot</div>
        <IconButton label="Close expanded view" onClick={() => setExpanded(false)}><X size={16} weight="bold" /></IconButton>
      </div>
      <Scene3D height="100%" webgl={webgl} />
    </div>}
  </section>;
}
