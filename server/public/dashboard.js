'use strict';

// ── rolling buffers the charts draw from ────────────────────────────────────
const MAX_POINTS = 240;
const hist = { ts: [], strain: [], temperature: [], humidity: [], airScore: [], sleepProb: [] };

const $ = (id) => document.getElementById(id);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function pushPoint(p) {
  hist.ts.push(p.ts);
  hist.strain.push(p.strain);
  hist.temperature.push(p.temperature);
  hist.humidity.push(p.humidity);
  hist.airScore.push(p.airScore);
  hist.sleepProb.push(p.sleepProb);
  if (hist.ts.length > MAX_POINTS) {
    for (const k of Object.keys(hist)) hist[k].shift();
  }
}

// ── canvas helpers (crisp on HiDPI) ─────────────────────────────────────────
function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || 120;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

// read a CSS custom property so the canvases follow the active theme
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function strainColor(v) {
  if (v < 40) return '#2fb574';
  if (v < 70) return '#f5a623';
  if (v < 88) return '#fb923c';
  return '#ef5e57';
}

// Smooth-ish polyline with optional gradient fill underneath.
function drawSeries(ctx, w, h, vals, { color, min, max, fill = false, width = 2, pad = 6 }) {
  const pts = vals.filter((v) => v != null && Number.isFinite(v));
  if (pts.length < 2) return;
  const lo = min != null ? min : Math.min(...pts);
  const hi = max != null ? max : Math.max(...pts);
  const span = hi - lo || 1;
  const n = vals.length;
  const x = (i) => (i / (n - 1)) * (w - pad * 2) + pad;
  const y = (v) => h - pad - ((v - lo) / span) * (h - pad * 2);

  let first = true;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const v = vals[i];
    if (v == null || !Number.isFinite(v)) continue;
    if (first) { ctx.moveTo(x(i), y(v)); first = false; }
    else ctx.lineTo(x(i), y(v));
  }
  if (fill) {
    const grad = ctx.createLinearGradient(0, pad, 0, h);
    grad.addColorStop(0, color + '55');
    grad.addColorStop(1, color + '00');
    ctx.save();
    ctx.lineTo(x(n - 1), h);
    ctx.lineTo(x(0), h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
    // re-stroke the top line cleanly
    ctx.beginPath();
    first = true;
    for (let i = 0; i < n; i++) {
      const v = vals[i];
      if (v == null || !Number.isFinite(v)) continue;
      if (first) { ctx.moveTo(x(i), y(v)); first = false; }
      else ctx.lineTo(x(i), y(v));
    }
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

function drawGauge(strain) {
  const canvas = $('gauge');
  const { ctx, w, h } = fitCanvas(canvas);
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 12;
  const start = 0.75 * Math.PI;
  const sweep = 1.5 * Math.PI;
  ctx.clearRect(0, 0, w, h);
  // track
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, start + sweep);
  ctx.strokeStyle = cssVar('--track', '#e8ecf4');
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.stroke();
  // value
  const frac = clamp(strain / 100, 0, 1);
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, start + sweep * frac);
  ctx.strokeStyle = strainColor(strain);
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function drawMainChart() {
  const canvas = $('strainChart');
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  // gridlines for strain 0/50/100
  ctx.strokeStyle = cssVar('--grid', '#eef1f7');
  ctx.lineWidth = 1;
  for (const frac of [0, 0.5, 1]) {
    const yy = 6 + (1 - frac) * (h - 12);
    ctx.beginPath(); ctx.moveTo(6, yy); ctx.lineTo(w - 6, yy); ctx.stroke();
  }
  // sleep probability (0..1) as soft violet fill behind
  drawSeries(ctx, w, h, hist.sleepProb, { color: '#8b7ff0', min: 0, max: 1, fill: true, width: 1.5 });
  // strain (0..100) on top
  drawSeries(ctx, w, h, hist.strain, { color: '#f5a623', min: 0, max: 100, width: 2.4 });
}

function spark(id, vals, color) {
  const canvas = $(id);
  if (!canvas) return;
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  drawSeries(ctx, w, h, vals, { color, fill: true, width: 1.8, pad: 3 });
}

// pressure spark needs its own buffer (not in point payload) — keep a local one
const pressBuf = [];
function pushPress(v) {
  pressBuf.push(v);
  if (pressBuf.length > MAX_POINTS) pressBuf.shift();
}

function redrawAll() {
  drawGauge(lastStrain);
  drawMainChart();
  spark('spTemp', hist.temperature, '#f7894e');
  spark('spHum', hist.humidity, '#4f86f0');
  spark('spAir', hist.airScore, '#2fb574');
  spark('spPress', pressBuf, '#8b7ff0');
}

// ── formatting ──────────────────────────────────────────────────────────────
function fmtEta(hours) {
  if (hours == null) return null;
  if (hours < 1) return `~${Math.round(hours * 60)} min`;
  if (hours < 36) return `~${hours.toFixed(hours < 10 ? 1 : 0)} h`;
  return `~${(hours / 24).toFixed(1)} days`;
}
function fmtClock(ts) {
  // Default to 12-hour clock; user can toggle to 24-hour by clicking the clock.
  const hour12 = !clockPref24();
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12 });
}

