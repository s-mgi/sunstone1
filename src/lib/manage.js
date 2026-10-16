import { hashPassword, createSessionCookie } from './auth.js';
import { FEATURES, getSettings, putSetting, featuresFrom, tagsFrom, logSettingsFrom } from './settings.js';
import { openErrorCount } from './errors.js';
import { validateTags } from './tags.js';
import { CMS_VERSION, CHANGELOG } from '../version.js';

const ROLES = ['admin', 'editor'];
const MIN_PASSWORD = 10;

export async function me(env, user) {
  const settings = await getSettings(env);
  const out = {
    ok: true,
    user: { name: user.name, email: user.email, role: user.role, owner: !!user.owner },
    features: featuresFrom(settings),
    featureList: FEATURES,
    version: CMS_VERSION,
    changelog: CHANGELOG,
  };
  if (user.role === 'admin') out.openErrors = await openErrorCount(env);
  return json(out);
}

export async function listUsers(env) {
  const { results } = await env.DB.prepare('SELECT id, created_at, email, name, role, disabled, last_login FROM admin_users ORDER BY created_at').all();
  return json({ ok: true, users: results });
}

export async function createUser(request, env, editor) {
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim().slice(0, 100);
  const role = ROLES.includes(body.role) ? body.role : 'editor';
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'Enter a valid email address. It is what they sign in with.' }, 400);
  if (email === String(env.ADMIN_USER || '').toLowerCase()) return json({ ok: false, error: 'That email is already the owner login.' }, 400);
  if (password.length < MIN_PASSWORD) return json({ ok: false, error: `Passwords need at least ${MIN_PASSWORD} characters.` }, 400);
  const exists = await env.DB.prepare('SELECT id FROM admin_users WHERE lower(email) = ?').bind(email).first();
  if (exists) return json({ ok: false, error: 'There is already a user with that email.' }, 400);

  const { hash, salt } = await hashPassword(password);
  const res = await env.DB.prepare('INSERT INTO admin_users (email, name, role, pass_hash, pass_salt) VALUES (?, ?, ?, ?, ?)')
    .bind(email, name, role, hash, salt).run();
  await logEdit(env, editor, 'user', String(res.meta.last_row_id), null, `${email} (${role})`, 'user added');
  return json({ ok: true, id: res.meta.last_row_id });
}

