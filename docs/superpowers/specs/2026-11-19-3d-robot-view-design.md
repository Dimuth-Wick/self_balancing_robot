# 3D Robot View + Cart-Pendulum Simulator — Design

Date: 2026-11-19 · Status: draft, awaiting owner approval
Applies to: `dashboard/` (see `Claude outputs/plan.md` for the overall dashboard spec)

## 1. Intent

Replace the flat SVG "Live robot" panel with a 3D scene so the owner can
(a) see the robot clearly and (b) understand the physics of balancing while
learning control. The key physical idea to make visible: a balancing robot
does not stand still — it catches a fall by **driving its wheels under its
body**. Leaning forward makes it roll forward; a setpoint that doesn't match
the true balance angle makes the robot run away, speed up and fall (see §6.4
"Drift"). The current simulator only models
tilt, so it hides all of this. This change therefore has two halves: a 3D view
and a new simulator physics model with floor position.

## 2. Goals

1. 3D robot (body, MPU6050 board, two wheels, axle) inside the existing
   "Live robot" panel, panel slightly taller (≈ 280–320 px of scene).
2. Floor with grid and distance markings (every 0.1 m, labelled every 0.5 m),
   so drift is visible.
3. Orbit camera: drag to orbit, scroll to zoom. Default view is side-on (looking
   along the axle) so tilt reads clearly. Camera smoothly follows the robot's
   floor position so it never leaves the frame; a "reset view" control
   restores the default.
4. Wheels rotate consistently with floor motion (wheel angle = x / r).
5. Faint trail on the floor showing recent positions (last ~10 s).
6. Push arrow at the wheel base: direction = sign of PWM, length ∝ |PWM|.
7. Fall animation: when state = 2, body tips over to lie on the floor; on
   reset it returns upright.
8. Expand button (⤢) in the panel header opens the scene in a large overlay
   (Esc / ✕ closes it). Same scene, same live data.
9. Existing readouts stay (Angle, Gyro, Falls) and a **Position** readout is
   added (metres, signed). For the real robot it is labelled "est.".
10. Zone colours (green < 3°, amber < 15°, red beyond) are kept — the gauge bar
    stays below the scene.
11. Works identically in simulator mode, live serial mode, and replay mode.

## 3. Non-goals

- Steering / turning / 2D movement on the floor (yaw). Robot moves on one axis.
- Encoder-based position for the real robot (but see §6.2: the protocol leaves
  room for it).
- Changes to the rest of the dashboard (charts, tuner, coach, log) beyond
  what is needed to carry the new `x` field.
- Realistic textures / photoreal rendering.

## 4. Anti-goals (would be a failure even if it "works")

- The 3D view makes the whole dashboard janky: React re-rendering the scene at
  telemetry rate, dropped frames in charts, or an initial page load that is
  noticeably slower for users who never scroll to the panel.
- The simulator "balances" in a way that teaches wrong intuition (e.g. robot
  hovers in place with zero wheel motion, or PID behaviour that doesn't match
  the angle-only firmware PID).
- A robot position shown for the real robot without saying it is estimated.
- A blank panel on machines without WebGL.

## 5. Constraints

- Stack already in place: Vite 8, React 19, TypeScript strict, Zustand, uPlot.
- Must not change the robot → dashboard protocol in a breaking way; the owner's
  firmware (`plan.md` §10) sends the 16-field `D` line.
- PID in the simulator stays **angle-only**, identical in form to the firmware:
  `error = angle − sp; out = Kp·error + Ki·∫error + Kd·d(error)/dt`, clamped
  to ±255, integral clamped. Positive angle = leaning forward (+x); positive
  output drives forward (+x).
- Dark and light themes both supported (scene background/floor follow theme
  tokens).

## 6. The design

### 6.1 Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | 3D model that only tilts in place; wheels spin with PWM | Cheap, no sim change; teaches nothing new about physics. |
| **B (chosen)** | 3D model that drives along a floor; simulator rewritten as cart + inverted pendulum; real-robot position estimated from PWM | ~2× the work, PID defaults need retuning; shows the real physics (drift, catching a fall by driving). |

Owner chose **B** because understanding the physics is a core reason for the
change.

Rendering tech (builder's call already made by the designer, owner did not
object): **Three.js via `@react-three/fiber` v9 (React 19 compatible) +
`@react-three/drei`** (OrbitControls, Grid, Line). Adds ≈ 200 KB gz; the 3D
panel is loaded with `React.lazy` so the rest of the dashboard renders first.

### 6.2 Data: the optional `x` field

- Telemetry gains an **optional 17th field `x`** (metres, floor position):
  `D,ms,angle,gyro,sp,pT,iT,dT,out,pwmL,pwmR,kp,ki,kd,vbat,state[,x]`.
- Parser: accept 16 or 17 fields. With 17, `Telemetry.x` is set; with 16 it is
  `undefined`. Malformed 17th field → whole line is bad (same rule as today).
  The current firmware keeps working unchanged; a future encoder firmware can
  send real `x`.
