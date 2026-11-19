# plan.md — Self-Balancing Robot Live Dashboard

> Hand this file to the coding agent. Build everything described here, milestone by milestone, and test each milestone before moving on.

## 1. Goal

A **single-page, interactive web dashboard** that shows what a self-balancing robot is doing in real time, using the data it sends over a Bluetooth (HC-05) serial link. It must also let the user **tune the PID live** and **replay/export runs**.

The owner is learning control systems through this project. So the dashboard must **teach as it goes**: short tooltips, a tuning coach, and a built-in simulator where PID changes visibly change behaviour. Do not assume prior knowledge, and do not ask the user to explain basics. Put the explanation inside the UI.

## 2. Hardware context (fixed facts)

| Item | Detail |
|---|---|
| Controller | Arduino Uno |
| Sensor | MPU6050 (tilt angle + gyro) |
| Motor driver | L298N, 2 TT motors |
| Radio | **HC-05 = Bluetooth Classic (SPP)**, not BLE |
| Link | 5V Arduino TX → divider → HC-05 RXD; SoftwareSerial on D10 (RX) / D11 (TX) |

**Consequence:** Web Bluetooth (BLE only) will NOT work. After the user pairs the HC-05 in the OS (PIN `1234` or `0000`), it appears as a virtual **COM / serial port**. Use the **Web Serial API** (Chrome / Edge, desktop, served from `localhost` or HTTPS). Show a clear "Unsupported browser" banner otherwise.

## 3. Tech stack

- Vite + React + TypeScript (strict)
- State: Zustand
- Charts: **uPlot** (handles 25–50 Hz streaming smoothly; Chart.js is too slow here)
- Styling: Tailwind CSS, dark theme by default plus a light toggle
- No backend. Everything runs in the browser. Persist settings/presets in `localStorage` (wrapped in try/catch).
- Project folder: `dashboard/`. Provide `npm run dev` and `npm run build`.

## 4. Data protocol (the contract)

Plain ASCII lines ending in `\n`. Default **38400 baud** (the HC-05 default of 9600 only fits ~12 lines/s; see §10 for AT setup). The telemetry rate is configurable (default 25 Hz).

### 4.1 Robot → Dashboard (telemetry)

```
D,ms,angle,gyro,sp,pT,iT,dT,out,pwmL,pwmR,kp,ki,kd,vbat,state
```

| Field | Unit | Meaning |
|---|---|---|
| ms | ms | Robot `millis()` timestamp |
| angle | deg | Filtered tilt angle (0 = upright) |
| gyro | deg/s | Angular velocity |
| sp | deg | Setpoint angle |
| pT / iT / dT | – | Proportional / Integral / Derivative contribution to output |
| out | -255..255 | Total PID output |
| pwmL / pwmR | -255..255 | Motor commands (sign = direction) |
| kp / ki / kd | – | Gains currently active on the robot |
| vbat | V | Battery voltage (0 if not measured) |
| state | 0/1/2 | 0 = stopped, 1 = balancing, 2 = fallen |

Example: `D,15230,-1.82,12.4,0.00,-18.2,-0.6,-7.4,-26.2,-26,-26,10.0,0.5,0.8,11.7,1`

Other line types (show them in the console panel, never crash on them):
- `I,<text>` — boot/info message (firmware version)
- `A,<text>` — acknowledgement of a command (e.g. `A,KP=12.5`)
- `E,<text>` — error/warning from the robot

### 4.2 Dashboard → Robot (commands)

| Command | Effect |
|---|---|
| `KP=12.5` `KI=0.8` `KD=0.6` | Set a gain |
| `SP=-1.2` | Set setpoint angle (deg) |
| `RUN=1` / `RUN=0` | Enable / disable motors (**RUN=0 is the emergency stop**) |
| `ZERO` | Save the current angle as the new upright offset |
| `RATE=25` | Telemetry rate in Hz |
| `GET` | Robot replies with all current gains |

### 4.3 Parser rules (must be robust)

