/**
 * Minimal stand-in for the hosted edition's app store: the console is protected by one ADMIN_TOKEN
 * (see .env), kept in localStorage. `useAppStore()` works as a hook, `useAppStore.getState()` as a getter.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'eca_admin_token';
const listeners = new Set<() => void>();
const read = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
let token = read();

function setToken(next: string) {
  token = next;
  try { if (next) localStorage.setItem(KEY, next); else localStorage.removeItem(KEY); } catch { /* ignore */ }
  for (const l of Array.from(listeners)) l();
}

function snapshot() {
  return { token, user: token ? { email: 'owner' } : null, logout: () => setToken(''), login: setToken };
}
let cached = snapshot();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const get = () => { if (cached.token !== token) cached = snapshot(); return cached; };

export function useAppStore() { return useSyncExternalStore(subscribe, get, get); }
useAppStore.getState = get;
