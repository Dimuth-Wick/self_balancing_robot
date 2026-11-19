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

`D,ms,angle,gyro,sp,pT,iT,dT,out,pwmL,pwmR,kp,ki,kd,vbat,state`

Commands: `KP=`, `KI=`, `KD=`, `SP=`, `RUN=1`, `RUN=0`, `ZERO`, `RATE=25`, `GET`. Console lines use `I,`, `A,`, and `E,` prefixes.

## Tests and build

```powershell
npm test
npm run build
```
