'use strict';
/* ─────────────────────────────────────────────────────────────────────────────
 * Home view + the shared chrome (theme toggle, account menu, login modal).
 * Loaded on every view so the floating controls work everywhere; the
 * home-specific rendering simply no-ops when those elements aren't on screen.
 * ───────────────────────────────────────────────────────────────────────────── */
import { onAuth, currentUser, mode, signInEmail, signUpEmail, signInGoogle, signInGuest, signOut, saveUserEffort } from './auth.js';

const $ = (id) => document.getElementById(id);
const T = window.RestCueTheme;

function authErrorMessage(err) {
  if (!err) return 'Something went wrong. Please try again.';
  if (err.code === 'auth/unauthorized-domain') {
    return 'Firebase auth is not authorized for this domain. Add http://localhost:3000 to the Firebase console authorized domains.';
  }
  if (err.code === 'auth/popup-blocked' || err.code === 'auth/cancelled-popup-request') {
    return 'Popup sign-in was blocked. Please allow popups or try again.';
  }
  return err.message || String(err);
}

function showAuthError(message) {
  const err = $('rcErr');
  if (err) {
    err.textContent = message;
    const modal = $('rcModal');
    if (modal && modal.hidden) alert(message);
  } else {
    alert(message);
  }
  console.error('Auth error:', message);
}

/* ── theme toggle ─────────────────────────────────────────────────────────── */
const themeLabels = { auto: 'Auto theme', light: 'Light mode', dark: 'Dark mode' };
function syncThemeBtn() {
  const b = $('rcThemeBtn');
  if (b) b.title = themeLabels[T.get()] + ' — click to change';
}
$('rcThemeBtn')?.addEventListener('click', () => { T.cycle(); syncThemeBtn(); });
T?.onChange(syncThemeBtn);
syncThemeBtn();

/* ── account control + menu ───────────────────────────────────────────────── */
const initials = (u) => !u ? '' : (u.name || u.email || 'U').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const firstName = (u) => !u ? '' : (u.name || u.email || '').split(/[\s@]/)[0];

function renderAccount(u) {
  const btn = $('rcAccountBtn'), av = $('rcAvatar'), name = $('rcAccountName');
  if (btn) {
    name.textContent = u ? firstName(u) : 'Sign in';
    if (u && u.photo) { av.style.backgroundImage = `url(${u.photo})`; av.style.backgroundSize = 'cover'; av.textContent = ''; }
    else { av.style.backgroundImage = ''; av.textContent = u ? initials(u) : '•'; }
  }
  // menu contents
  const mn = $('rcMenuName'), ms = $('rcMenuSub');
  if (mn) mn.textContent = u ? (u.name || 'Signed in') : '';
  if (ms) ms.textContent = u ? (u.email || (u.guest ? 'Guest session' : '')) : '';
  const tag = $('rcModeTag');
  if (tag) tag.textContent = mode() === 'firebase' ? 'Firebase account' : 'Local demo account';
  // home sign-in banner
  const banner = $('hSignin');
  if (banner) banner.hidden = !!u;
  // home greeting name
  const gname = $('hGreetName');
  if (gname) gname.textContent = u ? `, ${firstName(u)}` : '';
}

function closeMenu() { const m = $('rcMenu'); if (m) m.hidden = true; }
$('rcAccountBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentUser()) return openModal();
  const m = $('rcMenu');
  if (m) m.hidden = !m.hidden;
});
document.addEventListener('click', (e) => {
  const m = $('rcMenu');
  if (m && !m.hidden && !m.contains(e.target) && e.target !== $('rcAccountBtn')) closeMenu();
});
$('rcMenuHome')?.addEventListener('click', () => { closeMenu(); if (location.hash) location.hash = ''; });
$('rcSignOut')?.addEventListener('click', async () => { closeMenu(); await signOut(); });