export async function patchUser(request, env, editor, id) {
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  const row = await env.DB.prepare('SELECT * FROM admin_users WHERE id = ?').bind(id).first();
  if (!row) return json({ ok: false, error: 'User not found.' }, 404);
  const self = !editor.owner && editor.id === row.id;

  const sets = [];
  const binds = [];
  const notes = [];
  let bump = false;
  if (typeof body.name === 'string' && body.name.trim() !== row.name) { sets.push('name = ?'); binds.push(body.name.trim().slice(0, 100)); notes.push('name'); }
  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) return json({ ok: false, error: 'Unknown role.' }, 400);
    if (self && body.role !== 'admin') return json({ ok: false, error: "You can't remove your own admin access." }, 400);
    if (body.role !== row.role) { sets.push('role = ?'); binds.push(body.role); notes.push(`role ${row.role} → ${body.role}`); bump = true; }
  }
  if (body.disabled !== undefined && (body.disabled ? 1 : 0) !== (row.disabled ? 1 : 0)) {
    if (self && body.disabled) return json({ ok: false, error: "You can't turn off your own account." }, 400);
    sets.push('disabled = ?'); binds.push(body.disabled ? 1 : 0); notes.push(body.disabled ? 'turned off' : 'turned on'); bump = true;
  }
  if (body.password !== undefined) {
    const password = String(body.password || '');
    if (password.length < MIN_PASSWORD) return json({ ok: false, error: `Passwords need at least ${MIN_PASSWORD} characters.` }, 400);
    const { hash, salt } = await hashPassword(password);
    sets.push('pass_hash = ?', 'pass_salt = ?'); binds.push(hash, salt); notes.push('password reset'); bump = true;
  }
  if (!sets.length) return json({ ok: true });
  if (bump) sets.push('session_ver = session_ver + 1');
  await env.DB.prepare(`UPDATE admin_users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id).run();
  await logEdit(env, editor, 'user', String(id), null, row.email, notes.join(', '));

  const headers = {};
  if (self && bump) {
    const fresh = await env.DB.prepare('SELECT * FROM admin_users WHERE id = ?').bind(id).first();
    headers['Set-Cookie'] = await createSessionCookie(env, { id: fresh.id, session_ver: fresh.session_ver });
  }
  return json({ ok: true }, 200, headers);
}

export async function deleteUser(env, editor, id) {
  const row = await env.DB.prepare('SELECT * FROM admin_users WHERE id = ?').bind(id).first();
  if (!row) return json({ ok: false, error: 'User not found.' }, 404);
  if (!editor.owner && editor.id === row.id) return json({ ok: false, error: "You can't remove your own account." }, 400);
  await env.DB.prepare('DELETE FROM admin_users WHERE id = ?').bind(id).run();
  await logEdit(env, editor, 'user', String(id), row.email, null, 'user removed');
  return json({ ok: true });
}

export async function changeOwnPassword(request, env, user) {
  if (user.owner) return json({ ok: false, error: 'The owner password is set in Cloudflare (ADMIN_PASSWORD).' }, 400);
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  const row = await env.DB.prepare('SELECT * FROM admin_users WHERE id = ?').bind(user.id).first();
  const { hash: currentHash } = await hashPassword(String(body.current || ''), row.pass_salt);
  if (currentHash !== row.pass_hash) return json({ ok: false, error: 'Your current password is not right.' }, 400);
  const next = String(body.next || '');
  if (next.length < MIN_PASSWORD) return json({ ok: false, error: `Passwords need at least ${MIN_PASSWORD} characters.` }, 400);
  const { hash, salt } = await hashPassword(next);
  await env.DB.prepare('UPDATE admin_users SET pass_hash = ?, pass_salt = ?, session_ver = session_ver + 1 WHERE id = ?').bind(hash, salt, user.id).run();
  await logEdit(env, user, 'user', String(user.id), null, row.email, 'changed own password');
  const cookie = await createSessionCookie(env, { id: row.id, session_ver: row.session_ver + 1 });
  return json({ ok: true }, 200, { 'Set-Cookie': cookie });
}

export async function getAdminSettings(env) {
  const settings = await getSettings(env);
  return json({ ok: true, features: featuresFrom(settings), featureList: FEATURES, tags: tagsFrom(settings), logs: logSettingsFrom(settings) });
}

export async function putFeatures(request, env, editor) {
  const body = await readJson(request);
  if (!body || typeof body.features !== 'object') return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  const current = featuresFrom(await getSettings(env));
  const next = {};
  for (const f of FEATURES) next[f.key] = body.features[f.key] === undefined ? current[f.key] : !!body.features[f.key];
  await putSetting(env, 'features', next);
  const changed = FEATURES.filter((f) => next[f.key] !== current[f.key]).map((f) => `${f.label} ${next[f.key] ? 'on' : 'off'}`);
  if (changed.length) await logEdit(env, editor, 'settings', 'features', null, null, changed.join(', '));
  return json({ ok: true, features: next });
}

export async function putTags(request, env, editor) {
  const body = await readJson(request);
  if (!body || typeof body.tags !== 'object') return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  const result = validateTags(body.tags);
  if (!result.ok) return json({ ok: false, error: result.errors.join(' ') , errors: result.errors }, 400);
  const before = tagsFrom(await getSettings(env));
  await putSetting(env, 'tags', result.tags);
  const changed = Object.keys(result.tags).filter((k) => JSON.stringify(result.tags[k]) !== JSON.stringify(before[k]));
  if (changed.length) await logEdit(env, editor, 'settings', 'tags', null, null, `tags changed: ${changed.join(', ')}`);
  return json({ ok: true, tags: result.tags, warnings: result.warnings });
}

export async function putLogSettings(request, env, editor) {
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  const alertTo = String(body.alert_to || '').trim().slice(0, 500);
  const bad = alertTo.split(',').map((s) => s.trim()).filter(Boolean).find((s) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  if (bad) return json({ ok: false, error: `"${bad}" isn't a valid email address.` }, 400);
  const next = { email_alerts: !!body.email_alerts, alert_to: alertTo };
  await putSetting(env, 'logs', next);
  await logEdit(env, editor, 'settings', 'logs', null, null, `error emails ${next.email_alerts ? 'on' : 'off'}`);
  return json({ ok: true, logs: next });
}

async function logEdit(env, editor, type, key, oldValue, newValue, note) {
  try {
    await env.DB.prepare('INSERT INTO edit_log (editor, entity_type, entity_key, old_value, new_value, note) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(editor.name || 'admin', type, key, oldValue, newValue, note).run();
  } catch (err) { console.error('edit_log insert failed:', err); }
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function json(obj, status = 200, extraHeaders) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) } });
}
