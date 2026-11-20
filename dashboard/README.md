# Self-Balancing Robot Live Dashboard

Vite, React, and strict TypeScript dashboard for an Arduino Uno / MPU6050 / HC-05 balancing robot.

## Run

```powershell
npm install
npm run dev
```

Open the local URL. The built-in inverted-pendulum simulator starts automatically, so no robot or hardware is required.

## HC-05 serial connection

The HC-05 is Bluetooth Classic Serial Port Profile, not BLE. Pair it in Windows Bluetooth settings using PIN `1234` or `0000`. It will appear as a COM port.

Use Chrome or Edge on a desktop, served through localhost or HTTPS. Select **Connect**, choose the paired COM port, and select the baud. Default is `38400`; the firmware reference in `../Claude outputs/plan.md` explains changing the HC-05 with `AT+UART=38400,0,0`.

## Protocol

Robot telemetry is newline-terminated ASCII:

`D,ms,angle,gyro,sp,pT,iT,dT,out,pwmL,pwmR,kp,ki,kd,vbat,state[,x]`

The trailing `x` (floor position in metres) is optional. The current firmware does not send it and keeps working; the simulator always sends it, and a future firmware with wheel encoders can too. Any other field count is counted as a bad packet.

Commands: `KP=`, `KI=`, `KD=`, `SP=`, `RUN=1`, `RUN=0`, `ZERO`, `RATE=25`, `GET`. Console lines use `I,`, `A,`, and `E,` prefixes.

## 3D robot view

The **Live robot** panel shows the robot in 3D on a floor grid (fine lines every 0.1 m, bold lines and labels every 0.5 m).

- Drag to orbit, scroll to zoom, **Reset view** to return to the side-on camera. The camera follows the robot along the floor.
- **⌖ Recenter** sets the current spot as 0 m. **⤢** opens a full-screen view; `Esc` closes it.
- Wheels turn with the distance travelled, the green arrow shows the motor push (longer = more PWM), and the faint line on the floor is the last ~10 s of travel.
- With a real robot the position is **estimated from motor PWM** and marked `est.`: the shape of the motion is right, the distance in metres is approximate.
- Without WebGL the panel falls back to the flat 2D drawing.

## Simulator physics

The simulator is a cart with an inverted pendulum on top, run at 200 Hz with the same angle-only PID as the firmware: motor PWM accelerates the wheels, which tips the body back. It includes motor lag and a 1.0 m/s top speed. Simulator gains are kept separately from the real robot's (defaults Kp 20, Ki 0, Kd 0.8). Connecting to the robot never pushes simulator gains; the dashboard asks the robot with `GET` and adopts what it reports.

**Mounting offset** (simulator only) pretends the sensor is mounted crooked. Try 0.5°:

- The robot doesn't drift at a steady speed. It **runs away**, speeding up until the motors hit top speed, then falls (about 11 s).
- **Ki does not fix this.** It makes the run-away faster.
- **Zero angle** (or nudging the setpoint onto the true balance angle) does. In the simulator, Zero acts as if you held the robot upright and pressed it.
- Stopping a robot from wandering entirely needs a second, outer speed/position loop, which the firmware doesn't have yet. Your real robot will show the same run-away if its zero is off, so set the zero carefully.

`RUN=0` cuts the motors: the simulated robot tips over and lies on the floor until `RUN=1` stands it back up. That isn't counted as a fall.

## Tests and build

```powershell
npm test
npm run build
```