/* ── login modal ──────────────────────────────────────────────────────────── */
let signUpMode = false;
function setMode(up) {
  signUpMode = up;
  $('rcTitle').textContent = up ? 'Create your account' : 'Welcome back';
  $('rcLede').textContent = up ? 'A home for your daily check-ins and rhythm.' : 'Sign in to pick up where you left off.';
  $('rcSubmit').textContent = up ? 'Create account' : 'Sign in';
  $('rcNameRow').hidden = !up;
  $('rcToggleText').textContent = up ? 'Already have an account?' : 'New to RestCue?';
  $('rcToggleLink').textContent = up ? 'Sign in' : 'Create one';
  $('rcErr').textContent = '';
}
function openModal() { const m = $('rcModal'); if (!m) return; setMode(false); m.hidden = false; closeMenu(); setTimeout(() => $('rcEmail')?.focus(), 60); }
function closeModal() { const m = $('rcModal'); if (m) m.hidden = true; }

$('rcModalClose')?.addEventListener('click', closeModal);
$('rcModal')?.addEventListener('click', (e) => { if (e.target === $('rcModal')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
$('rcToggleLink')?.addEventListener('click', () => setMode(!signUpMode));
$('hSigninGo')?.addEventListener('click', openModal);

async function runAuth(fn) {
  const submit = $('rcSubmit'); const err = $('rcErr');
  if (err) err.textContent = '';
  if (submit) submit.disabled = true;
  try { await fn(); closeModal(); }
  catch (e) { showAuthError(authErrorMessage(e)); }
  finally { if (submit) submit.disabled = false; }
}
$('rcAuthForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const email = $('rcEmail').value.trim(), pass = $('rcPass').value, name = $('rcName').value.trim();
  if (!email || !pass) { $('rcErr').textContent = 'Please fill in your email and password.'; return; }
  runAuth(() => signUpMode ? signUpEmail(name, email, pass) : signInEmail(email, pass));
});
$('rcGoogle')?.addEventListener('click', () => runAuth(signInGoogle));
$('rcGuest')?.addEventListener('click', () => runAuth(signInGuest));
// top-right quick Google sign-in button (same behavior as modal Google button)
$('rcGoogleTop')?.addEventListener('click', () => runAuth(signInGoogle));

// reflect demo vs firebase in the modal footnote
const modeNote = $('rcModeNote');
if (modeNote) modeNote.textContent = mode() === 'firebase'
  ? 'Secured by Firebase Authentication.'
  : 'Demo mode — accounts are stored only in this browser. Add Firebase keys to go live.';

onAuth(renderAccount);

/* ── "Mobile" button + first-login reminder ───────────────────────────────── */
const MOBILE_SEEN = 'restcue-mobile-seen';
let mobileShownThisSession = false;
function showMobileReminder() {
  const r = $('hMobileReminder'); if (!r) return;
  r.hidden = false;
  $('hMobileBtn')?.setAttribute('aria-expanded', 'true');
}
function hideMobileReminder() {
  const r = $('hMobileReminder'); if (!r) return;
  r.hidden = true;
  $('hMobileBtn')?.classList.remove('nudge');
  $('hMobileBtn')?.setAttribute('aria-expanded', 'false');
}
function dismissMobileReminder() {
  hideMobileReminder();
  try { localStorage.setItem(MOBILE_SEEN, '1'); } catch (e) {}
}
// Show the nudge automatically the first time the user is signed in.
function maybeNudgeMobile(u) {
  if (!u || mobileShownThisSession || !$('hMobileBtn')) return;
  let seen = false; try { seen = localStorage.getItem(MOBILE_SEEN) === '1'; } catch (e) {}
  if (seen) return;
  mobileShownThisSession = true;
  $('hMobileBtn').classList.add('nudge');
  showMobileReminder();
}
onAuth(maybeNudgeMobile);

$('hMobileBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const r = $('hMobileReminder');
  if (r && r.hidden) showMobileReminder(); else dismissMobileReminder();
});
$('hMobileDismiss')?.addEventListener('click', dismissMobileReminder);
document.addEventListener('click', (e) => {
  const r = $('hMobileReminder');
  if (r && !r.hidden && !r.contains(e.target) && e.target !== $('hMobileBtn') && !$('hMobileBtn')?.contains(e.target)) hideMobileReminder();
});

/* ── home greeting + check-in (only runs when the home view exists) ────────── */
const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function phaseOf(h) {
  if (h >= 5 && h < 12) return { key: 'morning', greet: 'Good morning', sub: 'A fresh start. How are you arriving into today?', q: 'How heavy does today feel so far?' };
  if (h >= 12 && h < 17) return { key: 'afternoon', greet: 'Good afternoon', sub: 'Midway through. A good moment to check in with yourself.', q: 'How heavy does today feel right now?' };
  if (h >= 17 && h < 22) return { key: 'evening', greet: 'Good evening', sub: 'The day is winding down. Let’s set the tone for the night.', q: 'How did today land on you?' };
  return { key: 'night', greet: 'Resting hours', sub: 'It’s late. Be gentle with yourself — rest is the goal now.', q: 'How spent do you feel tonight?' };
}

const MOODS = [
  ['calm', 'Calm', '#7fae8e'], ['okay', 'Okay', '#8fb4cf'],
  ['tired', 'Tired', '#b3a6d4'], ['tense', 'Tense', '#e3b667'], ['low', 'Low', '#cf8e8e'],
];

function initHome() {
  if (!$('hGreetWord')) return; // home view markup not present
  const now = new Date();
  const p = phaseOf(now.getHours());
  document.documentElement.setAttribute('data-phase', p.key);
  $('hEyebrow').textContent = `${dayNames[now.getDay()]} ${p.key} · ${now.getDate()} ${monthNames[now.getMonth()]}`;
  $('hGreetWord').textContent = p.greet;
  $('hSub').textContent = p.sub;
  $('hCheckQ').textContent = p.q;

  // mood chips
  const moodKey = 'restcue-mood-' + now.toISOString().slice(0, 10);
  let saved = null; try { saved = localStorage.getItem(moodKey); } catch (e) {}
  const wrap = $('hMoods');
  wrap.innerHTML = MOODS.map(([k, label, c]) =>
    `<button class="mood${k === saved ? ' on' : ''}" data-mood="${k}"><span class="dot" style="background:${c}"></span>${label}</button>`).join('');
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('.mood'); if (!b) return;
    wrap.querySelectorAll('.mood').forEach((m) => m.classList.remove('on'));
    b.classList.add('on');
    try { localStorage.setItem(moodKey, b.dataset.mood); } catch (e2) {}
    flashSaved();
  });

  // load slider → effort (shared with the rest of the app)
  const slider = $('homeLoad');
  let t = null;
  slider.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      fetch('/api/effort', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ effort: Number(slider.value) }) }).then(() => {
          if (mode() === 'firebase' && currentUser()) {
            saveUserEffort(Number(slider.value)).catch(() => {});
          }
          flashSaved();
        }).catch(() => {});
    }, 200);
  });

  // pull current effort + a live snapshot
  refreshSnapshot(true);
  setInterval(refreshSnapshot, 20000);
}

