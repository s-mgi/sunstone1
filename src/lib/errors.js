import { getSettings, putSetting, logSettingsFrom } from './settings.js';
import { SITE } from '../site.config.js';

export const LOG_AREAS = ['form', 'email', 'analytics', 'site'];
const ALERT_GAP_MINUTES = 15;
const KEEP_RESOLVED_DAYS = 90;

export async function logError(env, { area = 'site', level = 'error', message, detail = '', path = '' }) {
  try {
    if (!env || !env.DB || !message) return;
    area = LOG_AREAS.includes(area) ? area : 'site';
    level = level === 'warning' ? 'warning' : 'error';
    message = String(message).slice(0, 300);
    detail = detailText(detail).slice(0, 4000);
    path = String(path || '').slice(0, 300);

    const same = await env.DB.prepare(
      `SELECT id FROM error_log WHERE resolved = 0 AND area = ? AND message = ? AND last_seen > datetime('now', '-1 day') ORDER BY id DESC LIMIT 1`
    ).bind(area, message).first();
    if (same) {
      await env.DB.prepare(`UPDATE error_log SET count = count + 1, last_seen = datetime('now'), detail = ?, path = ? WHERE id = ?`)
        .bind(detail, path, same.id).run();
    } else {
      await env.DB.prepare('INSERT INTO error_log (area, level, message, detail, path) VALUES (?, ?, ?, ?, ?)')
        .bind(area, level, message, detail, path).run();
      await env.DB.prepare(`DELETE FROM error_log WHERE resolved = 1 AND last_seen < datetime('now', ?)`)
        .bind(`-${KEEP_RESOLVED_DAYS} days`).run();
    }

    if (area === 'form' && level === 'error') await maybeAlert(env, message, detail);
  } catch (err) {
    console.error('logError failed:', err, message);
  }
}

function detailText(detail) {
  if (!detail) return '';
  if (detail instanceof Error) return detail.stack || detail.message || String(detail);
  if (typeof detail === 'string') return detail;
  try { return JSON.stringify(detail); } catch { return String(detail); }
}

async function maybeAlert(env, message, detail) {
  const settings = await getSettings(env);
  const prefs = logSettingsFrom(settings);
  if (!prefs.email_alerts) return;
  const to = String(prefs.alert_to || env.TO_EMAIL || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!to.length || !env.RESEND_API_KEY || !env.FROM_EMAIL) return;

  const last = Number(settings.logs_last_alert || 0);
  if (Date.now() - last < ALERT_GAP_MINUTES * 60 * 1000) return;
  await putSetting(env, 'logs_last_alert', Date.now());

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.FROM_EMAIL,
        to,
        subject: `[${SITE.name}] Form error: ${message}`.slice(0, 200),
        html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.5;">
<p><strong>${esc(message)}</strong></p>
${detail ? `<pre style="white-space:pre-wrap;background:#f4f4f4;padding:10px;border-radius:4px;font-size:12px;">${esc(detail.slice(0, 1500))}</pre>` : ''}
<p>Open the dashboard's Logs tab for details. You'll get at most one of these every ${ALERT_GAP_MINUTES} minutes.</p></div>`,
      }),
    });
    if (!res.ok) console.error('Error alert email failed:', res.status, await res.text());
  } catch (err) {
    console.error('Error alert email failed:', err);
  }
}

const CLIENT_KINDS = {
  register_copy_failed: { area: 'form', message: "A registration didn't reach the CMS from the visitor's browser" },
};

export async function handleClientError(request, env) {
  let body = {};
  try { body = await request.json(); } catch { return new Response(null, { status: 204 }); }
  const kind = CLIENT_KINDS[body.kind];
  if (!kind) return new Response(null, { status: 204 });
  const clip = (v, n) => String(v ?? '').slice(0, n);
  const detail = [
    `Status: ${clip(body.status, 40) || 'unknown'}`,
    body.missing ? `Missing fields: ${clip(body.missing, 300)}` : '',
    body.error ? `Error: ${clip(body.error, 300)}` : '',
    'Keap may still have received this lead. Check Keap for the same time.',
    `Browser: ${clip(request.headers.get('user-agent'), 200)}`,
  ].filter(Boolean).join('\n');
  await logError(env, { ...kind, detail, path: clip(body.page, 200) });
  return new Response(null, { status: 204 });
}

export async function listErrors(request, env) {
  const url = new URL(request.url);
  const area = url.searchParams.get('area');
  const show = url.searchParams.get('show') || 'open';
  const clauses = [];
  const binds = [];
  if (area && LOG_AREAS.includes(area)) { clauses.push('area = ?'); binds.push(area); }
  if (show === 'open') clauses.push('resolved = 0');
  if (show === 'resolved') clauses.push('resolved = 1');
  let query = 'SELECT * FROM error_log';
  if (clauses.length) query += ' WHERE ' + clauses.join(' AND ');
  query += ' ORDER BY last_seen DESC LIMIT 300';
  const { results } = await env.DB.prepare(query).bind(...binds).all();
  const open = await env.DB.prepare('SELECT COUNT(*) AS n FROM error_log WHERE resolved = 0').first();
  return json({ ok: true, entries: results, open: open ? open.n : 0 });
}

export async function patchError(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON body.' }, 400); }
  await env.DB.prepare('UPDATE error_log SET resolved = ? WHERE id = ?').bind(body.resolved ? 1 : 0, id).run();
  return json({ ok: true });
}

export async function resolveAllErrors(env) {
  const res = await env.DB.prepare('UPDATE error_log SET resolved = 1 WHERE resolved = 0').run();
  return json({ ok: true, resolved: res.meta ? res.meta.changes : null });
}

export async function openErrorCount(env) {
  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM error_log WHERE resolved = 0').first();
    return row ? row.n : 0;
  } catch { return 0; }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
