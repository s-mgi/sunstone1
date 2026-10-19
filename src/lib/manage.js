// Manage tab and the signed-in user's own account: users, roles, optional
// usernames (admin_usernames, migration 0004), feature switches, tag and log
// settings, /api/me (GET returns the user, switches, version and changelog;
// PATCH lets a Manage user change their own name, email and username).
import { hashPassword, createSessionCookie } from './auth.js';
import { FEATURES, PERMISSIONS, EDITABLE_ROLES, getSettings, putSetting, featuresFrom, tagsFrom, logSettingsFrom, permissionsFrom, userPermissions } from './settings.js';
import { openErrorCount } from './errors.js';
import { validateTags } from './tags.js';
import { CMS_VERSION, CHANGELOG } from '../version.js';

const ROLES = ['admin', 'manager', 'editor'];
const ROLE_NAMES = { admin: 'Admin', manager: 'Manager', editor: 'Editor' };
const isAdmin = (u) => !!u.owner || u.role === 'admin';
const MIN_PASSWORD = 10;

function cleanUsername(env, value) {
  const u = String(value || '').trim().toLowerCase();
  if (!u) return { username: '' };
  if (!/^[a-z0-9._-]{3,30}$/.test(u)) return { error: 'Usernames are 3 to 30 characters: letters, numbers, dots, dashes or underscores, no spaces.' };
  if (u === String(env.ADMIN_USER || '').trim().toLowerCase()) return { error: 'That username is already the owner login.' };
  return { username: u };
}

async function usernameTaken(env, username, exceptId) {
  const row = await env.DB.prepare('SELECT user_id FROM admin_usernames WHERE username = ?').bind(username).first();
  return !!row && row.user_id !== exceptId;
}

async function saveUsername(env, id, username) {
  if (username) await env.DB.prepare('INSERT INTO admin_usernames (user_id, username) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET username = excluded.username').bind(id, username).run();
  else await env.DB.prepare('DELETE FROM admin_usernames WHERE user_id = ?').bind(id).run();
}

const NEEDS_0003 = 'Usernames need the database update first: run migrations/0004_password_resets_usernames.sql in the D1 console.';

export async function me(env, user) {
  const settings = await getSettings(env);
  const out = {
    ok: true,
    user: { name: user.name, email: user.email, role: user.role, owner: !!user.owner, login: user.owner ? String(env.ADMIN_USER || '').trim() : user.email, username: '' },
    features: featuresFrom(settings),
    permissions: userPermissions(user, settings),
    permissionList: PERMISSIONS,
    featureList: FEATURES,
    version: CMS_VERSION,
    changelog: CHANGELOG,
  };
  if (!user.owner) {
    try {
      const n = await env.DB.prepare('SELECT username FROM admin_usernames WHERE user_id = ?').bind(user.id).first();
      out.user.username = n ? n.username : '';
      out.usernames = true;
    } catch { out.usernames = false; }
  }
  if (out.permissions.logs) out.openErrors = await openErrorCount(env);
  return json(out);
}

