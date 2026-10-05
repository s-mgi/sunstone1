import { SITE } from '../site.config.js';
const COOKIE_NAME = SITE.cookieName;
const SESSION_DAYS = 7;

async function hmac(value, key) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createSessionCookie(env) {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${env.ADMIN_USER}.${exp}`;
  const sig = await hmac(payload, env.ADMIN_PASSWORD);
  const value = `${btoa(payload)}.${sig}`;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE_NAME + '='));
  return match ? match.slice(COOKIE_NAME.length + 1) : null;
}

async function verifySession(cookieHeader, env) {
  const value = readCookie(cookieHeader);
  if (!value) return false;
  const dot = value.lastIndexOf('.');
  if (dot === -1) return false;
  const payloadB64 = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  let payload;
  try { payload = atob(payloadB64); } catch { return false; }
  const expectedSig = await hmac(payload, env.ADMIN_PASSWORD);
  if (sig !== expectedSig) return false;
  const sep = payload.lastIndexOf('.');
  if (sep === -1) return false;
  const user = payload.slice(0, sep);
  const exp = Number(payload.slice(sep + 1));
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  if (user !== env.ADMIN_USER) return false;
  return true;
}

export async function requireAuth(request, env) {
  if (!env.ADMIN_USER || !env.ADMIN_PASSWORD) {
    return unauthorized('Admin auth is not configured (ADMIN_USER / ADMIN_PASSWORD missing).');
  }
  const ok = await verifySession(request.headers.get('Cookie'), env);
  if (!ok) return unauthorized();
  return null;
}

export async function checkLogin(request, env) {
  if (!env.ADMIN_USER || !env.ADMIN_PASSWORD) {
    return { ok: false, error: 'Admin auth is not configured (ADMIN_USER / ADMIN_PASSWORD missing).' };
  }
  let body;
  try { body = await request.json(); } catch { return { ok: false, error: 'Invalid request.' }; }
  if (body.username !== env.ADMIN_USER || body.password !== env.ADMIN_PASSWORD) {
    return { ok: false, error: 'Incorrect username or password.' };
  }
  return { ok: true };
}

function unauthorized(message) {
  return new Response(JSON.stringify({ ok: false, error: message || 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