- Buffer partial chunks; split on `\n`; trim `\r`.
- Ignore malformed or short lines (count them in a "bad packets" stat). Never throw.
- Unknown prefixes go to the console log.
- Compute the packet rate (Hz), last-packet age, and mark the link **stale** if there is no data for 1.5 s.

## 5. Features

### 5.1 Connection bar (top)
- **Connect / Disconnect** (Web Serial), baud selector (9600 / 38400 / 115200), status dot (grey / green / amber for stale / red for error).
- **Simulator toggle**: replaces the serial link with generated data (see §6). Must be the default when no robot is connected, so the UI is never empty.
- Live stats: packets/s, bad packets, link latency, last-packet age.
- Auto-reconnect to the previously granted port when possible.

### 5.2 Live robot view (hero panel)
- An SVG robot (body + two wheels) that **tilts with the live angle**, rolls its wheels with the PWM sign and speed, and shows an arrow for drive direction.
- Colour zones on a half-circle gauge: green |angle| < 3°, amber < 15°, red beyond.
- Big readouts: angle, gyro rate, state badge (STOPPED / BALANCING / FALLEN).

### 5.3 Live charts (uPlot, synced cursor)
1. **Angle vs setpoint** (the main one)
2. **Gyro rate**
3. **PID output split into P / I / D terms** (stacked or overlaid)
4. **Motor PWM L/R**
5. **Battery voltage** (small)

Controls: time window (5 / 10 / 30 / 60 s), **pause / resume**, hover cursor synced across charts, click-drag zoom, double-click to reset, toggle series on and off. Event markers (falls, parameter changes) drawn as vertical lines.
Use a typed-array ring buffer (≥ 60 000 samples) and redraw at ≤ 30 fps with `requestAnimationFrame`.

### 5.4 PID tuner (interactive)
- Sliders **plus** numeric inputs for Kp, Ki, Kd, and setpoint, with configurable min / max / step.
- **Live-apply** (debounced 150 ms) or a manual "Send" mode (toggle).
- Show **robot-confirmed values** (from telemetry `kp/ki/kd`) next to the requested values. Highlight mismatch in amber so the user knows whether the robot really applied them.
- **Presets**: save / load / delete named sets, "Revert to last good" (the last values that ran > 10 s without a fall).
- **Emergency STOP** button, large and red, always visible, also bound to the `Space` key.
- **Start / Stop** motors, and a **Zero angle** button.

### 5.5 Tuning coach (teaching feature)
A side panel with:
- The manual tuning recipe as a checklist: *set Ki = Kd = 0 → raise Kp until it just oscillates → add Kd to damp → add a tiny Ki to remove drift*.
- **Rule-based live hints** computed from the last ~5 s of data (zero-crossing count, amplitude, mean error, fall frequency). Examples:
  - fast, growing oscillation → "Kp too high, or Kd too low"
  - slow wobble about zero → "try more Kd"
  - angle sits off-centre → "small Ki or recheck the zero offset"
  - falls within 1 s → "Kp too low (can't catch the fall) or the motors are saturated"
- Show the detected oscillation **frequency and amplitude**.
- **Tooltips (ⓘ)** on every metric and gain, written in plain language, with one "what happens if too high / too low" line each.

### 5.6 Session statistics
Time balanced since last fall, best balance time, fall count, max |angle|, RMS angle error (last 10 s), average loop/packet rate, motor saturation % (how often |out| ≥ 255).

### 5.7 Event log + console
- Timestamped log: connect / disconnect, falls, parameter changes (with old → new), warnings, robot `I/A/E` lines.
- Raw console tab with the last 500 lines, a copy button, and a command input box to send manual commands.

### 5.8 Record, export, replay
- **Record** button, plus auto-record the last 10 minutes in memory.
- Export **CSV** (all fields plus a PC timestamp) and **JSON** (including the event log and parameter changes).
- **Import & replay** a saved file with play / pause / speed (0.5x–4x) and a scrub bar, using the same charts and robot view.

