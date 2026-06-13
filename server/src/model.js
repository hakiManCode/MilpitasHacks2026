import { clamp, lerp, sigmoid, bandStress, hourOfDay } from './util.js';

// ──────────────────────────────────────────────────────────────────────────
// Tunable constants. The whole model is intentionally transparent: every number
// here has a plain-English meaning so it can be explained to judges and tuned.
// ──────────────────────────────────────────────────────────────────────────
const CFG = {
  // Strain dynamics (units: strain-points per hour, on a 0..100 scale)
  BASE_AWAKE_RATE: 2.2, // strain gained per awake hour at "normal" effort, neutral environment
  BASE_SLEEP_RECOVERY: 5.5, // strain recovered per hour of perfect sleep
  ENV_GAIN: 0.9, // how much a hostile environment multiplies awake strain (1 + GAIN*stress)
  EFFORT_REF: 70, // effort level that counts as a sustainable "normal" day
  EFFORT_FACTOR_RANGE: [0.15, 1.6], // clamp on effort multiplier

  // Daily-cycle assumptions used for the breaking-point projection
  AWAKE_HOURS: 16,
  SLEEP_HOURS: 8,

  // Comfort bands (sleep-oriented but generally healthy ranges)
  TEMP_BAND: [18, 24], TEMP_SOFT: 8, // °C
  HUM_BAND: [35, 60], HUM_SOFT: 30, // %RH
  // Air quality from BME688 gas resistance (Ohms), log-scaled: higher = cleaner
  GAS_BAD: 8000, GAS_GOOD: 200000,

  // Stress weights inside the environment multiplier (sum need not be 1)
  W_TEMP: 0.30, W_HUM: 0.25, W_AIR: 0.40, W_PRESS: 0.05,

  // Sleep-probability logistic weights
  SLEEP: {
    bias: -0.6,
    circadian: 3.2, // time of day dominates
    evening: 2.5, // extra weight for evening winding-down (≈19:00–24:00)
    humidityRising: 1.4, // closed room: breathing raises humidity
    airWorsening: 1.5, // closed room: VOC/CO2 build up, gas resistance drops
    coolStable: 1.1, // cool + steady temperature
    calm: 1.3, // low overall variance = still environment
    gain: 1.5, // logistic steepness
    emaAlpha: 0.15, // smoothing so the state doesn't flicker
  },

  STRAIN_START: 35, // first-boot strain before any history exists
  DT_CAP_HOURS: 1.0, // ignore time jumps larger than this (server was off, etc.)
  TREND_WINDOW: 36, // readings kept for trend / variance estimation
};

const AIR_LOG_LO = Math.log10(CFG.GAS_BAD);
const AIR_LOG_HI = Math.log10(CFG.GAS_GOOD);

export class BurnoutModel {
  constructor(persisted = {}) {
    this.strain = clamp(persisted.strain ?? CFG.STRAIN_START, 0, 100);
    this.sleepProb = persisted.sleepProb ?? 0.1;
    this.lastTs = null; // do NOT accumulate across the restart gap
    this.window = []; // recent readings for trends
  }

  serialize() {
    return { strain: this.strain, sleepProb: this.sleepProb, savedAt: Date.now() };
  }

  // Forget timing/trend history (used when the data source — and thus the clock —
  // switches) without losing accumulated strain.
  resetClock() {
    this.lastTs = null;
    this.window = [];
  }

  // Convert BME688 gas resistance (Ohms) → 0..100 air-quality score (100 = clean).
  airScore(gas) {
    if (gas == null || gas <= 0) return 60; // heater still warming up → neutral
    return clamp(((Math.log10(gas) - AIR_LOG_LO) / (AIR_LOG_HI - AIR_LOG_LO)) * 100, 0, 100);
  }

  // Per-factor environmental stress in [0,1].
  stresses(r) {
    const temp = bandStress(r.temperature, CFG.TEMP_BAND[0], CFG.TEMP_BAND[1], CFG.TEMP_SOFT);
    const hum = bandStress(r.humidity, CFG.HUM_BAND[0], CFG.HUM_BAND[1], CFG.HUM_SOFT);
    const air = 1 - this.airScore(r.gas) / 100;
    // Pressure stress comes from rapid drops (weather fronts → headaches/low mood for some).
    const pressTrend = this.trend('pressure'); // hPa per hour
    const press = clamp(-pressTrend / 3, 0, 1); // a 3 hPa/hr fall → full stress
    return { temp, hum, air, press };
  }

