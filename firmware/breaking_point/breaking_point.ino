/*
 * Breakpoint — ESP32 + Adafruit BME688 firmware
 * ------------------------------------------------------------------
 * Reads temperature / humidity / pressure / gas-resistance over I2C and POSTs
 * them as JSON to the Breakpoint server every few seconds. The server turns
 * these into a sleep estimate and a burnout "breaking-point" prediction.
 *
 * Required libraries (Arduino IDE → Library Manager):
 *   • "Adafruit BME680"            (also drives the BME688)
 *   • "Adafruit Unified Sensor"
 * Board: "ESP32 Dev Module"        (Boards Manager → "esp32" by Espressif)
 *
 * Setup: copy config.example.h → config.h and fill in your WiFi + server URL.
 */
#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include "Adafruit_BME680.h"
#include "config.h"

Adafruit_BME680 bme;  // I2C

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("WiFi: connecting to ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi: connected, IP ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi: connect failed — will retry.");
  }
}

bool initSensor() {
  // Adafruit breakout defaults to 0x77; some clones use 0x76.
  if (!bme.begin(0x77) && !bme.begin(0x76)) return false;
  bme.setTemperatureOversampling(BME680_OS_8X);
  bme.setHumidityOversampling(BME680_OS_2X);
  bme.setPressureOversampling(BME680_OS_4X);
  bme.setIIRFilterSize(BME680_FILTER_SIZE_3);
  bme.setGasHeater(320, 150);  // 320 °C for 150 ms — needed for the gas reading
  return true;
}

void postReading(float t, float h, float p, float g) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");

  // Note: we intentionally do NOT send "effort" — that's set by the user in the
  // web UI, and the server keeps whatever the dashboard last chose.
  char body[256];
  snprintf(body, sizeof(body),
           "{\"device\":\"%s\",\"temperature\":%.2f,\"humidity\":%.2f,"
           "\"pressure\":%.2f,\"gas_resistance\":%.0f}",
           DEVICE_ID, t, h, p, g);

  int code = http.POST((uint8_t *)body, strlen(body));
  Serial.printf("POST -> HTTP %d  %s\n", code, body);
  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Wire.begin(I2C_SDA, I2C_SCL);
  if (initSensor()) {
    Serial.println("BME688 ready.");
  } else {
    Serial.println("BME688 NOT found — check wiring and I2C address (0x76/0x77).");
  }
  connectWiFi();
}

void loop() {
  connectWiFi();  // returns immediately if already connected

  if (bme.performReading()) {
    float t = bme.temperature;        // °C
    float h = bme.humidity;           // %RH
    float p = bme.pressure / 100.0f;  // Pa → hPa
    float g = bme.gas_resistance;     // Ohms (higher = cleaner air)
    Serial.printf("T=%.1f°C  H=%.1f%%  P=%.1fhPa  Gas=%.0fΩ\n", t, h, p, g);
    postReading(t, h, p, g);
  } else {
    Serial.println("BME688 read failed — re-initialising.");
    initSensor();
  }

  delay(POST_INTERVAL_MS);
}
