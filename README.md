# Breakpoint

> **100% effort, 100% of the time, breaks.** Breakpoint tells you *when*.

An anxiety / burnout companion built on an **ESP32-WROOM-32D** + **Adafruit BME688**.
The sensor watches your environment (temperature, humidity, pressure, air quality);
the app uses it to **detect when you're sleeping or about to sleep**, models the
**strain** you accumulate from effort and a hostile environment, and **predicts your
breaking point** before you hit it.

*By Agam, Anish, Sehej, Shubham · MilpitasHacks 2026 · Open Source.*

---

## How it works

```
ESP32 + BME688  ──HTTP POST JSON──▶  Node/Express server  ──Server-Sent Events──▶  Dashboard
 (firmware/)         every 4 s        • ingest + storage          (web browser)
                                      • sleep detection           • live strain gauge
                                      • strain → breaking point   • sleep state
                                      • built-in demo simulator   • breaking-point ETA
```

- **Strain** rises with your *effort* (set in the UI) and is multiplied by a hostile
  environment (too hot/cold, humid, stuffy air). **Sleep recovers it.** The
  **breaking point** is the projection of your daily net strain to 100%.
- **Sleep detection** combines time-of-day, rising humidity, worsening air (a closed
  room fills with CO₂/VOCs → the BME688's gas resistance drops), cool/stable
  temperature, and low variance → `Awake → Winding down → Asleep`.
- The whole model lives in [`server/src/model.js`](server/src/model.js) and every
  constant is named and tunable — nothing is a black box.

---

## Hardware & wiring (I2C)

| BME688 pin | ESP32-WROOM-32D pin |
|------------|---------------------|
| VIN / 3Vo  | **3V3**             |
| GND        | **GND**             |
| SDA (SDI)  | **GPIO 21**         |
| SCL (SCK)  | **GPIO 22**         |

---

## Quick start

### 1. Run the server (works with **no hardware** — starts in demo mode)

```bash
cd server
npm install
npm start
```

Open **http://localhost:3000**. It boots in **DEMO** mode with a built-in simulator
(a full day/night cycle every ~5 minutes), so the dashboard is fully alive before any
hardware is connected. When real sensor data arrives, it automatically switches to **LIVE**.

### 2. Flash the ESP32 (Arduino IDE)

1. **Boards:** `File → Preferences → Additional boards manager URLs` →
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`, then
   `Tools → Board → Boards Manager` → install **esp32 by Espressif**.
2. **Libraries** (`Tools → Manage Libraries`): install **Adafruit BME680** and accept
   its dependencies (**Adafruit Unified Sensor**, **Adafruit BusIO**).
3. **Config:** copy `firmware/breaking_point/config.example.h` → `config.h` (same
   folder) and set `WIFI_SSID`, `WIFI_PASS`, and `SERVER_URL` to the machine running
   the server, e.g. `http://192.168.1.100:3000/api/ingest` (find its LAN IP with
   `hostname -I`). `config.h` is git-ignored so your WiFi password is never committed.
4. **Open** `firmware/breaking_point/breaking_point.ino`, select board
   **"ESP32 Dev Module"** and the right serial port, then **Upload** (hold `BOOT` if it
   stalls at *Connecting…*).
5. Open the **Serial Monitor @ 115200** — you should see `POST -> HTTP 200`, and the
   dashboard badge will flip to **LIVE**.

> The ESP32 and the server's computer must be on the **same network**. Some venue WiFi
> uses client isolation that blocks device-to-device traffic — a phone hotspot fixes it.

---

## Configuration (server env vars)

| Variable    | Default | Meaning                                                        |
|-------------|---------|----------------------------------------------------------------|
| `PORT`      | `3000`  | HTTP port                                                      |
| `SIMULATE`  | `true`  | Built-in demo data generator (set `false` for hardware-only)   |
| `SIM_SPEED` | `300`   | Simulated seconds per real second (`300` ≈ a full day in 5 min)|

```bash
SIMULATE=false npm start          # hardware only, no demo data
SIM_SPEED=2000 npm start          # fast-forward the demo to watch strain build
```

---

## API

| Method & path        | Purpose                                                            |
|----------------------|--------------------------------------------------------------------|
| `POST /api/ingest`   | Sensor reading from the ESP32 (or any client)                      |
| `GET  /api/state`    | Current snapshot (strain, sleep, prediction, drivers)              |
| `GET  /api/stream`   | Server-Sent Events — live state pushed on every reading            |
| `GET  /api/history`  | Recent downsampled readings for chart backfill                     |
| `POST /api/effort`   | Set the user's current effort level (0–100)                        |

**Ingest payload** (effort is set in the UI, not by the device):

```json
{ "device": "esp32-bme688-01", "temperature": 22.4, "humidity": 47.2,
  "pressure": 1013.2, "gas_resistance": 152000 }
```

---

## Project layout

```
firmware/breaking_point/   ESP32 Arduino sketch (BME688 → WiFi → server)
  breaking_point.ino
  config.example.h         copy to config.h and fill in (config.h is git-ignored)
server/
  server.js                Express app: ingest, SSE stream, static hosting
  src/model.js             sleep detection + strain / breaking-point model (tunable)
  src/store.js             in-memory ring buffer + JSON persistence
  src/simulator.js         hardware-free demo data generator
  public/                  dashboard (vanilla JS, custom canvas charts, no CDN)
```

---

## Tuning the model

Open [`server/src/model.js`](server/src/model.js) and edit the `CFG` block at the top —
comfort bands, strain/recovery rates, environment gain, and sleep-detection weights are
all there with plain-English comments.