export async function updateMe(request, env, user) {
  if (user.owner) return json({ ok: false, error: 'The owner login is set in Cloudflare (ADMIN_USER and ADMIN_PASSWORD).' }, 400);
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  const row = await env.DB.prepare('SELECT * FROM admin_users WHERE id = ?').bind(user.id).first();
  if (!row) return json({ ok: false, error: 'User not found.' }, 404);

  const sets = [];
  const binds = [];
  const notes = [];
  if (typeof body.name === 'string' && body.name.trim().slice(0, 100) !== (row.name || '')) { sets.push('name = ?'); binds.push(body.name.trim().slice(0, 100)); notes.push('name'); }
  if (typeof body.email === 'string') {
    const email = body.email.trim().toLowerCase();
    if (email !== String(row.email).toLowerCase()) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'Enter a valid email address.' }, 400);
      if (email === String(env.ADMIN_USER || '').trim().toLowerCase()) return json({ ok: false, error: 'That email is already the owner login.' }, 400);
      const { hash } = await hashPassword(String(body.current || ''), row.pass_salt);
      if (hash !== row.pass_hash) return json({ ok: false, error: 'Enter your current password to change your email.' }, 400);
      const exists = await env.DB.prepare('SELECT id FROM admin_users WHERE lower(email) = ? AND id != ?').bind(email, row.id).first();
      if (exists) return json({ ok: false, error: 'There is already a user with that email.' }, 400);
      sets.push('email = ?'); binds.push(email); notes.push(`email ${row.email} → ${email}`);
    }
  }
  if (body.username !== undefined) {
    const un = cleanUsername(env, body.username);
    if (un.error) return json({ ok: false, error: un.error }, 400);
    try {
      const cur = await env.DB.prepare('SELECT username FROM admin_usernames WHERE user_id = ?').bind(row.id).first();
      if ((cur ? cur.username : '') !== un.username) {
        if (un.username && await usernameTaken(env, un.username, row.id)) return json({ ok: false, error: 'Someone already has that username.' }, 400);
        await saveUsername(env, row.id, un.username);
        notes.push(un.username ? `username ${un.username}` : 'username removed');
      }
    } catch { if (un.username) return json({ ok: false, error: NEEDS_0003 }, 400); }
  }
  if (sets.length) await env.DB.prepare(`UPDATE admin_users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, row.id).run();
  if (notes.length) await logEdit(env, user, 'user', String(row.id), null, row.email, `updated own account: ${notes.join(', ')}`);
  return json({ ok: true, changed: notes.length > 0 });
}

export async function listUsers(env) {
  try {
    const { results } = await env.DB.prepare('SELECT u.id, u.created_at, u.email, u.name, u.role, u.disabled, u.last_login, n.username FROM admin_users u LEFT JOIN admin_usernames n ON n.user_id = u.id ORDER BY u.created_at').all();
    return json({ ok: true, users: results, usernames: true });
  } catch {
    const { results } = await env.DB.prepare('SELECT id, created_at, email, name, role, disabled, last_login FROM admin_users ORDER BY created_at').all();
    return json({ ok: true, users: results, usernames: false });
  }
}

export async function createUser(request, env, editor) {
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim().slice(0, 100);
  const role = ROLES.includes(body.role) ? body.role : 'editor';
  if (role === 'admin' && !isAdmin(editor)) return json({ ok: false, error: 'Only an admin can add another admin.' }, 403);
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'Enter a valid email address. It is what they sign in with.' }, 400);
  if (email === String(env.ADMIN_USER || '').toLowerCase()) return json({ ok: false, error: 'That email is already the owner login.' }, 400);
  if (password.length < MIN_PASSWORD) return json({ ok: false, error: `Passwords need at least ${MIN_PASSWORD} characters.` }, 400);
  const exists = await env.DB.prepare('SELECT id FROM admin_users WHERE lower(email) = ?').bind(email).first();
  if (exists) return json({ ok: false, error: 'There is already a user with that email.' }, 400);
  const un = cleanUsername(env, body.username);
  if (un.error) return json({ ok: false, error: un.error }, 400);
  if (un.username) {
    try { if (await usernameTaken(env, un.username, -1)) return json({ ok: false, error: 'Someone already has that username.' }, 400); }
    catch { return json({ ok: false, error: NEEDS_0003 }, 400); }
  }

  const { hash, salt } = await hashPassword(password);
  const res = await env.DB.prepare('INSERT INTO admin_users (email, name, role, pass_hash, pass_salt) VALUES (?, ?, ?, ?, ?)')
    .bind(email, name, role, hash, salt).run();
  if (un.username) await saveUsername(env, res.meta.last_row_id, un.username);
  await logEdit(env, editor, 'user', String(res.meta.last_row_id), null, `${email} (${role})`, un.username ? `user added, username ${un.username}` : 'user added');
  return json({ ok: true, id: res.meta.last_row_id });
}

export async function patchUser(request, env, editor, id) {
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  const row = await env.DB.prepare('SELECT * FROM admin_users WHERE id = ?').bind(id).first();
  if (!row) return json({ ok: false, error: 'User not found.' }, 404);
  const self = !editor.owner && editor.id === row.id;
  if (row.role === 'admin' && !isAdmin(editor)) return json({ ok: false, error: 'Only an admin can change an admin account.' }, 403);

  const sets = [];
  const binds = [];
  const notes = [];
  let bump = false;
  if (typeof body.name === 'string' && body.name.trim() !== row.name) { sets.push('name = ?'); binds.push(body.name.trim().slice(0, 100)); notes.push('name'); }
  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) return json({ ok: false, error: 'Unknown role.' }, 400);
    if (self && body.role !== row.role) return json({ ok: false, error: "You can't change your own role." }, 400);
    if (body.role === 'admin' && !isAdmin(editor)) return json({ ok: false, error: 'Only an admin can make someone an admin.' }, 403);
    if (body.role !== row.role) { sets.push('role = ?'); binds.push(body.role); notes.push(`role ${ROLE_NAMES[row.role] || row.role} → ${ROLE_NAMES[body.role]}`); bump = true; }
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
  if (body.username !== undefined) {
    const un = cleanUsername(env, body.username);
    if (un.error) return json({ ok: false, error: un.error }, 400);
    try {
      const cur = await env.DB.prepare('SELECT username FROM admin_usernames WHERE user_id = ?').bind(id).first();
      if ((cur ? cur.username : '') !== un.username) {
        if (un.username && await usernameTaken(env, un.username, id)) return json({ ok: false, error: 'Someone already has that username.' }, 400);
        await saveUsername(env, id, un.username);
        notes.push(un.username ? `username ${un.username}` : 'username removed');
      }
    } catch { if (un.username) return json({ ok: false, error: NEEDS_0003 }, 400); }
  }
  if (!sets.length) {
    if (notes.length) await logEdit(env, editor, 'user', String(id), null, row.email, notes.join(', '));
    return json({ ok: true });
  }
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
  if (row.role === 'admin' && !isAdmin(editor)) return json({ ok: false, error: 'Only an admin can remove an admin account.' }, 403);
  await env.DB.prepare('DELETE FROM admin_users WHERE id = ?').bind(id).run();
  try { await env.DB.prepare('DELETE FROM admin_usernames WHERE user_id = ?').bind(id).run(); } catch {}
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
  return json({ ok: true, features: featuresFrom(settings), featureList: FEATURES, tags: tagsFrom(settings), logs: logSettingsFrom(settings), permissions: permissionsFrom(settings), permissionList: PERMISSIONS });
}

export async function putPermissions(request, env, editor) {
  if (!isAdmin(editor)) return json({ ok: false, error: 'Only an admin can change what roles can do.' }, 403);
  const body = await readJson(request);
  if (!body || typeof body.permissions !== 'object') return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  const current = permissionsFrom(await getSettings(env));
  const next = {};
  const changed = [];
  for (const role of EDITABLE_ROLES) {
    next[role] = {};
    for (const p of PERMISSIONS) {
      const v = body.permissions[role] && body.permissions[role][p.key];
      next[role][p.key] = typeof v === 'boolean' ? v : current[role][p.key];
      if (next[role][p.key] !== current[role][p.key]) changed.push(`${ROLE_NAMES[role]} ${next[role][p.key] ? 'can' : "can't"} use ${p.label}`);
    }
  }
  await putSetting(env, 'permissions', next);
  if (changed.length) await logEdit(env, editor, 'settings', 'permissions', null, null, changed.join(', '));
  return json({ ok: true, permissions: next });
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
