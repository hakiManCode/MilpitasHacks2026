import fs from 'node:fs';
import path from 'node:path';

// In-memory ring buffer of sensor readings + a tiny JSON persistence layer so
// accumulated strain survives a server restart. Swap for SQLite later if needed.
export class Store {
  constructor({ dataDir, maxPoints = 5000 } = {}) {
    this.maxPoints = maxPoints;
    this.readings = [];
    this.dataDir = dataDir;
    this.stateFile = dataDir ? path.join(dataDir, 'state.json') : null;
    this._saveTimer = null;
    if (dataDir && !fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  addReading(r) {
    this.readings.push(r);
    if (this.readings.length > this.maxPoints) {
      this.readings.splice(0, this.readings.length - this.maxPoints);
    }
  }

  latest() {
    return this.readings.length ? this.readings[this.readings.length - 1] : null;
  }

  // Drop short-term history (e.g. when switching between sim and real hardware,
  // whose clocks differ). Persisted strain is unaffected.
  clear() {
    this.readings = [];
  }

  // Downsampled recent series for chart backfill: { ts, fields... } sampled to ~maxOut points.
  series(minutes = 180, maxOut = 240) {
    if (!this.readings.length) return [];
    const cutoff = this.readings[this.readings.length - 1].ts - minutes * 60 * 1000;
    const slice = this.readings.filter((r) => r.ts >= cutoff);
    if (slice.length <= maxOut) return slice;
    const step = slice.length / maxOut;
    const out = [];
    for (let i = 0; i < maxOut; i++) out.push(slice[Math.floor(i * step)]);
    out.push(slice[slice.length - 1]);
    return out;
  }

  // Persisted model blob (strain etc.). Returns {} if nothing saved yet.
  loadPersisted() {
    if (!this.stateFile || !fs.existsSync(this.stateFile)) return {};
    try {
      return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
    } catch {
      return {};
    }
  }

  // Debounced write — model state changes every reading, but disk needn't.
  savePersisted(blob) {
    if (!this.stateFile) return;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      try {
        fs.writeFileSync(this.stateFile, JSON.stringify(blob));
      } catch {
        /* best-effort persistence */
      }
    }, 4000);
  }
}