let savedTimer = null;
function flashSaved() {
  const el = $('hSaved'); if (!el) return;
  el.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

async function refreshSnapshot(initial) {
  try {
    const { state, effort } = await (await fetch('/api/state')).json();
    if (initial && effort != null && $('homeLoad')) $('homeLoad').value = effort;
    if (!state) return;
    const balance = Math.round(100 - state.strain);
    const b = $('hsBalance');
    if (b) { b.textContent = balance; b.className = 'snap-val ' + (balance >= 55 ? 'good' : balance >= 30 ? 'warn' : 'warn'); }
    const sl = $('hsSleep');
    if (sl) {
      const lbl = state.sleep ? state.sleep.label : '—';
      sl.textContent = lbl;
      sl.className = 'snap-val ' + (state.sleep && state.sleep.state !== 'awake' ? 'rest' : 'good');
      const note = $('hsSleepNote');
      if (note) note.textContent = state.sleep && state.sleep.aboutToSleep ? 'winding down' : 'current state';
    }
    const air = $('hsAir');
    if (air && state.env) {
      air.textContent = (state.env.airScore ?? '—');
      air.className = 'snap-val ' + (state.env.airScore >= 72 ? 'good' : 'warn');
    }
    const src = $('hsSource');
    if (src) src.textContent = state.source === 'hardware' ? 'live sensor' : 'demo data';
  } catch (e) { /* server not ready */ }
}

initHome();
