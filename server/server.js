import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './src/store.js';
import { BurnoutModel } from './src/model.js';
import { Simulator } from './src/simulator.js';
import { clamp, num } from './src/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const SIMULATE = process.env.SIMULATE !== 'false'; // default ON — works with no hardware
const SIM_SPEED = Number(process.env.SIM_SPEED || 300); // simulated secs per real sec (full day ≈ 5 min)
const HARDWARE_GRACE_MS = 15000; // pause the sim while real readings are arriving

const store = new Store({ dataDir: path.join(__dirname, 'data'), maxPoints: 6000 });
const model = new BurnoutModel(store.loadPersisted());

let userEffort = 70;
let lastHardwareAt = 0;

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── live client fan-out (Server-Sent Events) ───────────────────────────────
const clients = new Set();
function broadcast(state) {
  const frame = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) {
    try { res.write(frame); } catch { /* client gone; cleaned up on 'close' */ }
  }
}

// ── ingest path shared by hardware + simulator ──────────────────────────────
function ingest(body, { fromHardware = false } = {}) {
  const reading = {
    ts: num(body.ts) ?? Date.now(),
    temperature: num(body.temperature),
    humidity: num(body.humidity),
    pressure: num(body.pressure),
    gas: num(body.gas) ?? num(body.gas_resistance),
    source: fromHardware ? 'hardware' : 'sim',
  };
  if (body.effort != null) userEffort = clamp(num(body.effort, userEffort), 0, 100);
  if (fromHardware) lastHardwareAt = Date.now();

  // On a source switch the clocks differ (sim runs compressed time) — flush the
  // short-term chart buffer and trend window so the live view restarts cleanly.
  const prev = store.latest();
  if (prev && prev.source !== reading.source) {
    store.clear();
    model.resetClock();
  }

  store.addReading(reading);
  const state = model.update(reading, { effort: userEffort });
  state.simSpeed = SIM_SPEED;
  store.savePersisted(model.serialize());
  broadcast(state);
  return state;
}

// ── API ─────────────────────────────────────────────────────────────────────
app.post('/api/ingest', (req, res) => {
  try {
    const state = ingest(req.body || {}, { fromHardware: true });
    res.json({ ok: true, state });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err) });
  }
});

app.post('/api/effort', (req, res) => {
  userEffort = clamp(num(req.body?.effort, userEffort), 0, 100);
  const latest = store.latest();
  if (latest) broadcast(model.snapshot(latest, { effort: userEffort }));
  res.json({ ok: true, effort: userEffort });
});

app.get('/api/state', (req, res) => {
  const latest = store.latest();
  res.json({
    state: latest ? model.snapshot(latest, { effort: userEffort }) : null,
    effort: userEffort,
    simRunning: sim?.running ?? false,
  });
});

app.get('/api/history', (req, res) => {
  const minutes = clamp(num(req.query.minutes, 180), 5, 1440);
  res.json(store.series(minutes, 240));
});

app.post('/api/sim', (req, res) => {
  const on = req.body?.on;
  if (!sim) return res.status(400).json({ ok: false, error: 'simulator disabled at startup' });
  if (on === false) sim.stop();
  else if (on === true) sim.start();
  res.json({ ok: true, running: sim.running });
});

app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  clients.add(res);

  const latest = store.latest();
  if (latest) res.write(`data: ${JSON.stringify(model.snapshot(latest, { effort: userEffort }))}\n\n`);

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(res);
  });
});

// ── simulator (yields to real hardware) ──────────────────────────────────────
const sim = SIMULATE
  ? new Simulator({
      speed: SIM_SPEED,
      onReading: (r) => {
        if (Date.now() - lastHardwareAt < HARDWARE_GRACE_MS) return; // hardware wins
        ingest(r, { fromHardware: false });
      },
    })
  : null;
if (sim) sim.start();

app.listen(PORT, () => {
  console.log(`\n  Breakpoint server → http://localhost:${PORT}`);
  console.log(`  Simulator: ${sim ? `ON (${SIM_SPEED}× speed)` : 'OFF'}  ·  POST readings to /api/ingest\n`);
});
