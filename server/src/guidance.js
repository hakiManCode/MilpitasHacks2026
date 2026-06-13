// ─────────────────────────────────────────────────────────────────────────────
// Guidance layer — turns the raw model state into a calm, supportive presentation.
//
// Design principle: NEVER alarm. There is no "breaking point", no countdown, no
// strain percentage, no diagnosis here. Rising internal strain is converted into
// (a) a gentle phrase, (b) an invitation to breathe, and (c) a suggestion that is
// attributed to the *environment* (which the BME688 actually measures) rather than
// to the person's mental state. The calm front-end consumes only this object.
// ─────────────────────────────────────────────────────────────────────────────

const round = (x) => Math.round(x);

// Breathing patterns (seconds per phase). 4-7-8 has a long, calming exhale.
export const BREATHING = {
  box: { name: 'box', label: 'Box breathing', phases: [['in', 4], ['hold', 4], ['out', 4], ['hold', 4]] },
  calm: { name: 'calm', label: '4-7-8 breathing', phases: [['in', 4], ['hold', 7], ['out', 8]] },
};

function temperatureTip(t) {
  if (t == null) return null;
  if (t > 26) return { key: 'temp', status: 'Warm', severity: 2, text: 'Your space has warmed up. Cooler air helps the body unwind — easing the temperature or inviting some airflow can feel good.' };
  if (t > 24) return { key: 'temp', status: 'A touch warm', severity: 1, text: 'It’s a little warm in here; a bit of airflow could feel nice.' };
  if (t < 16) return { key: 'temp', status: 'Cool', severity: 2, text: 'It’s quite cool. A warm layer or a hot drink can be comforting right now.' };
  if (t < 18) return { key: 'temp', status: 'A touch cool', severity: 1, text: 'A little cool — a cozy layer might feel good.' };
  return { key: 'temp', status: 'Comfortable', severity: 0, text: 'The temperature in your space feels comfortable.' };
}

function airTip(score) {
  if (score == null) return null;
  if (score < 35) return { key: 'air', status: 'Stale', severity: 3, text: 'The air feels a little stale. A few minutes of fresh air can clear mental fog and help you reset.' };
  if (score < 55) return { key: 'air', status: 'A bit close', severity: 2, text: 'The air’s getting a little close — cracking a window for a moment can lighten the room.' };
  if (score < 72) return { key: 'air', status: 'Okay', severity: 1, text: 'The air is okay; a little ventilation never hurts.' };
  return { key: 'air', status: 'Fresh', severity: 0, text: 'The air in your space feels fresh.' };
}

function humidityTip(h) {
  if (h == null) return null;
  if (h > 70) return { key: 'humidity', status: 'Humid', severity: 2, text: 'It’s humid; some ventilation can make the room feel lighter and easier to breathe in.' };
  if (h > 60) return { key: 'humidity', status: 'A bit humid', severity: 1, text: 'A little humid — airflow can help it feel fresher.' };
  if (h < 30) return { key: 'humidity', status: 'Dry', severity: 2, text: 'The air is dry. A glass of water is a small, kind thing to do for yourself right now.' };
  if (h < 35) return { key: 'humidity', status: 'A touch dry', severity: 1, text: 'A touch dry — keeping water nearby is a good idea.' };
  return { key: 'humidity', status: 'Comfortable', severity: 0, text: 'Humidity is in a comfortable range.' };
}

function pressureNote(p) {
  if (p == null) return { key: 'pressure', status: '—', severity: 0, text: '' };
  return { key: 'pressure', status: 'Steady', severity: 0, text: 'Steady conditions outside.' };
}

export function buildGuidance(state) {
  const env = state.env || {};
  const sleep = state.sleep || { state: 'awake' };
  const balance = round(100 - state.strain); // internal only — tints the orb, never shown as a number

  const hour = state.now ? new Date(state.now).getHours() : 12;
  const isNight = hour >= 21 || hour < 6;
  const resting = sleep.state !== 'awake';

  // ── tone: a calm, supportive read on the moment (no scary thresholds) ───────
  let tone, headline, sub;
  if (resting) {
    tone = 'resting';
    headline = sleep.state === 'asleep' ? 'Resting.' : 'Your space is settling.';
    sub = sleep.state === 'asleep'
      ? 'All quiet. Let yourself rest — everything else can wait.'
      : 'The day is winding down. A slow, gentle pace from here is perfect.';
  } else if (balance >= 65) {
    tone = 'settled'; headline = 'You seem settled.'; sub = 'A calm, steady moment — it’s yours to enjoy.';
  } else if (balance >= 42) {
    tone = 'steady'; headline = 'A steady moment.'; sub = 'You’re carrying today well. Keep moving at your own pace.';
  } else if (balance >= 22) {
    tone = 'full'; headline = 'Things feel a little full.'; sub = 'No rush. Easing off for a moment is more than okay.';
  } else {
    tone = 'tender'; headline = 'Let’s take it gently.'; sub = 'This is a good moment to slow down and breathe together.';
  }

  const invite = tone === 'full' || tone === 'tender';
  const pattern = tone === 'tender' ? 'calm' : 'box';

  // ── environment cards (the BME688 readings, gently interpreted) ─────────────
  const space = [temperatureTip(env.temperature), airTip(env.airScore), humidityTip(env.humidity), pressureNote(env.pressure)]
    .filter(Boolean)
    .map((c) => ({ ...c, value: cardValue(c.key, env) }));

  const topEnv = space
    .filter((c) => c.severity > 0)
    .sort((a, b) => b.severity - a.severity || priority(a.key) - priority(b.key))[0];

  // ── the single gentle suggestion shown front-and-centre ─────────────────────
  let suggestion;
  if (invite) {
    suggestion = {
      kind: 'breathe',
      title: tone === 'tender' ? 'A good moment to breathe' : 'Maybe pause for a breath',
      text: tone === 'tender'
        ? 'Let’s take a slow minute together. Follow the circle — in, hold, and a long breath out.'
        : 'A minute of slow breathing can take the edge off. Want to try?',
      cta: 'Begin',
      pattern,
    };
    if (topEnv && topEnv.severity >= 2) {
      suggestion.aside = `And gently — ${topEnv.text.charAt(0).toLowerCase()}${topEnv.text.slice(1)}`;
    }
  } else if (topEnv) {
    suggestion = { kind: 'space', title: topEnv.status, text: topEnv.text, cta: null };
  } else {
    suggestion = {
      kind: 'calm',
      title: 'All calm',
      text: 'Your space and your pace both look good right now. A nice time to keep doing what you’re doing.',
      cta: 'Breathe anyway',
      pattern: 'box',
    };
  }

  return {
    tone,
    headline,
    sub,
    invite,
    balance, // for subtle orb tint only
    evening: resting || isNight,
    resting,
    suggestion,
    breathing: BREATHING[pattern],
    space,
    source: state.source || 'sim',
  };
}

function cardValue(key, env) {
  switch (key) {
    case 'temp': return env.temperature != null ? `${env.temperature.toFixed(1)}°` : '—';
    case 'humidity': return env.humidity != null ? `${Math.round(env.humidity)}%` : '—';
    case 'air': return env.airScore != null ? `${env.airScore}/100` : '—';
    case 'pressure': return env.pressure != null ? `${Math.round(env.pressure)}` : '—';
    default: return '—';
  }
}
const priority = (key) => ({ air: 0, temp: 1, humidity: 2, pressure: 3 }[key] ?? 9);
