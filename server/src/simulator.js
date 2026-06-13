import { hourOfDay } from './util.js';

// Generates realistic BME688-style readings on a compressed day/night clock so
// the whole dashboard (and the breaking-point dynamics) come alive with no
// hardware attached. When real ESP32 data arrives, the server yields to it.
export class Simulator {
  constructor({ speed = 120, tickMs = 2000, onReading } = {}) {
    this.speed = speed; // simulated seconds per real second
    this.tickMs = tickMs; // real ms between generated readings
    this.onReading = onReading;
    this.simClock = Date.now(); // start "now" so the time-of-day matches reality
    this.timer = null;
    this.phase = Math.random() * 1000; // de-sync the noise waves
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  get running() {
    return this.timer != null;
  }

  // 0..1, peaks deep at night (~3am), ~0 mid-afternoon — drives the env cycle.
  nightFactor(ts) {
    const hour = hourOfDay(ts);
    let dist = Math.abs(hour - 3);
    dist = Math.min(dist, 24 - dist);
    return Math.exp(-(dist * dist) / (2 * 4 * 4));
  }

  tick() {
    this.simClock += this.tickMs * this.speed;
    const ts = this.simClock;
    const night = this.nightFactor(ts);
    const t = ts / 3.6e6 + this.phase;

    // Indoor environment: cooler/quieter at night, humidity & VOCs build up in a
    // closed bedroom, with gentle weather drift and sensor noise on top.
    const wobble = (f, a) => Math.sin(t * f) * a;

    const temperature = 21 - 3 * night + wobble(2.1, 0.25) + noise(0.08);
    const humidity = 45 + 12 * night + wobble(1.7, 1.2) + noise(0.4);
    const pressure = 1013 + wobble(0.05, 6) + wobble(0.3, 1.2) + noise(0.15);
    // Gas resistance: high (clean) by day, falls steeply in a closed room at night.
    const gas = Math.max(
      4000,
      185000 - 150000 * night + wobble(0.9, 6000) + noise(2500),
    );

    this.onReading?.({
      ts,
      temperature: round(temperature, 2),
      humidity: round(humidity, 2),
      pressure: round(pressure, 2),
      gas: Math.round(gas),
    });
  }
}

// Cheap pseudo-Gaussian noise (sum of uniforms).
function noise(scale) {
  return ((Math.random() + Math.random() + Math.random()) / 3 - 0.5) * 2 * scale;
}
const round = (x, d) => {
  const m = 10 ** d;
  return Math.round(x * m) / m;
};
