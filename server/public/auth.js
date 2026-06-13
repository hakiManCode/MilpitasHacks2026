'use strict';
/* ─────────────────────────────────────────────────────────────────────────────
 * RestCue authentication — Firebase-ready, with a local demo fallback.
 *
 * If firebase-config.js holds real credentials we lazy-load the Firebase Auth
 * SDK (Google + Email/Password). If it's still the placeholder, we run a
 * self-contained *demo* auth that stores accounts in localStorage, so login
 * works end-to-end during development before Firebase is wired up.
 *
 * Public surface (identical in both modes):
 *   onAuth(fn)                  subscribe; fires immediately with current user|null
 *   currentUser()              -> user | null   ({ name, email, uid, photo, guest? })
 *   mode()                     -> 'firebase' | 'demo'
 *   signInEmail(email, pass)   -> Promise<user>
 *   signUpEmail(name, email, pass)
 *   signInGoogle()             -> Promise<user>
 *   signInGuest()              -> Promise<user>
 *   signOut()                  -> Promise<void>
 * ───────────────────────────────────────────────────────────────────────────── */
import { FIREBASE_CONFIG } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const configured = !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && !/^YOUR_/.test(FIREBASE_CONFIG.apiKey));

let current = null;
const listeners = new Set();
function emit() { for (const fn of listeners) { try { fn(current); } catch (e) {} } }

export function onAuth(fn) { listeners.add(fn); try { fn(current); } catch (e) {} return () => listeners.delete(fn); }
export function currentUser() { return current; }
export function mode() { return configured ? 'firebase' : 'demo'; }

// ── Firebase compat path (loaded via script tags in index.html) ──────────────────
let fb = null;
async function firebase() {
  if (fb) return fb;
  if (!window.firebase) throw new Error('Firebase SDK not loaded');
  const appInstance = window.firebase.initializeApp(FIREBASE_CONFIG);
  const authMod = window.firebase.auth();
  console.debug('Firebase auth initialized', { configured, authDomain: FIREBASE_CONFIG.authDomain });
  authMod.onAuthStateChanged((u) => {
    current = u ? { name: u.displayName || u.email, email: u.email, uid: u.uid, photo: u.photoURL } : null;
    emit();
  });
  // If sign-in was completed via redirect, capture the result and emit the user.
  authMod.getRedirectResult()
    .then((result) => {
      if (result && result.user) {
        current = { name: result.user.displayName || result.user.email, email: result.user.email, uid: result.user.uid, photo: result.user.photoURL };
        emit();
      }
    })
    .catch(() => {});
  fb = { authMod, appInstance };
  return fb;
}

async function getFirestore() {
  if (!configured) throw new Error('Firestore not configured');
  const f = await firebase();
  if (f.db) return f.db;
  if (!window.firebase || !window.firebase.firestore) throw new Error('Firestore SDK not loaded');
  const db = window.firebase.firestore();
  f.db = db;
  return db;
}

/** Persist a small user document under `users/{uid}` with merge semantics. */
export async function saveUserEffort(effort) {
  if (!configured) return;
  if (!current || !current.uid) throw new Error('No authenticated user');
  const db = await getFirestore();
  await db.collection('users').doc(current.uid).set({ lastEffort: Number(effort), lastUpdated: Date.now() }, { merge: true });
}

export async function getUserData(uid) {
  if (!configured) return null;
  const db = await getFirestore();
  const snap = await db.collection('users').doc(uid).get();
  return snap.exists ? snap.data() : null;
}

// ── Demo path (localStorage) ─────────────────────────────────────────────────
const LS_SESSION = 'restcue-user';
const LS_ACCOUNTS = 'restcue-accounts';
const db = {
  read(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
  write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
function demoRestore() { current = db.read(LS_SESSION, null); }
function demoSet(user) { current = user; db.write(LS_SESSION, user); emit(); return user; }
const uid = () => 'u_' + Math.random().toString(36).slice(2, 10);

// ── unified API ──────────────────────────────────────────────────────────────
export async function signUpEmail(name, email, pass) {
  if (configured) {
    const { authMod } = await firebase();
    const cred = await authMod.createUserWithEmailAndPassword(email, pass);
    if (name) await authMod.updateProfile(cred.user, { displayName: name });
    return current;
  }
  const accounts = db.read(LS_ACCOUNTS, {});
  if (accounts[email]) throw new Error('An account with that email already exists.');
  accounts[email] = { name: name || email.split('@')[0], email, pass, uid: uid() };
  db.write(LS_ACCOUNTS, accounts);
  const { pass: _p, ...u } = accounts[email];
  return demoSet(u);
}

export async function signInEmail(email, pass) {
  if (configured) {
    const { authMod } = await firebase();
    await authMod.signInWithEmailAndPassword(email, pass);
    return current;
  }
  const acc = db.read(LS_ACCOUNTS, {})[email];
  if (!acc || acc.pass !== pass) throw new Error('Wrong email or password.');
  const { pass: _p, ...u } = acc;
  return demoSet(u);
}

export async function signInGoogle() {
  if (configured) {
    const { authMod } = await firebase();
    const provider = new window.firebase.auth.GoogleAuthProvider();
    try {
      await authMod.signInWithPopup(provider);
    } catch (error) {
      if (error?.code === 'auth/popup-blocked' || error?.code === 'auth/cancelled-popup-request') {
        await authMod.signInWithRedirect(provider);
        return current;
      }
      throw error;
    }
    return current;
  }
  // demo: a stand-in Google account so the flow is exercisable offline
  return demoSet({ name: 'Google User', email: 'demo@gmail.com', uid: uid(), photo: null, google: true });
}

export async function signInGuest() {
  if (configured) {
    const { authMod } = await firebase();
    await authMod.signInAnonymously();
    return current;
  }
  return demoSet({ name: 'Guest', email: null, uid: uid(), guest: true });
}

export async function signOut() {
  if (configured) { const { a, authMod } = await firebase(); await authMod.signOut(a); return; }
  try { localStorage.removeItem(LS_SESSION); } catch (e) {}
  current = null; emit();
}

// boot
if (configured) firebase().catch(() => {}); else demoRestore();
