'use strict';
/* ─────────────────────────────────────────────────────────────────────────────
 * RestCue theme controller — a single source of truth for light / dark / auto,
 * shared by every view (Home, Haven, Breakpoint).
 *
 * Loaded as a *classic* script in <head> so it runs before first paint and the
 * page never flashes the wrong theme.
 *
 *   preference  ∈  { 'auto', 'light', 'dark' }        (persisted in localStorage)
 *   effective   ∈  { 'light', 'dark' }                (what actually gets applied)
 *
 * "auto" resolves by *time and area*: if the user grants geolocation we compute
 * the real sunrise / sunset for their coordinates and go dark after dusk; if not,
 * we fall back to fixed daytime hours blended with the OS colour-scheme hint.
 * The result is written to <html data-theme> / <html data-theme-pref> and broadcast
 * to listeners so the views can react (e.g. recolour a canvas gauge).
 * ───────────────────────────────────────────────────────────────────────────── */
(function () {
  var LS_PREF = 'restcue-theme';
  var LS_GEO = 'restcue-geo';
  var root = document.documentElement;
  var listeners = [];
  var pref = read();
  var effective = null;

  function read() {
    try {
      var v = localStorage.getItem(LS_PREF);
      return v === 'light' || v === 'dark' || v === 'auto' ? v : 'auto';
    } catch (e) { return 'auto'; }
  }
  function save(v) { try { localStorage.setItem(LS_PREF, v); } catch (e) {} }

  // ── minimal SunCalc (sunrise/sunset only), ported from mourner/suncalc ───────
  function sunTimes(date, lat, lng) {
    var PI = Math.PI, rad = PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545;
    var e = rad * 23.4397;
    function toJulian(d) { return d.valueOf() / dayMs - 0.5 + J1970; }
    function fromJulian(j) { return new Date((j + 0.5 - J1970) * dayMs); }
    function toDays(d) { return toJulian(d) - J2000; }
    function meanAnomaly(d) { return rad * (357.5291 + 0.98560028 * d); }
    function eclipticLong(M) {
      var C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
      return M + C + rad * 102.9372 + PI;
    }
    function declination(l) { return Math.asin(Math.sin(l) * Math.sin(e)); }
    function transitJ(ds, M, L) { return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L); }
    function hourAngle(h, phi, d) {
      return Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d)));
    }
    var lw = rad * -lng, phi = rad * lat, d = toDays(date);
    var n = Math.round(d - 0.0009 - lw / (2 * PI));
    var ds = 0.0009 + (lw) / (2 * PI) + n;
    var M = meanAnomaly(ds), L = eclipticLong(M), dec = declination(L);
    var Jnoon = transitJ(ds, M, L);
    var w = hourAngle(rad * -0.833, phi, dec);
    if (isNaN(w)) return null; // polar day / night
    var a = 0.0009 + (w + lw) / (2 * PI) + n;
    var Jset = transitJ(a, M, L);
    var Jrise = Jnoon - (Jset - Jnoon);
    return { sunrise: fromJulian(Jrise), sunset: fromJulian(Jset) };
  }

  function geo() {
    try { return JSON.parse(localStorage.getItem(LS_GEO) || 'null'); } catch (e) { return null; }
  }

  // Resolve "auto" → light/dark using location-aware sunrise/sunset, then a
  // sensible time-of-day + OS fallback when we have no coordinates.
  function autoResolve() {
    var now = new Date();
    var g = geo();
    if (g && typeof g.lat === 'number') {
      var t = sunTimes(now, g.lat, g.lng);
      if (t) return (now < t.sunrise || now > t.sunset) ? 'dark' : 'light';
    }
    var hour = now.getHours() + now.getMinutes() / 60;
    var daytime = hour >= 6.5 && hour < 19.5;
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (!daytime) return 'dark';
    return prefersDark && (hour < 7.5 || hour > 18.5) ? 'dark' : 'light';
  }

  function apply() {
    var eff = pref === 'auto' ? autoResolve() : pref;
    var changed = eff !== effective;
    effective = eff;
    root.setAttribute('data-theme', eff);
    root.setAttribute('data-theme-pref', pref);
    if (changed) for (var i = 0; i < listeners.length; i++) try { listeners[i](eff, pref); } catch (e) {}
  }

  // Ask for location once so "auto" can use real dusk; silently fine if denied.
  function requestGeo() {
    if (geo() || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(function (pos) {
      try {
        localStorage.setItem(LS_GEO, JSON.stringify({
          lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now(),
        }));
      } catch (e) {}
      apply();
    }, function () {}, { maximumAge: 6 * 3600e3, timeout: 8000 });
  }

  apply(); // pre-paint

  window.RestCueTheme = {
    get: function () { return pref; },
    effective: function () { return effective; },
    set: function (v) { pref = (v === 'light' || v === 'dark') ? v : 'auto'; save(pref); if (pref === 'auto') requestGeo(); apply(); },
    cycle: function () { this.set({ auto: 'light', light: 'dark', dark: 'auto' }[pref] || 'auto'); return pref; },
    onChange: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
  };

  // Re-evaluate "auto" as the day moves on, when the OS hint flips, and on return.
  document.addEventListener('DOMContentLoaded', function () { if (pref === 'auto') requestGeo(); });
  setInterval(function () { if (pref === 'auto') apply(); }, 5 * 60e3);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && pref === 'auto') apply(); });
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(function () { if (pref === 'auto') apply(); });
  }
})();
