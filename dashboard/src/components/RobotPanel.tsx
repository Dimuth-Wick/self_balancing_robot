import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useDashboard } from '../store/useDashboard';
import { hasWebGL } from '../lib/webgl';
import { RobotSvg } from './RobotSvg';

const Robot3D = lazy(() => import('./Robot3D'));

function Scene3D({ height, webgl }: { height: number | string; webgl: boolean }) {
  if (!webgl) return <RobotSvg />;
  return <Suspense fallback={<RobotSvg />}><Robot3D height={height} /></Suspense>;
}

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

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  return <section className="panel robot-panel">
    <div className="panel-title">
      <h2>Live robot</h2>
      <div className="panel-actions">
        <span className={`badge ${state === 1 ? 'good' : state === 2 ? 'danger' : ''}`}>
          {state === 2 ? 'FALLEN' : state === 1 ? 'BALANCING' : 'STOPPED'}
        </span>
        <button className="icon-button" aria-label="Recenter position" title="Recenter position"
          onClick={() => useDashboard.getState().recenter()}>⌖</button>
        {webgl && <button className="icon-button" aria-label="Expand 3D view" title="Expand 3D view"
          onClick={() => setExpanded(true)}>⤢</button>}
      </div>
    </div>
    {expanded
      ? <div className="robot3d-placeholder">Showing in expanded view</div>
      : <Scene3D height={300} webgl={webgl} />}
    <div className="gauge"><div className="gauge-band green">0–3°</div><div className="gauge-band amber">3–15°</div><div className="gauge-band red">&gt;15°</div></div>
    <div className="hero-readouts four">
      <div><span>Angle <b title="Filtered tilt from upright">ⓘ</b></span><strong>{angle.toFixed(2)}°</strong></div>
      <div><span>Gyro <b title="Angular velocity">ⓘ</b></span><strong>{(t?.gyro ?? 0).toFixed(1)}°/s</strong></div>
      <div>
        <span>Position <b title={pos.estimated ? 'Estimated from motor PWM — the scale is approximate.' : 'Distance travelled along the floor.'}>ⓘ</b></span>
        <strong>{x >= 0 ? '+' : ''}{x.toFixed(2)} m{pos.estimated && <small className="est"> est.</small>}</strong>
      </div>
      <div><span>Falls</span><strong>{fallCount}</strong></div>
    </div>
    {expanded && <div className="robot-overlay" role="dialog" aria-modal="true" aria-label="Expanded 3D robot view">
      <button className="icon-button robot-overlay-close" aria-label="Close expanded view" onClick={() => setExpanded(false)}>✕</button>
      <Scene3D height="100%" webgl={webgl} />
    </div>}
  </section>;
}