### 5.9 UX polish
- Responsive: usable on a laptop and on a tablet.
- Keyboard shortcuts: `Space` stop, `R` record, `P` pause, `?` help overlay.
- Toasts for success / errors, empty states with guidance, skeletons while connecting.
- Accessible: contrast-checked colours, labelled controls, never colour-only meaning (use icons and text with the zone colours).
- Remember layout, window size, theme, and last baud.

## 6. Built-in simulator (important, do this early)

So the dashboard can be built, tested, and **used for learning without the robot**:
- Simulate a simplified **inverted pendulum**: `θ'' = a·sin(θ) − b·u` with small noise, controlled by the **same PID formula** as the firmware, using Kp/Ki/Kd/setpoint from the tuner.
- Emit the exact §4.1 telemetry format at the chosen rate through the same parser (so the parser is tested for real).
- Moving the sliders must visibly change behaviour: oscillation, drift, falling.
- Fall = |θ| > 45° → state 2, wait 2 s, auto-reset to a small random tilt.
- Respond to `RUN`, `ZERO`, `SP`, `RATE`, `GET` commands like the real robot (send `A,` acks).
- A "Disturbance" button that gives the simulated robot a push (teaches how PID recovers).

## 7. Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ ● Connected  38400  [Connect] [Simulator ◉]   25 pkt/s   [REC]   │
├───────────────────────┬──────────────────────────────────────────┤
│   ROBOT VIEW          │  Angle vs setpoint        [5s 10s 30s ⏸] │
│   (tilting SVG +      ├──────────────────────────────────────────┤
│    gauge)             │  Gyro                                    │
│   angle  -1.8°        ├──────────────────────────────────────────┤
│   BALANCING           │  P / I / D terms                         │
│   ⏱ 00:42  falls 2    ├──────────────────────────────────────────┤
├───────────────────────┤  Motor PWM L/R                           │
│ PID TUNER             │                                          │
│ Kp ──●─── 10.0        ├──────────────────────────────────────────┤
│ Ki ─●──── 0.50        │  [Event log] [Console] [Coach tips]      │
│ Kd ───●── 0.80        │                                          │
│ SP ──●─── 0.0°        │                                          │
│ [Presets] [Zero]      │                                          │
│ [▶ RUN]  [■ STOP]     │                                          │
└───────────────────────┴──────────────────────────────────────────┘
```

## 8. Code structure (suggested)

```
dashboard/
  src/
    lib/
      protocol.ts      # parse telemetry lines, build commands, types
      serial.ts        # Web Serial wrapper (connect, read loop, write, reconnect)
      simulator.ts     # inverted-pendulum + PID, emits protocol lines
      ringbuffer.ts    # typed-array ring buffer
      metrics.ts       # RMS, oscillation detection, coach rules
      export.ts        # CSV / JSON export + import
    store/             # zustand stores (link, telemetry, tuner, events)
    components/        # ConnectionBar, RobotView, Charts, Tuner, Coach, Log, Console
    App.tsx
  tests/               # vitest unit tests for protocol, metrics, ringbuffer
