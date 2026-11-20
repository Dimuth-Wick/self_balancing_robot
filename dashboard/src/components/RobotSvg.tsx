import { useDashboard } from '../store/useDashboard';

/** The original 2D robot drawing; used while the 3D view loads and when WebGL is unavailable. */
export function RobotSvg() {
  const t = useDashboard((s) => s.telemetry);
  const angle = t?.angle ?? 0;
  const zone = Math.abs(angle) < 3 ? 'green' : Math.abs(angle) < 15 ? 'amber' : 'red';
  const zoneText = zone === 'green' ? 'Stable' : zone === 'amber' ? 'Warning' : 'Danger';
  const pwm = t?.out ?? 0;
  return (
      <svg className="robot-svg" viewBox="0 0 300 250" role="img" aria-label={`Robot tilted ${angle.toFixed(1)} degrees, ${zoneText}`}>
        <g transform={`rotate(${angle} 150 155)`}>
          <rect x="108" y="74" width="84" height="104" rx="14" fill="#2f3440"/>
          <rect x="128" y="92" width="44" height="38" rx="5" fill="#2563eb"/>
          <circle cx="150" cy="111" r="6" fill="#ffffff"/>
          <line x1="150" y1="74" x2="150" y2="42" stroke="#9aa0aa" strokeWidth="4"/>
        </g>
        <g>
          <circle cx="92" cy="190" r="30" fill="#1f2329" stroke="#c9ccd2" strokeWidth="5"/>
          <circle cx="208" cy="190" r="30" fill="#1f2329" stroke="#c9ccd2" strokeWidth="5"/>
          <circle cx="92" cy="190" r="6" fill="#f2c230"/><circle cx="208" cy="190" r="6" fill="#f2c230"/>
        </g>
        {pwm !== 0 && <path d={pwm > 0 ? 'M 150 218 l 8 -14 l 8 14 z' : 'M 150 218 l -8 -14 l -8 14 z'} fill="#3b82f6"/>}
      </svg>
  );
}
