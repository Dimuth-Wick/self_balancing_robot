import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useDashboard } from '../store/useDashboard';

// World: metres, floor at y = 0, robot travels along x, axle along z.
// Positive angle = leaning forward (+x) → body rotation.z = −angle.
const WHEEL_R = 0.0325;
const TRACK = 0.12;
const SMOOTH_TAU = 0.04;
const TRAIL_POINTS = 250;
const TRAIL_SAMPLE_S = 0.04;
const CAM_OFFSET = new THREE.Vector3(0, 0.22, 0.95);
const LOOK_HEIGHT = 0.08;
const BODY_COLOR = '#7c93ff';
const ACCENT = '#54e0a1';

type Controls = { target: THREE.Vector3; update(): void };

function readTargets() {
  const s = useDashboard.getState();
  return {
    angle: s.telemetry?.angle ?? 0,
    out: s.telemetry?.out ?? 0,
    x: s.pos.x - s.displayOrigin,
  };
}

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function Wheel({ z, wheelRef }: { z: number; wheelRef: (g: THREE.Group | null) => void }) {
  return (
    <group position={[0, WHEEL_R, z]}>
      <group ref={wheelRef}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[WHEEL_R, WHEEL_R, 0.026, 32]} />
          <meshStandardMaterial color="#1b1f2a" roughness={0.9} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[WHEEL_R * 0.92, 0.004, 8, 32]} />
          <meshStandardMaterial color="#9aa3b8" />
        </mesh>
        {/* Spokes make rotation visible. */}
        {[0, Math.PI / 3, (2 * Math.PI) / 3].map((r) => (
          <mesh key={r} rotation={[0, 0, r]} position={[0, 0, z > 0 ? 0.014 : -0.014]}>
            <boxGeometry args={[WHEEL_R * 1.8, 0.005, 0.002]} />
            <meshStandardMaterial color={r === 0 ? ACCENT : '#9aa3b8'} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function RobotModel({ bodyRef, wheelRefs }: {
  bodyRef: MutableRefObject<THREE.Group | null>;
  wheelRefs: MutableRefObject<(THREE.Group | null)[]>;
}) {
  return (
    <>
      <Wheel z={TRACK / 2} wheelRef={(g) => { wheelRefs.current[0] = g; }} />
      <Wheel z={-TRACK / 2} wheelRef={(g) => { wheelRefs.current[1] = g; }} />
      <mesh position={[0, WHEEL_R, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.004, 0.004, TRACK, 8]} />
        <meshStandardMaterial color="#9aa3b8" />
      </mesh>
      {/* Body pivots about the axle. */}
      <group ref={bodyRef} position={[0, WHEEL_R, 0]}>
        <mesh position={[0, 0.08, 0]} castShadow>
          <boxGeometry args={[0.055, 0.14, 0.095]} />
          <meshStandardMaterial color={BODY_COLOR} roughness={0.5} />
        </mesh>
        {/* Battery pack */}
        <mesh position={[-0.034, 0.05, 0]}>
          <boxGeometry args={[0.012, 0.05, 0.07]} />
          <meshStandardMaterial color="#2b3245" />
        </mesh>
        {/* MPU6050 board on the front face so "forward" is visible. */}
        <mesh position={[0.0295, 0.11, 0]}>
          <boxGeometry args={[0.003, 0.022, 0.03]} />
          <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={0.25} />
        </mesh>
        <mesh position={[0, 0.17, 0]}>
          <cylinderGeometry args={[0.0025, 0.0025, 0.04, 8]} />
          <meshStandardMaterial color="#cfd7ff" />
        </mesh>
        <mesh position={[0, 0.193, 0]}>
          <sphereGeometry args={[0.006, 12, 12]} />
          <meshStandardMaterial color={ACCENT} />
        </mesh>
      </group>
    </>
  );
}

function DistanceLabels({ centerBin }: { centerBin: number }) {
  const marks = [];
  for (let i = -6; i <= 6; i++) {
    const m = (centerBin + i) * 0.5;
    marks.push(
      <Html key={m} position={[m, 0.001, 0.13]} center zIndexRange={[10, 0]}>
        <span className="floor-label">{m.toFixed(1)} m</span>
      </Html>,
    );
  }
  return <>{marks}</>;
}

function Scene({ resetRef }: { resetRef: MutableRefObject<(() => void) | null> }) {
  const theme = useDashboard((s) => s.theme);
  const colors = useMemo(() => ({
    cell: cssVar('--border', '#293142'),
    section: cssVar('--muted', '#9aa4b7'),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [theme]);

  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group | null>(null);
  const wheels = useRef<(THREE.Group | null)[]>([]);
  const rendered = useRef({ angle: 0, x: 0, init: false, followX: 0, trailClock: 0 });
  const [centerBin, setCenterBin] = useState(0);
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as Controls | null;

  const arrow = useMemo(() => new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.1, ACCENT, 0.03, 0.02), []);
  const trail = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3));
    geom.setDrawRange(0, 0);
    const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.45 }));
    return { line, geom, count: 0 };
  }, []);

  const clearTrail = () => { trail.count = 0; trail.geom.setDrawRange(0, 0); };
  const pushTrail = (x: number) => {
    const attr = trail.geom.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    if (trail.count === TRAIL_POINTS) { arr.copyWithin(0, 3); trail.count--; }
    arr.set([x, 0.002, 0], trail.count * 3);
    trail.count++;
    attr.needsUpdate = true;
    trail.geom.setDrawRange(0, trail.count);
  };

  useEffect(() => {
    resetRef.current = () => {
      const x = rendered.current.x;
      camera.position.set(x + CAM_OFFSET.x, CAM_OFFSET.y, CAM_OFFSET.z);
      controls?.target.set(x, LOOK_HEIGHT, 0);
      controls?.update();
      rendered.current.followX = x;
    };
    return () => { resetRef.current = null; };
  }, [camera, controls, resetRef]);

  useEffect(() => () => { trail.geom.dispose(); (trail.line.material as THREE.Material).dispose(); arrow.dispose(); }, [trail, arrow]);

  useFrame((_, frameDt) => {
    const t = readTargets();
    const r = rendered.current;
    const k = 1 - Math.exp(-Math.min(frameDt, 0.1) / SMOOTH_TAU);
    if (!r.init || Math.abs(t.x - r.x) > 0.5 || Math.abs(t.angle - r.angle) > 30) {
      if (r.init && Math.abs(t.x - r.x) > 0.5) clearTrail();
      r.angle = t.angle; r.x = t.x; r.init = true;
    } else {
      r.angle += (t.angle - r.angle) * k;
      r.x += (t.x - r.x) * k;
    }

    if (root.current) root.current.position.x = r.x;
    if (body.current) body.current.rotation.z = -r.angle * Math.PI / 180;
    for (const w of wheels.current) if (w) w.rotation.z = -r.x / WHEEL_R;

    arrow.visible = Math.abs(t.out) > 0.5;
    if (arrow.visible) {
      arrow.position.set(r.x, 0.006, 0);
      arrow.setDirection(new THREE.Vector3(Math.sign(t.out), 0, 0));
      arrow.setLength(0.05 + 0.15 * Math.min(Math.abs(t.out), 255) / 255, 0.03, 0.02);
    }

    r.trailClock += frameDt;
    if (r.trailClock >= TRAIL_SAMPLE_S) { r.trailClock = 0; pushTrail(r.x); }

    // Camera follows the robot along x while keeping the user's orbit.
    const dx = r.x - r.followX;
    if (dx !== 0) {
      camera.position.x += dx;
      if (controls) { controls.target.x += dx; controls.update(); }
      r.followX = r.x;
    }

    const bin = Math.round(r.x / 0.5);
    if (bin !== centerBin) setCenterBin(bin);
  });

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[1, 2, 1.5]} intensity={1.3} />
      <Grid
        position={[0, 0, 0]} args={[10, 10]} infiniteGrid followCamera
        cellSize={0.1} sectionSize={0.5} cellThickness={0.6} sectionThickness={1.1}
        cellColor={colors.cell} sectionColor={colors.section} fadeDistance={6} fadeStrength={1}
      />
      <primitive object={trail.line} />
      <primitive object={arrow} />
      <group ref={root}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <circleGeometry args={[0.09, 32]} />
          <meshBasicMaterial color="#000000" transparent opacity={0.22} />
        </mesh>
        <RobotModel bodyRef={body} wheelRefs={wheels} />
      </group>
      <DistanceLabels centerBin={centerBin} />
      <OrbitControls makeDefault target={[0, LOOK_HEIGHT, 0]} minDistance={0.25} maxDistance={4} />
    </>
  );
}

function describe(): string {
  const s = useDashboard.getState();
  const angle = s.telemetry?.angle ?? 0;
  const x = s.pos.x - s.displayOrigin;
  const state = s.telemetry?.state === 1 ? 'balancing' : s.telemetry?.state === 2 ? 'fallen' : 'stopped';
  return `Robot tilted ${angle.toFixed(1)} degrees, position ${x >= 0 ? '+' : ''}${x.toFixed(2)} m${s.pos.estimated ? ' (estimated)' : ''}, ${state}`;
}

export default function Robot3D({ height }: { height: number | string }) {
  const resetRef = useRef<(() => void) | null>(null);
  const [label, setLabel] = useState(describe);
  useEffect(() => {
    const id = window.setInterval(() => setLabel(describe()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="robot3d" style={{ height }} role="img" aria-label={label}>
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [CAM_OFFSET.x, CAM_OFFSET.y, CAM_OFFSET.z], fov: 40, near: 0.01, far: 50 }}
        gl={{ antialias: true, alpha: true }}
      >
        <Scene resetRef={resetRef} />
      </Canvas>
      <button className="robot3d-reset" onClick={() => resetRef.current?.()}>Reset view</button>
    </div>
  );
}