```

A `DataSource` interface (`connect()`, `onLine()`, `send()`, `close()`) is implemented by both `serial.ts` and `simulator.ts`, so the rest of the app doesn't know which is active.

## 9. Milestones (test each before continuing)

| # | Deliver | How to verify |
|---|---|---|
| M0 | Project scaffold, theme, layout skeleton | `npm run dev` shows the layout |
| M1 | `protocol.ts` + unit tests | Tests: valid line, partial chunks, garbage, missing fields, `I/A/E` lines |
| M2 | Simulator + ring buffer + live numbers | Numbers move; sliders change behaviour in the data |
| M3 | Charts (all five, window, pause, sync cursor) | Smooth at 50 Hz, no memory growth over 10 min |
| M4 | Robot SVG + gauge + stats + falls | Falls are counted; the SVG tilts correctly |
| M5 | Tuner: live-apply, confirmation, presets, STOP | Sim reacts; the mismatch highlight works |
| M6 | Web Serial connection + reconnect + stale detection | Test with a serial loopback or the Arduino sketch in §10 |
| M7 | Coach hints + tooltips | Hints change appropriately for P-too-high / D-too-low sim cases |
| M8 | Record, export, import, replay | Round-trip CSV → import → identical charts |
| M9 | Polish: shortcuts, responsive, accessibility, empty states | Lighthouse a11y ≥ 90 |

Do not mark a milestone done without running it (tests and a visual check in the browser).

## 10. Robot-side firmware (reference, for the owner to add)

The dashboard needs the robot to speak §4. Minimal additions to the Arduino sketch:

```cpp
#include <SoftwareSerial.h>
SoftwareSerial bt(10, 11);              // RX, TX (HC-05)
float Kp=10, Ki=0.5, Kd=0.8, sp=0;
bool run=false;
unsigned long lastTx=0, period=40;      // 25 Hz

void sendTelemetry(float angle,float gyro,float pT,float iT,float dT,
                   float out,int pwmL,int pwmR,float vbat,int state){
  if (millis()-lastTx < period) return;
  lastTx = millis();
  bt.print("D,"); bt.print(millis());      bt.print(',');
  bt.print(angle,2); bt.print(',');        bt.print(gyro,1);  bt.print(',');
  bt.print(sp,2);    bt.print(',');
  bt.print(pT,1);    bt.print(',');        bt.print(iT,1);    bt.print(',');
  bt.print(dT,1);    bt.print(',');        bt.print(out,1);   bt.print(',');
  bt.print(pwmL);    bt.print(',');        bt.print(pwmR);    bt.print(',');
  bt.print(Kp,2);    bt.print(',');        bt.print(Ki,2);    bt.print(',');
  bt.print(Kd,2);    bt.print(',');        bt.print(vbat,1);  bt.print(',');
  bt.println(state);
}

void handleCommands(){                  // call every loop
  static char buf[24]; static byte n=0;
  while (bt.available()){
    char c = bt.read();
    if (c=='\n'){ buf[n]=0; n=0;
      if      (!strncmp(buf,"KP=",3)) Kp=atof(buf+3);
      else if (!strncmp(buf,"KI=",3)) Ki=atof(buf+3);
      else if (!strncmp(buf,"KD=",3)) Kd=atof(buf+3);
      else if (!strncmp(buf,"SP=",3)) sp=atof(buf+3);
      else if (!strncmp(buf,"RUN=",4)) run=(buf[4]=='1');
      else if (!strncmp(buf,"RATE=",5)) period=1000UL/max(1,atoi(buf+5));
      bt.print("A,"); bt.println(buf);
    } else if (n<sizeof(buf)-1) buf[n++]=c;
  }
}
```

Notes for the owner:
- Keep **motor control above telemetry priority**: the balance loop must run at a fixed rate (~200 Hz); telemetry is sent only when the time slice allows.
- SoftwareSerial is reliable up to about 38400 baud on an Uno. To change the HC-05 baud: enter AT mode (hold the button while powering on) and send `AT+UART=38400,0,0`.
- `bt.print` blocks while sending; at 25 Hz × ~80 bytes this is fine at 38400.

## 11. Definition of done

- Works with the simulator out of the box (`npm run dev`, no hardware).
- Connects to a real HC-05 on Chrome/Edge desktop and shows live data from a robot.
- All §5 features present; parser never crashes on bad input.
- Sustains 50 Hz telemetry for 10 min with no visible lag or memory growth.
- Unit tests pass (`npm test`); the production build succeeds (`npm run build`).
- README with: how to pair the HC-05, how to connect, the protocol table, how to use the simulator.

## 12. Stretch ideas (only after everything above works)

- Auto-tune suggestions based on step-response analysis.
- Compare two recorded runs on one chart.
- Joystick / arrow-key remote drive (`DRV=<fwd>,<turn>` command).
- Installable PWA.