function clockPref24() {
  try { return localStorage.getItem('restcue-clock24') === '1'; } catch (e) { return false; }
}
function setClockPref24(v) {
  try { localStorage.setItem('restcue-clock24', v ? '1' : '0'); } catch (e) {}
}

const tempNote = (t) => t == null ? ['', ''] :
  t < 16 ? ['bad', 'too cold to settle'] : t < 18 ? ['warn', 'a touch chilly'] :
  t <= 24 ? ['good', 'ideal range'] : t <= 26 ? ['warn', 'a bit warm'] : ['bad', 'too hot for rest'];
const humNote = (hh) => hh == null ? ['', ''] :
  hh < 30 ? ['bad', 'very dry'] : hh < 35 ? ['warn', 'a little dry'] :
  hh <= 60 ? ['good', 'comfortable'] : hh <= 70 ? ['warn', 'getting humid'] : ['bad', 'too humid'];
const airNote = (a) => a == null ? ['', ''] :
  a >= 75 ? ['good', 'clean air'] : a >= 50 ? ['warn', 'stuffy'] : a >= 25 ? ['warn', 'poor — ventilate'] : ['bad', 'very poor air'];

// ── render one state frame ───────────────────────────────────────────────────
let lastStrain = 0;

function render(s) {
  if (!s) return;
  lastStrain = s.strain;

  // hero
  $('strainVal').textContent = Math.round(s.strain);
  const pred = s.prediction;
  const etaEl = $('etaVal');
  if (pred.recovering) {
    etaEl.textContent = 'On track ✓';
    etaEl.className = 'eta ok';
  } else {
    const eta = fmtEta(pred.etaHours);
    etaEl.textContent = `in ${eta}`;
    etaEl.className = 'eta' + (pred.etaHours != null && pred.etaHours < 24 ? ' soon' : '');
  }
  $('dailyNet').textContent = (pred.dailyNet > 0 ? '+' : '') + pred.dailyNet;
  $('envMult').textContent = pred.envMultiplier + '×';
  $('airVal').textContent = s.env.airScore;

  // summary sentence
  $('summary').textContent = buildSummary(s);

  // sleep
  $('sleepPct').textContent = Math.round(s.sleep.probability * 100) + '%';
  const stateEl = $('sleepState');
  stateEl.textContent = s.sleep.label + (s.sleep.aboutToSleep ? ' 🌙' : '');
  stateEl.className = 'sleep-state ' + s.sleep.state;
  $('sleepCard').className = 'card sleep ' + s.sleep.state;
  $('sleepBar').style.width = clamp(s.sleep.probability * 100, 3, 100) + '%';
  renderSignals(s.sleep.signals);

  // environment tiles
  setTile('vTemp', s.env.temperature != null ? s.env.temperature.toFixed(1) + '°C' : '—', 'nTemp', tempNote(s.env.temperature));
  setTile('vHum', s.env.humidity != null ? s.env.humidity.toFixed(0) + '%' : '—', 'nHum', humNote(s.env.humidity));
  setTile('vAir', s.env.airScore + '/100', 'nAir', airNote(s.env.airScore));
  setTile('vPress', s.env.pressure != null ? s.env.pressure.toFixed(0) + ' hPa' : '—', 'nPress', ['', '']);
  $('comfort').textContent = s.env.comfort + '% comfort';

  // drivers
  renderDrivers(s.drivers, pred.recovering, pred.sleepRecovery);

  // badges / clock
  const live = s.source === 'hardware';
  const badge = $('srcBadge');
  badge.textContent = live ? 'LIVE' : 'DEMO';
  badge.className = 'badge ' + (live ? 'badge-live' : 'badge-sim');
  $('chartClock').textContent = s.now ? fmtClock(s.now) : '';
  lastNow = s.now;
  const cEl = $('chartClock');
  if (cEl) cEl.classList.toggle('clock-24', clockPref24());
  if (s.simSpeed && !live) $('speedNote').textContent = `demo clock · ${s.simSpeed}× speed`;
  else if (live) $('speedNote').textContent = 'live hardware feed';
}

