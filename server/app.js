'use strict';
import express from 'express';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './src/store.js';
import { BurnoutModel } from './src/model.js';
import { Simulator } from './src/simulator.js';
import { buildGuidance } from './src/guidance.js';
import { clamp, num } from './src/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const SIMULATE = process.env.SIMULATE !== 'false';
const SIM_SPEED = Number(process.env.SIM_SPEED || 300);
const HARDWARE_GRACE_MS = 15000;
const dataDir = process.env.DATA_DIR || path.join(os.tmpdir(), 'breakpoint-data');

const store = new Store({ dataDir, maxPoints: 6000 });
const model = new BurnoutModel(store.loadPersisted());

let userEffort = 70;
let lastHardwareAt = 0;

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function decorate(state) {
  if (state) state.guidance = buildGuidance(state);
  return state;
}

const clients = new Set();
function broadcast(state) {
  const frame = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) {
    try { res.write(frame); } catch { }
  }
}

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

  const prev = store.latest();
  if (prev && prev.source !== reading.source) {
    store.clear();
    model.resetClock();
  }

  store.addReading(reading);
  const state = model.update(reading, { effort: userEffort });
  state.simSpeed = SIM_SPEED;
  decorate(state);
  store.savePersisted(model.serialize());
  broadcast(state);
  return state;
}

app.get('/dashboard', (req, res) => res.redirect('/#insights'));

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
  if (latest) broadcast(decorate(model.snapshot(latest, { effort: userEffort })));
  res.json({ ok: true, effort: userEffort });
});

app.get('/api/state', (req, res) => {
  const latest = store.latest();
  res.json({
    state: latest ? decorate(model.snapshot(latest, { effort: userEffort })) : null,
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
  if (on === false) sim.stop(); else if (on === true) sim.start();
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
  if (latest) res.write(`data: ${JSON.stringify(decorate(model.snapshot(latest, { effort: userEffort })))}\n\n`);

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(res);
  });
});

const sim = SIMULATE
  ? new Simulator({
      speed: SIM_SPEED,
      onReading: (r) => {
        if (Date.now() - lastHardwareAt < HARDWARE_GRACE_MS) return;
        ingest(r, { fromHardware: false });
      },
    })
  : null;
if (sim) sim.start();

export { app };
