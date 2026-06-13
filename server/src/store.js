import fs from 'node:fs';
import path from 'node:path';
// Optional Firestore persistence (lazy-loaded when USE_FIRESTORE=true)

// In-memory ring buffer of sensor readings + a tiny JSON persistence layer so
// accumulated strain survives a server restart. Swap for SQLite later if needed.
export class Store {
  constructor({ dataDir, maxPoints = 5000 } = {}) {
    this.maxPoints = maxPoints;
    this.readings = [];
    this.dataDir = dataDir;
    this.stateFile = dataDir ? path.join(dataDir, 'state.json') : null;
    this._saveTimer = null;
    this._useFirestore = process.env.USE_FIRESTORE === 'true';
    this._fireInit = null;
    this._fireRef = null;
    if (this._useFirestore) {
      // lazy init Firestore in background; failures silently disable it
      this._fireInit = (async () => {
        try {
          const adminMod = await import('firebase-admin');
          const admin = adminMod.default ?? adminMod;
          if (!admin.apps || !admin.apps.length) {
            if (process.env.FIREBASE_ADMIN_SA) {
              const sa = JSON.parse(process.env.FIREBASE_ADMIN_SA);
              admin.initializeApp({ credential: admin.credential.cert(sa) });
            } else {
              admin.initializeApp();
            }
          }
          this._firestore = admin.firestore();
          const docPath = process.env.FIRESTORE_DOC_PATH || 'restcue/model_state';
          const parts = docPath.split('/');
          // ensure doc path like collection/doc
          this._fireRef = this._firestore.doc(parts.join('/'));
        } catch (e) {
          this._useFirestore = false;
        }
      })();
    }
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
    // Keep synchronous file-backed load for startup reliability. If Firestore
    // is enabled we still try a background pull but do not block server init.
    if (!this.stateFile || !fs.existsSync(this.stateFile)) {
      // background Firestore pull (non-blocking)
      if (this._useFirestore && this._fireInit) {
        this._fireInit.then(async () => {
          try {
            const snap = await this._fireRef.get();
            if (snap.exists) {
              const data = snap.data();
              try { fs.writeFileSync(this.stateFile, JSON.stringify(data)); } catch {}
            }
          } catch {}
        }).catch(() => {});
      }
      return {};
    }
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
    this._saveTimer = setTimeout(async () => {
      this._saveTimer = null;
      try {
        fs.writeFileSync(this.stateFile, JSON.stringify(blob));
      } catch { /* best-effort persistence */ }
      // also push to Firestore when configured (best-effort, async)
      if (this._useFirestore && this._fireInit) {
        try {
          await this._fireInit;
          if (this._fireRef) await this._fireRef.set(blob, { merge: true });
        } catch {
          /* ignore Firestore write errors */
        }
      }
    }, 4000);
  }
}