// Allow user to toggle clock format by clicking the clock (12h default → 24h)
const _chartClock = $('chartClock');
if (_chartClock) {
  _chartClock.style.cursor = 'pointer';
  _chartClock.addEventListener('click', (e) => {
    e.stopPropagation();
    const cur = clockPref24();
    setClockPref24(!cur);
    _chartClock.textContent = lastNow ? fmtClock(lastNow) : '';
    _chartClock.classList.toggle('clock-24', !cur);
  });
}

function buildSummary(s) {
  const p = s.prediction;
  if (p.recovering) {
    return `You're recovering faster than you're burning out — no breaking point on this trajectory. Keep the balance.`;
  }
  const top = s.drivers[0];
  const eta = fmtEta(p.etaHours);
  const driverPhrase = top.key === 'effort'
    ? `your ${s.effort}% effort`
    : `${top.label.toLowerCase()} (${Math.round(top.share * 100)}% of the load)`;
  return `At this pace, ${driverPhrase} is pushing you toward your limit — projected breaking point ${eta} away. Rest or ease the environment to push it back.`;
}

function renderSignals(sig) {
  const order = [
    ['night', 'Time of day'],
    ['humidityRising', 'Humidity rising'],
    ['airWorsening', 'Air enclosing'],
    ['coolStable', 'Cool & still'],
    ['calm', 'Calm room'],
  ];
  $('sleepSignals').innerHTML = order.map(([k, label]) => {
    const v = clamp(sig[k] ?? 0, 0, 1);
    return `<li><span>${label}</span><span class="sval"><i style="width:${Math.round(v * 100)}%"></i></span></li>`;
  }).join('');
}

function setTile(valId, val, noteId, [cls, text]) {
  $(valId).textContent = val;
  const n = $(noteId);
  n.textContent = text;
  n.className = 'tile-note ' + cls;
}

function renderDrivers(drivers, recovering, sleepRecovery) {
  const positives = drivers.filter((d) => d.value > 0.05);
  const max = positives.length ? positives[0].value : 1;
  $('driverList').innerHTML = positives.map((d) => {
    const pct = Math.round(d.share * 100);
    const wpct = Math.round((d.value / max) * 100);
    const color = d.key === 'effort' ? '#4f56e0'
      : d.key === 'air' ? '#2fb574'
      : d.key === 'temp' ? '#fb923c'
      : d.key === 'humidity' ? '#4f86f0' : '#8b7ff0';
    return `<li><span class="dname">${d.label}</span>
      <span class="dbar"><i style="width:${wpct}%;background:${color}"></i></span>
      <span class="dpct">${pct}%</span></li>`;
  }).join('');
  $('recoveryNote').textContent = recovering
    ? `Sleep is recovering ~${sleepRecovery}/day — more than you accumulate.`
    : `Sleep recovers ~${sleepRecovery}/day, but it isn't keeping up with the load above.`;
}

