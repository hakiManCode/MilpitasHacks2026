#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// Copy this file to "config.h" (same folder) and fill in your details.
// config.h is git-ignored so your WiFi password never gets committed.
// ─────────────────────────────────────────────────────────────────────────────

#define WIFI_SSID   "your-wifi-name"
#define WIFI_PASS   "your-wifi-password"

// URL of the machine running `npm start`, reachable from the ESP32 on the same
// network. Find the host's LAN IP with `ip addr` (Linux) / `ipconfig` (Windows).
#define SERVER_URL  "http://192.168.1.100:3000/api/ingest"

#define DEVICE_ID   "esp32-bme688-01"

// I2C pins — ESP32 defaults. Adafruit STEMMA QT / breakout wiring:
//   BME688 SDA → GPIO 21,  SCL → GPIO 22,  VIN → 3V3,  GND → GND
#define I2C_SDA 21
#define I2C_SCL 22

// How often to read the sensor and POST to the server (milliseconds).
#define POST_INTERVAL_MS 4000
