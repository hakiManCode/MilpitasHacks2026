'use strict';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const body = document.body;

// Orb palettes per tone — all calm, never alarming.
const ORB = {
  settled: ['#9ec9ad', '#8fb4cf'],
  steady: ['#a7c8b4', '#8fb4cf'],
  full: ['#a9c1cf', '#9fb0d0'],
  tender: ['#b3a6d4', '#8fa6c8'],
  resting: ['#8a7fb0', '#6f86a8'],
};

const SPACE_LABELS = { temp: 'Temperature', air: 'Air', humidity: 'Humidity' };

// Breathing patterns (mirror of the server's, so the UI can run standalone).
const PATTERNS = {
  box: { label: 'box breathing', phases: [['in', 4], ['hold', 4], ['out', 4], ['hold', 4]] },
  calm: { label: '4-7-8 breathing', phases: [['in', 4], ['hold', 7], ['out', 8]] },
};

// ── guided breathing session ─────────────────────────────────────────────────
class Breathing {
  constructor() {
    this.els = {
      overlay: $('breathOverlay'), orb: $('breathOrb'),
      label: $('breathLabel'), count: $('breathCount'), meta: $('breathMeta'),
    };
    this.active = false;
    this.onKey = (e) => { if (e.key === 'Escape') this.stop(); };
  }

  start(name) {
    this.pattern = PATTERNS[name] || PATTERNS.box;
    this.idx = 0;
    this.active = true;
    this.els.overlay.hidden = false;
    this.els.meta.textContent = `${this.pattern.label} · finish whenever you’re ready`;
    document.addEventListener('keydown', this.onKey);
    this.runPhase();
  }

  runPhase() {
    if (!this.active) return;
    const [type, secs] = this.pattern.phases[this.idx % this.pattern.phases.length];
    this.els.orb.style.transitionDuration = `${secs}s`;
    if (type === 'in') { this.els.orb.style.transform = 'scale(1.16)'; this.els.label.textContent = 'Breathe in'; }
    else if (type === 'out') { this.els.orb.style.transform = 'scale(0.62)'; this.els.label.textContent = 'Breathe out'; }
    else { this.els.label.textContent = 'Hold'; }

    let n = secs;
    this.els.count.textContent = n;
    clearInterval(this.tick);
    this.tick = setInterval(() => { n -= 1; this.els.count.textContent = Math.max(n, 1); }, 1000);

    clearTimeout(this.phaseTimer);
    this.phaseTimer = setTimeout(() => { this.idx += 1; this.runPhase(); }, secs * 1000);
  }

  stop() {
    this.active = false;
    clearTimeout(this.phaseTimer);
    clearInterval(this.tick);
    document.removeEventListener('keydown', this.onKey);
    this.els.overlay.hidden = true;
    this.els.orb.style.transitionDuration = '1.4s';
    this.els.orb.style.transform = 'scale(0.7)';
  }
}
const breathing = new Breathing();

// ── render a guidance frame ──────────────────────────────────────────────────
let currentPattern = 'box';

function applyState(s) {
  const g = s && s.guidance;
  if (!g) return;

  $('headline').textContent = g.headline;
  $('sub').textContent = g.sub;

  // ambiance
  body.classList.toggle('evening', !!g.evening);
  const [a, b] = ORB[g.tone] || ORB.settled;
  root.style.setProperty('--orb-a', a);
  root.style.setProperty('--orb-b', b);

  // gentle suggestion
  const sg = g.suggestion || {};
  $('sgTitle').textContent = sg.title || '';
  $('sgText').textContent = sg.text || '';
  const aside = $('sgAside');
  if (sg.aside) { aside.textContent = sg.aside; aside.hidden = false; } else { aside.hidden = true; }
  const cta = $('sgCta');
  if (sg.cta) {
    cta.hidden = false;
    cta.textContent = sg.cta;
    currentPattern = sg.pattern || 'box';
  } else {
    cta.hidden = true;
  }

  // your space
  const grid = $('spaceGrid');
  grid.innerHTML = (g.space || [])
    .filter((c) => SPACE_LABELS[c.key])
    .map((c) => `
      <div class="space-card">
        <div class="sc-top">
          <span class="sc-label">${SPACE_LABELS[c.key]}</span>
          <span class="sc-val">${c.value}</span>
        </div>
        <span class="sc-status sev${c.severity}">${c.status}</span>
        <p class="sc-note">${c.text}</p>
      </div>`).join('');

  // data source (kept subtle, non-alarming)
  const live = $('live');
  const isLive = g.source === 'hardware';
  live.classList.toggle('on', isLive);
  $('liveText').textContent = isLive ? 'live' : 'demo';
}

// ── gentle check-in (feeds the model's effort, framed kindly) ────────────────
const load = $('load');
let loadTimer = null;
load.addEventListener('input', () => {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => {
    fetch('/api/effort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ effort: Number(load.value) }),
    }).catch(() => {});
  }, 150);
});

// ── breathing triggers ───────────────────────────────────────────────────────
$('sgCta').addEventListener('click', () => breathing.start(currentPattern));
$('openBreath').addEventListener('click', () => breathing.start(currentPattern));
$('breathClose').addEventListener('click', () => breathing.stop());

// ── live data ─────────────────────────────────────────────────────────────────
function pollState() {
  let active = true;
  async function tick() {
    if (!active) return;
    try {
      const { state } = await (await fetch('/api/state')).json();
      if (state) applyState(state);
    } catch {
      /* ignore transient errors */
    }
    if (active) setTimeout(tick, 2500);
  }
  tick();
  return () => { active = false; };
}

function connect() {
  if (!window.EventSource) return pollState();
  let pollCancel = null;
  let es;
  try {
    es = new EventSource('/api/stream');
  } catch {
    return pollState();
  }
  es.onmessage = (ev) => {
    try { applyState(JSON.parse(ev.data)); } catch { /* ignore malformed frame */ }
  };
  es.onerror = () => {
    if (!pollCancel) pollCancel = pollState();
  };
  return () => {
    es.close();
    if (pollCancel) pollCancel();
  };
}

async function init() {
  try {
    const { state, effort } = await (await fetch('/api/state')).json();
    if (effort != null) load.value = effort;
    if (state) applyState(state);
  } catch { /* server not ready yet — SSE will catch up */ }
  // ?static renders one snapshot without opening the live stream (handy for
  // embeds / screenshots where an open connection would never settle).
  if (!new URLSearchParams(location.search).has('static')) connect();
}

init();