- The simulator always sends `x` (true simulated position).
- `TelemetryRingRow` gains `x` (true or estimated) and `xEstimated: boolean`
  so charts/export/replay carry it. CSV and JSON export include it; replay
  reads it (older files without `x` → estimate during import, or 0).

### 6.3 Position estimator (real robot, no `x` in telemetry)

`lib/positionEstimator.ts`, pure and unit-tested. Simple first-order
speed model for a TT gear motor: `v' = (vMax·pwmAvg/255 − v)/τm`,
`x += v·dt`, with vMax = 1.0 m/s, τm = 0.1 s, using the sample `ms` deltas
(gaps > 0.5 s are treated as 0.5 s). *(Designer's call: no calibration UI;
the absolute scale may be off and that is acceptable because it is labelled
"est.")* Reset to 0 when: telemetry state goes 0→1 (the
dashboard's proxy for RUN 0→1 — works for live data and replays alike), a
fall ends (state 2 → other), or the user clicks "Recenter". Clamp |x| to a
display range (e.g. ±5 m). UI labels position "est." whenever it comes from
the estimator. Old replay files without `x` are run through the same
estimator on import.

**Recenter** is a small button in the robot panel header next to ⤢. In
estimator mode it resets the estimate; in simulator mode it only shifts the
display origin (the scene and the Position readout show x − origin); the
physics state is not touched.

### 6.4 Simulator physics (rewrite of `lib/simulator.ts`)

Split into a pure `lib/physics.ts` (state + `step(state, u, dt)`) and the
`Simulator` DataSource wrapper (timers, commands, telemetry lines).

Model — cart with inverted pendulum, wheel motor as velocity-damped force:

```
uEff  += (u − uEff)·dt/τ                     // motor/driver lag
a_cart = K·(uEff/255) − B·v                  // motor push minus damping
a_cart = 0 if |v| ≥ vMax and a_cart pushes further   // motor top speed
θ''    = (g/L)·sin θ − (1/L)·cos θ · a_cart  // pendulum on accelerating base
```

State: θ, θ', x, v, uEff. Constants (validated by a prototype run on
2026-11-19 — they meet every §8 physics criterion): **g = 9.81, L = 0.1 m,
K = 20 m/s², B = 0, τ = 0.03 s, vMax = 1.0 m/s, dt = 1/200 s**, process noise
on θ' each step uniform in ±0.15 °/s. **Sim default gains: Kp = 20, Ki = 0,
Kd = 0.8, SP = 0.** Prototype results with these: default gains from 3°
balance 60 s with max |θ| ≈ 0.04° and |x| ≈ 2 m of noise wander; Kd = 0
falls in ≈ 0.6 s; Kp = 60 falls in ≈ 1 s; no control falls in ≈ 0.4 s;
a 60 °/s kick recovers; a 0.5° setpoint error runs away and falls in ≈ 11 s.

Timing fix (existing bug): today the sim integrates `dt = 0.02` per tick while
ticking at the telemetry rate (40 ms at 25 Hz), so it runs at half speed. New
sim runs physics + PID at a fixed **200 Hz** (matching the firmware loop
note in `plan.md`) using sub-steps per timer tick based on real elapsed time,
and emits telemetry at `RATE` Hz.

Falls (while RUN=1): |θ| > 45° → state 2; during the 2 s fallen period θ
continues to 90° (lying on the floor) and x stops; then reset to upright with
a small random tilt, v = 0, x unchanged (robot gets up where it fell).