// ── effort slider ────────────────────────────────────────────────────────────
const effort = $('effort');
let effortTimer = null;
effort.addEventListener('input', () => {
  $('effortVal').textContent = effort.value + '%';
  clearTimeout(effortTimer);
  effortTimer = setTimeout(() => {
    fetch('/api/effort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ effort: Number(effort.value) }),
    }).catch(() => {});
  }, 120);
});

// ── data loading: backfill history, then live SSE ────────────────────────────
async function backfill() {
  try {
    const rows = await (await fetch('/api/history?minutes=720')).json();
    for (const r of rows) {
      pushPoint({
        ts: r.ts, strain: r.strain ?? lastStrain, temperature: r.temperature,
        humidity: r.humidity, airScore: r.gas ? gasToScore(r.gas) : null,
        sleepProb: r.sleepProb ?? null,
      });
      pushPress(r.pressure);
    }
  } catch { /* no history yet */ }
}
// rough mirror of server airScore for backfilled raw readings
function gasToScore(gas) {
  if (!gas || gas <= 0) return 60;
  const lo = Math.log10(8000), hi = Math.log10(200000);
  return Math.round(clamp(((Math.log10(gas) - lo) / (hi - lo)) * 100, 0, 100));
}

function pollState() {
  let active = true;
  const conn = $('conn');
  async function tick() {
    if (!active) return;
    try {
      const { state } = await (await fetch('/api/state')).json();
      if (state) {
        conn.className = 'conn ok';
        conn.innerHTML = '<i class="dot"></i>connected';
        render(state);
        redrawAll();
      }
    } catch {
      conn.className = 'conn off';
      conn.innerHTML = '<i class="dot"></i>reconnecting…';
    }
    if (active) setTimeout(tick, 2500);
  }
  tick();
  return () => { active = false; };
}

function connect() {
  const conn = $('conn');
  if (!window.EventSource) return pollState();
  let pollCancel = null;
  let es;
  try {
    es = new EventSource('/api/stream');
  } catch {
    return pollState();
  }
  es.onopen = () => { conn.className = 'conn ok'; conn.innerHTML = '<i class="dot"></i>connected'; };
  es.onerror = () => {
    conn.className = 'conn off';
    conn.innerHTML = '<i class="dot"></i>reconnecting…';
    if (!pollCancel) pollCancel = pollState();
  };
  es.onmessage = (ev) => {
    let s;
    try { s = JSON.parse(ev.data); } catch { return; }
    if (!s || !s.point) return;
    pushPoint(s.point);
    pushPress(s.env?.pressure ?? null);
    render(s);
    redrawAll();
  };
  return () => {
    es.close();
    if (pollCancel) pollCancel();
  };
}

async function init() {
  // pull current effort + state so the UI matches the server on load
  try {
    const { state, effort: e } = await (await fetch('/api/state')).json();
    if (e != null) { effort.value = e; $('effortVal').textContent = e + '%'; }
    if (state) { lastStrain = state.strain; render(state); }
  } catch { /* ignore */ }
  await backfill();
  redrawAll();
  // ?static renders one snapshot without the live stream (embeds / screenshots).
  if (!new URLSearchParams(location.search).has('static')) connect();
}

window.addEventListener('resize', () => requestAnimationFrame(redrawAll));
// recolour the canvases when light/dark flips
window.RestCueTheme?.onChange(() => requestAnimationFrame(redrawAll));
init();
