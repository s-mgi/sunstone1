import { SITE } from '../site.config.js';
const COOKIE_NAME = SITE.cookieName;
const SESSION_DAYS = 7;
const PBKDF2_ITERATIONS = 100000;

async function hmac(value, key) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(value));
  return b64url(new Uint8Array(sig));
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sameString(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return { hash: btoa(String.fromCharCode(...new Uint8Array(bits))), salt: btoa(String.fromCharCode(...salt)) };
}

function ownerUser(env) {
  return { id: 0, owner: true, name: env.ADMIN_USER, email: '', role: 'admin' };
}

export async function createSessionCookie(env, user) {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const who = user && !user.owner ? `u|${user.id}|${user.session_ver}` : env.ADMIN_USER;
  const payload = `${who}.${exp}`;
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

export async function getUser(request, env) {
  if (!env.ADMIN_USER || !env.ADMIN_PASSWORD) return null;
  const value = readCookie(request.headers.get('Cookie'));
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot === -1) return null;
  let payload;
  try { payload = atob(value.slice(0, dot)); } catch { return null; }
  const expectedSig = await hmac(payload, env.ADMIN_PASSWORD);
  if (!sameString(value.slice(dot + 1), expectedSig)) return null;
  const sep = payload.lastIndexOf('.');
  if (sep === -1) return null;
  const who = payload.slice(0, sep);
  const exp = Number(payload.slice(sep + 1));
  if (!Number.isFinite(exp) || Date.now() > exp) return null;

  if (who === env.ADMIN_USER) return ownerUser(env);
  const m = /^u\|(\d+)\|(\d+)$/.exec(who);
  if (!m || !env.DB) return null;
  const row = await env.DB.prepare('SELECT id, email, name, role, session_ver, disabled FROM admin_users WHERE id = ?').bind(Number(m[1])).first();
  if (!row || row.disabled || String(row.session_ver) !== m[2]) return null;
  return { id: row.id, owner: false, name: row.name || row.email, email: row.email, role: row.role === 'admin' ? 'admin' : 'editor', session_ver: row.session_ver };
}

export async function checkLogin(request, env) {
  if (!env.ADMIN_USER || !env.ADMIN_PASSWORD) {
    return { ok: false, error: 'Admin auth is not configured (ADMIN_USER / ADMIN_PASSWORD missing).' };
  }
  let body;
  try { body = await request.json(); } catch { return { ok: false, error: 'Invalid request.' }; }
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const fail = { ok: false, error: 'Incorrect username or password.' };
  if (!username || !password) return fail;

  if (sameString(username, env.ADMIN_USER) && sameString(password, env.ADMIN_PASSWORD)) return { ok: true, user: ownerUser(env) };

  if (!env.DB) return fail;
  let row = null;
  try {
    row = await env.DB.prepare('SELECT * FROM admin_users WHERE lower(email) = ?').bind(username.toLowerCase()).first();
  } catch (err) {
    console.error('admin_users lookup failed (has migration 0003 run?):', err);
    return fail;
  }
  if (!row || row.disabled) return fail;
  const { hash } = await hashPassword(password, row.pass_salt);
  if (!sameString(hash, row.pass_hash)) return fail;
  await env.DB.prepare(`UPDATE admin_users SET last_login = datetime('now') WHERE id = ?`).bind(row.id).run();
  return { ok: true, user: { id: row.id, owner: false, name: row.name || row.email, email: row.email, role: row.role, session_ver: row.session_ver } };
}

export function unauthorized(message, status = 401) {
  return new Response(JSON.stringify({ ok: false, error: message || 'Unauthorized' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