  // Slope of a field over the recent window, in units per hour.
  trend(field) {
    const w = this.window.filter((p) => Number.isFinite(p[field]));
    if (w.length < 4) return 0;
    const t0 = w[0].ts;
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of w) {
      const x = (p.ts - t0) / 3.6e6; // hours
      const y = p[field];
      n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-9) return 0;
    return (n * sxy - sx * sy) / denom;
  }

  // Std-dev of temperature over the window → "how still is the room".
  tempVariance() {
    const w = this.window.filter((p) => Number.isFinite(p.temperature));
    if (w.length < 4) return 0;
    const mean = w.reduce((a, p) => a + p.temperature, 0) / w.length;
    const v = w.reduce((a, p) => a + (p.temperature - mean) ** 2, 0) / w.length;
    return Math.sqrt(v);
  }

  computeSleepProb(r) {
    const S = CFG.SLEEP;
    const hour = hourOfDay(r.ts);
    // Circadian bump centred on ~3am, wrapping around midnight.
    let dist = Math.abs(hour - 3);
    dist = Math.min(dist, 24 - dist);
    const night = Math.exp(-(dist * dist) / (2 * 4 * 4)); // sigma ≈ 4h → 0..1

    // Evening "winding down" bump centred on ~21:00 (9pm).
    // This helps the app recognise realistic evening sleep onset (≈19:00–24:00).
    let ed = Math.abs(hour - 21);
    ed = Math.min(ed, 24 - ed);
    const evening = Math.exp(-(ed * ed) / (2 * 2 * 2)); // sigma ≈ 2h → stronger between 19–24

    const humRise = clamp(this.trend('humidity') / 4, 0, 1); // +4 %RH/hr → full signal
    const airWorse = clamp(-this.trend('gas') / 60000, 0, 1); // gas dropping fast → enclosed
    const coolStable = r.temperature != null
      ? clamp((22 - r.temperature) / 5, 0, 1) * clamp(1 - this.tempVariance() / 1.5, 0, 1)
      : 0;
    const calm = clamp(1 - this.tempVariance() / 1.5, 0, 1);

    const z = S.bias
      + S.circadian * (night - 0.5)
      + S.evening * evening
      + S.humidityRising * humRise
      + S.airWorsening * airWorse
      + S.coolStable * coolStable
      + S.calm * (calm - 0.5);

    const raw = sigmoid(S.gain * z);
    this.sleepProb = lerp(this.sleepProb, raw, S.emaAlpha);
    return { sleepProb: this.sleepProb, night, humRise, airWorse, coolStable, calm };
  }

  effortFactor(effort) {
    return clamp(effort / CFG.EFFORT_REF, CFG.EFFORT_FACTOR_RANGE[0], CFG.EFFORT_FACTOR_RANGE[1]);
  }

  // Ingest one reading, advance strain, and return the full UI state.
  update(r, { effort = CFG.EFFORT_REF } = {}) {
    this.window.push(r);
    if (this.window.length > CFG.TREND_WINDOW) this.window.shift();

    const sleep = this.computeSleepProb(r);

    // Advance strain over elapsed (possibly simulated) time.
    if (this.lastTs != null) {
      let dt = (r.ts - this.lastTs) / 3.6e6; // hours
      if (dt > 0 && dt <= CFG.DT_CAP_HOURS) {
        const { awakeRate, sleepRate } = this.rates(r, effort);
        const netRate = lerp(awakeRate, sleepRate, sleep.sleepProb);
        this.strain = clamp(this.strain + netRate * dt, 0, 100);
      }
    }
    this.lastTs = r.ts;

    return this.buildState(r, effort, sleep);
  }

  rates(r, effort) {
    const st = this.stresses(r);
    const envStress = clamp(
      CFG.W_TEMP * st.temp + CFG.W_HUM * st.hum + CFG.W_AIR * st.air + CFG.W_PRESS * st.press,
      0, 1,
    );
    const envMult = 1 + CFG.ENV_GAIN * envStress;
    const ef = this.effortFactor(effort);
    const awakeRate = CFG.BASE_AWAKE_RATE * ef * envMult;
    const sleepQuality = clamp(1 - 0.8 * envStress, 0.25, 1);
    const sleepRate = -CFG.BASE_SLEEP_RECOVERY * sleepQuality;
    return { awakeRate, sleepRate, envStress, envMult, ef, sleepQuality, st };
  }

  // Recompute the full state from the latest reading WITHOUT advancing strain.
  // Used by /api/state and whenever the user changes their effort slider.
  buildState(r, effort, sleep = null) {
    sleep = sleep || this.computeSleepProb(r);
    const { awakeRate, sleepRate, envStress, envMult, ef, sleepQuality, st } = this.rates(r, effort);

    // Headline projection: net strain change over a full assumed day/night cycle.
    const awakeLoad = awakeRate * CFG.AWAKE_HOURS;
    const sleepRecovery = -sleepRate * CFG.SLEEP_HOURS; // positive number
    const dailyNet = awakeLoad - sleepRecovery;

    let eta = null; // hours until strain hits 100, or null if recovering
    if (dailyNet > 0.01) {
      eta = ((100 - this.strain) / dailyNet) * 24;
    }

    // "What's driving your strain" — decompose the awake load into its parts so
    // the bars sum exactly to the daily accumulation the dynamics use.
    const baseEffortPart = CFG.BASE_AWAKE_RATE * ef * CFG.AWAKE_HOURS;
    const envBase = CFG.BASE_AWAKE_RATE * ef * CFG.ENV_GAIN * CFG.AWAKE_HOURS;
    const drivers = [
      { key: 'effort', label: 'Effort', value: baseEffortPart },
      { key: 'air', label: 'Air quality', value: envBase * CFG.W_AIR * st.air },
      { key: 'temp', label: 'Temperature', value: envBase * CFG.W_TEMP * st.temp },
      { key: 'humidity', label: 'Humidity', value: envBase * CFG.W_HUM * st.hum },
      { key: 'pressure', label: 'Pressure', value: envBase * CFG.W_PRESS * st.press },
    ];
    const totalLoad = drivers.reduce((a, d) => a + d.value, 0) || 1;
    drivers.forEach((d) => { d.share = d.value / totalLoad; });
    drivers.sort((a, b) => b.value - a.value);

    const air = this.airScore(r.gas);
    const state = this.sleepState(sleep);

    return {
      now: r.ts,
      source: r.source || 'sim',
      strain: round(this.strain, 1),
      effort,
      // environment snapshot
      env: {
        temperature: roundOrNull(r.temperature, 1),
        humidity: roundOrNull(r.humidity, 1),
        pressure: roundOrNull(r.pressure, 1),
        gas: roundOrNull(r.gas, 0),
        airScore: round(air, 0),
        comfort: round((1 - envStress) * 100, 0),
      },
      // breaking-point projection
      prediction: {
        dailyNet: round(dailyNet, 1),
        etaHours: eta == null ? null : round(eta, 1),
        recovering: dailyNet <= 0.01,
        awakeLoad: round(awakeLoad, 1),
        sleepRecovery: round(sleepRecovery, 1),
        envMultiplier: round(envMult, 2),
      },
      // sleep detection
      sleep: {
        probability: round(sleep.sleepProb, 3),
        state: state.id,
        label: state.label,
        aboutToSleep: state.id === 'winding_down' && this.trend('humidity') >= 0,
        signals: {
          night: round(sleep.night, 2),
          humidityRising: round(sleep.humRise, 2),
          airWorsening: round(sleep.airWorse, 2),
          coolStable: round(sleep.coolStable, 2),
          calm: round(sleep.calm, 2),
        },
      },
      drivers,
      // single point the dashboard appends to its live charts
      point: {
        ts: r.ts,
        strain: round(this.strain, 1),
        temperature: roundOrNull(r.temperature, 1),
        humidity: roundOrNull(r.humidity, 1),
        airScore: round(air, 0),
        sleepProb: round(sleep.sleepProb, 3),
      },
    };
  }

  // Snapshot from the most recent reading without advancing time.
  snapshot(latest, { effort = CFG.EFFORT_REF } = {}) {
    if (!latest) return null;
    return this.buildState(latest, effort);
  }

  sleepState(sleep) {
    const p = sleep.sleepProb;
    if (p >= 0.65) return { id: 'asleep', label: 'Asleep' };
    if (p >= 0.35) return { id: 'winding_down', label: 'Winding down — about to sleep' };
    return { id: 'awake', label: 'Awake' };
  }
}

const round = (x, d) => {
  const m = 10 ** d;
  return Math.round(x * m) / m;
};
const roundOrNull = (x, d) => (x == null || !Number.isFinite(x) ? null : round(x, d));
