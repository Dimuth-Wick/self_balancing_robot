import { useDashboard } from '../store/useDashboard';

/** The original 2D robot drawing; used while the 3D view loads and when WebGL is unavailable. */
export function RobotSvg() {
  const t = useDashboard((s) => s.telemetry);
  const angle = t?.angle ?? 0;
  const zone = Math.abs(angle) < 3 ? 'green' : Math.abs(angle) < 15 ? 'amber' : 'red';
  const zoneText = zone === 'green' ? 'Stable' : zone === 'amber' ? 'Warning' : 'Danger';
  const pwm = t?.out ?? 0;
  return (
      <svg className="robot" viewBox="0 0 300 250" role="img" aria-label={`Robot tilted ${angle.toFixed(1)} degrees, ${zoneText}`}>
        <g transform={`rotate(${angle} 150 155)`}>
          <rect x="108" y="74" width="84" height="104" rx="14" fill="#7c93ff" stroke="#cfd7ff" strokeWidth="3"/>
          <rect x="128" y="92" width="44" height="38" rx="5" fill="#151a2d"/>
          <circle cx="150" cy="111" r="9" fill="#54e0a1"/>
          <line x1="150" y1="74" x2="150" y2="42" stroke="#cfd7ff" strokeWidth="5"/>
        </g>
        <g>
          <circle cx="92" cy="190" r="30" fill="#151922" stroke="#9aa3b8" strokeWidth="7"/>
          <circle cx="208" cy="190" r="30" fill="#151922" stroke="#9aa3b8" strokeWidth="7"/>
          <circle cx="92" cy="190" r="5" fill="#9aa3b8"/><circle cx="208" cy="190" r="5" fill="#9aa3b8"/>
        </g>
        {pwm !== 0 && <path d={pwm > 0 ? 'M 150 218 l 8 -14 l 8 14 z' : 'M 150 218 l -8 -14 l -8 14 z'} fill="#54e0a1"/>}
      </svg>
  );
}
