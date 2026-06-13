# Breakpoint — ESP32 firmware

Flashing guide for the **ESP32-WROOM-32D + Adafruit BME688**. This is the hardware
half; the server/dashboard setup lives in the [main README](../README.md).

The board reads temperature / humidity / pressure / gas-resistance over I2C and POSTs
them as JSON to the Breakpoint server every few seconds.

---

## 1. Wire the BME688 (I2C)

| BME688 pin | ESP32-WROOM-32D pin |
|------------|---------------------|
| VIN / 3Vo  | **3V3**             |
| GND        | **GND**             |
| SDA (SDI)  | **GPIO 21**         |
| SCL (SCK)  | **GPIO 22**         |

(Pins are configurable in `config.h` via `I2C_SDA` / `I2C_SCL`.)

## 2. Arduino IDE setup (one time)

1. **Board support:** `File → Preferences → Additional boards manager URLs` →
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
   then `Tools → Board → Boards Manager` → install **esp32 by Espressif Systems**.
2. **Libraries** (`Tools → Manage Libraries`): install **Adafruit BME680** (it drives
   the BME688) and accept its dependencies — **Adafruit Unified Sensor** and
   **Adafruit BusIO**.

## 3. Create your `config.h`

The sketch needs a `config.h` next to `breaking_point.ino`. It's **git-ignored**, so it
doesn't ship in the repo — you make your own:

```bash
cd firmware/breaking_point
cp config.example.h config.h
```

Then edit `config.h`:

| Define        | Set to                                                            |
|---------------|-------------------------------------------------------------------|
| `WIFI_SSID`   | your WiFi network name                                            |
| `WIFI_PASS`   | your WiFi password                                                |
| `SERVER_URL`  | `http://<server-LAN-IP>:3000/api/ingest` (run `hostname -I` on the server machine) |

The ESP32 and the computer running the server must be on the **same network**.

## 4. Select board + port

- `Tools → Board → esp32 → "ESP32 Dev Module"`
- `Tools → Port →`
  - **Linux:** `/dev/ttyUSB0` (try `/dev/ttyACM0` if absent)
  - **macOS:** `/dev/cu.SLAB_USBtoUART` or `/dev/cu.usbserial-*`
  - **Windows:** `COM3` / `COM4` …

## 5. Upload + verify

1. Open `breaking_point/breaking_point.ino` and click **Upload (→)**. If it stalls at
   `Connecting........`, **hold the `BOOT` button** until flashing begins.
2. Open **Serial Monitor @ 115200 baud**. Success looks like:
   ```
   BME688 ready.
   WiFi: connected, IP 192.168.x.x
   T=22.4°C  H=47.1%  P=1013.2hPa  Gas=152000Ω
   POST -> HTTP 200 {"device":"esp32-bme688-01",...}
   ```
   The dashboard badge flips from **DEMO** to **LIVE** once readings arrive.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `config.h: No such file` | You skipped step 3 — `cp config.example.h config.h`. |
| `BME688 NOT found` | Check the 4 wires. The sketch already tries both I2C addresses (0x77 / 0x76). |
| `POST -> HTTP -1` / refused | Server not running, wrong `SERVER_URL` IP, firewall on port 3000, or not on the same WiFi. |
| Dashboard stays on **DEMO** | No POSTs are landing — check the Serial Monitor for `HTTP 200`. |
| Upload stuck at *Connecting…* | Hold `BOOT` during upload, or lower Upload Speed to 115200. |
| Linux: port permission denied | Add yourself to the serial group (`uucp` or `dialout`) and re-login. |
| Venue WiFi blocks the POSTs | Some networks isolate clients — put the laptop and ESP32 on a phone hotspot. |