`RUN=0` *(designer's call)*: motors off (u = 0), physics keeps running so an
un-driven robot topples to 90° and **stays lying** until `RUN=1`, which stands
it back up (small random tilt) and starts balancing. While RUN=0 the sim
reports state 0 the whole time, so this is not counted as a fall and logs no
fall event. `ZERO`, `SP`, `RATE`, `GET`, `Disturbance` behave as today;
Disturbance now applies an impulse to θ'.

**Drift (owner chose option 1 on 2026-11-19).** The prototype showed that
with an angle-only PID a setpoint error does **not** give steady rolling:
the robot accelerates until the motors hit vMax, then falls (≈ 11 s for
0.5°). Ki does not cure it; putting the setpoint on the true balance angle
(`ZERO` while upright, or nudging SP) does. Stopping it entirely needs an
outer speed/position loop, which the firmware doesn't have (future work).
- The sim has a **mounting offset** (IMU reads θ_true + offset), **default
  0°**, so out of the box the robot balances indefinitely.
- A **"Mounting offset" slider** (−3°…+3°, step 0.1°, sim mode only) sits
  next to the Disturbance button so the owner can create a setpoint error on
  purpose and watch the run-away. It calls the simulator directly (not a
  protocol command).
- The coach detects a run-away (§6.8) and says: the setpoint is off from the
  true balance angle — press ZERO while it is upright or nudge SP; Ki won't
  fix this.
- Recipe step "add a tiny Ki to remove drift" becomes "if it runs away in
  one direction, fix SP / ZERO first; only then add a tiny Ki for a steady
  lean from uneven load". Ki and SP tooltips updated to match.

Default gains: the **simulator** gets its own retuned defaults
(*designer's call*, §6.7). Slider ranges are widened if the new defaults
need it.

### 6.5 3D scene (`components/Robot3D.tsx` + `components/RobotPanel.tsx`)

- `RobotPanel` keeps the header (title, state badge, new ⤢ button), gauge bar,
  readouts (Angle, Gyro, Position, Falls). It renders `Robot3D` lazily, with
  the existing SVG `RobotView` as Suspense fallback **and** as the permanent
  fallback when WebGL is unavailable.
- `Robot3D` reads telemetry inside `useFrame` via `useDashboard.getState()` —
  **no React subscription to telemetry** — and interpolates between the last
  two samples so motion is smooth at display frame rate even at 25 Hz data.
- Geometry: simple primitives (box body, cylinder wheels with spokes/tread
  marks so rotation is visible, small green board on the body for the MPU6050,
  antenna/mast like the SVG). Body pivots about the axle.
- Push arrow, trail (ring of last ~250 positions, drawn as a line on the
  floor), floor grid with distance labels, soft shadow under the robot.
- Colours from the existing palette (`#7c93ff` body, `#54e0a1` accents, zone
  colours); scene background/floor read the theme.
- Expand overlay reuses the same `Robot3D` component in a full-viewport
  dialog; only one WebGL canvas is mounted at a time.
- Accessibility: canvas has `role="img"` and an `aria-label` updated at a low
  rate (≈1 Hz) with angle, position and state, as the SVG has today.

### 6.6 Replay

During replay the scene is driven from the replay row (angle, state, x) the
same way as live data. Scrubbing jumps instantly (no interpolation across
jumps; trail is rebuilt from the rows up to the scrub point).

### 6.7 Gains per mode *(designer's call)*

Simulator gains and real-robot gains must never leak into each other.
- The tuner keeps a separate `requested` set per source: `sim` and `robot`,
  both persisted in localStorage (try/catch).
- Switching to the simulator loads the sim set (first run: the retuned sim
  defaults) and sends it to the sim.
- Connecting to the real robot does **not** push anything: the dashboard sends
  `GET`, waits for the first telemetry line, and adopts the robot's reported
  kp/ki/kd/sp as the robot set. Only a user change after that is sent.
- A "Reset to defaults" link in the tuner applies only to the sim set.

### 6.8 Run-away detection

`detectRunaway(xs, dt)` in `lib/metrics.ts` over the last 5 s of `x`: true
when the speed over the last 1 s is > 0.3 m/s **and** at least 1.5× the
speed over the first 1 s of the window, and the sign is consistent. The
coach checks this before its other rules.

## 7. Left to the builder

- Exact physics constants (L, K, B, noise) and retuned default gains,
  subject to §8.
- Mesh details, lighting, camera distances, trail length/styling.
- Whether the scene height is 280 or 320 px.
- File layout within `src/components/` (the plan already calls for a
  components folder; moving other panels out of `App.tsx` is optional and out
  of scope unless needed).

## 8. Acceptance

Unit tests (vitest):
- Parser: 16-field line → `x` undefined; 17-field → `x` set; bad 17th field → bad packet.
- Physics: no control (u = 0) from 2° → falls (|θ| > 45°) within ~1–2 s.
- Physics + default gains: from 3° start with noise, stays |θ| < 3° for 60 s
  simulated time and does not fall.
- Physics + default gains, offset 0.5°, SP = 0: robot runs away (|v|
  reaches ≥ 0.9 m/s) and falls within 30 s; same with Ki = 0.5. With SP =
  0.5° it does not fall in 30 s and |x| < 3 m.
- Coach: a run-away trace triggers the run-away hint; a balanced trace
  does not.
- RUN=0: robot topples to 90° and stays down, state 0, no fall counted;
  RUN=1 stands it up and it balances.
- Connecting serial never sends gains until the user changes one.
- Kd = 0 with default Kp: oscillation amplitude grows or robot falls.
- Disturbance impulse: default gains recover without falling.
- Estimator: constant PWM → velocity approaches K/B·(pwm/255); resets on the
  listed triggers.

Manual (browser):
- Sim mode: robot balances, rolls forward when leaning forward, wheels turn
  consistently with travel, trail shows drift, falls animate and recover.
- Sliders visibly change behaviour (oscillation, drift, falling).
- Orbit/zoom/reset view and expand overlay work; Esc closes overlay.
- No WebGL (e.g. disabled in browser flags) → SVG view appears.
- Charts stay smooth with the 3D panel visible; React profiler shows the
  panel is not re-rendering at telemetry rate.
- `npm test` and `npm run build` pass.
