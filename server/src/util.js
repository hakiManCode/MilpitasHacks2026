// Small shared helpers used across the model / store / simulator.

export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);

// Coerce to a finite number, or return fallback (handles undefined / NaN / strings).
export const num = (v, fallback = null) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
};

export const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// Penalty in [0,1] for how far x falls outside the comfort band [lo, hi].
// Reaches 1.0 when x is `soft` units beyond the band edge.
export function bandStress(x, lo, hi, soft) {
  if (x == null || !Number.isFinite(x)) return 0;
  if (x >= lo && x <= hi) return 0;
  const d = x < lo ? lo - x : x - hi;
  return clamp(d / soft, 0, 1);
}

// Local hour-of-day (0..24, fractional) for a timestamp in ms.
// Uses the system/local timezone so server/client timestamps align with the
// user's configured timezone when rendering time-of-day signals.
export function hourOfDay(ts) {
  const d = new Date(ts);
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}
