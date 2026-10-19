import { SITE } from '../site.config.js';
import { hashPassword } from './auth.js';
import { logError } from './errors.js';

const MIN_PASSWORD = 10;
const LINK_MINUTES = 30;
const MAX_PER_HOUR = 3;
const SENT = 'If that matches a dashboard login, a reset link is on its way to its email. Check your inbox (and spam) in a minute.';

async function sha256(text) {
  const bits = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function requestReset(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid request.' }, 400); }
  const login = String(body.email || '').trim().toLowerCase();
  if (!login) return json({ ok: false, error: 'Enter your email or username.' }, 400);

  let user = null;
  try {
    user = await env.DB.prepare('SELECT id, email, name, disabled FROM admin_users WHERE lower(email) = ?').bind(login).first();
    if (!user && !login.includes('@')) {
      try { user = await env.DB.prepare('SELECT u.id, u.email, u.name, u.disabled FROM admin_users u JOIN admin_usernames n ON n.user_id = u.id WHERE n.username = ?').bind(login).first(); } catch {}
    }
  } catch (err) {
    await logError(env, { area: 'site', message: 'Password reset failed: the login tables are missing', detail: err });
    return json({ ok: true, message: SENT });
  }
  if (!user || user.disabled) return json({ ok: true, message: SENT });

  const recent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created_at > datetime('now', '-1 hour')`).bind(user.id).first();
  if (recent && recent.n >= MAX_PER_HOUR) return json({ ok: true, message: SENT });

  const token = newToken();
  await env.DB.prepare(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`)
    .bind(await sha256(token), user.id, `+${LINK_MINUTES} minutes`).run();

  if (!env.RESEND_API_KEY || !env.FROM_EMAIL) {
    await logError(env, { area: 'email', message: 'A password reset email could not be sent: Resend is not set up', detail: `Requested for ${user.email}. Add RESEND_API_KEY and FROM_EMAIL in Cloudflare.` });
    return json({ ok: true, message: SENT });
  }

  const link = `${new URL(request.url).origin}/login.html?reset=${token}`;
  const from = /[<>]/.test(env.FROM_EMAIL) ? env.FROM_EMAIL : `${(env.FROM_NAME || SITE.name).trim()} <${env.FROM_EMAIL}>`;
  const c = SITE.colors;
  const html = `<div style="background:${c.bg};padding:32px 16px;font-family:Helvetica,Arial,sans-serif;">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px 24px;color:${c.text};font-size:15px;line-height:1.55;">
<p style="margin:0 0 16px;font-size:18px;font-weight:bold;color:${c.ink};">Reset your dashboard password</p>
<p style="margin:0 0 16px;">Hi ${esc(user.name || user.email)}, someone asked to reset the password for your ${esc(SITE.name)} dashboard login.</p>
<p style="margin:0 0 20px;"><a href="${esc(link)}" style="display:inline-block;background:${c.brand};color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:5px;">Choose a new password</a></p>
<p style="margin:0 0 8px;font-size:13px;color:${c.muted};">The link works once and expires in ${LINK_MINUTES} minutes. If you didn't ask for this, ignore this email and your password stays the same.</p>
</div></div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [user.email],
        subject: `Reset your ${SITE.name} dashboard password`,
        html,
        text: `Reset your ${SITE.name} dashboard password: ${link}\n\nThe link works once and expires in ${LINK_MINUTES} minutes. If you didn't ask for this, ignore this email.`,
      }),
    });
    if (!res.ok) await logError(env, { area: 'email', message: 'A password reset email was rejected by Resend', detail: `To ${user.email}. Resend said (${res.status}): ${await res.text()}` });
  } catch (err) {
    await logError(env, { area: 'email', message: 'A password reset email could not be sent', detail: err });
  }
  return json({ ok: true, message: SENT });
}

export async function confirmReset(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid request.' }, 400); }
  const token = String(body.token || '');
  const password = String(body.password || '');
  const expired = json({ ok: false, error: 'This reset link has expired or was already used. Ask for a new one.' }, 400);
  if (!token) return expired;
  if (password.length < MIN_PASSWORD) return json({ ok: false, error: `Passwords need at least ${MIN_PASSWORD} characters.` }, 400);

  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`SELECT r.user_id, u.email, u.name, u.disabled FROM password_resets r JOIN admin_users u ON u.id = r.user_id WHERE r.token_hash = ? AND r.used = 0 AND r.expires_at > datetime('now')`).bind(tokenHash).first();
  if (!row || row.disabled) return expired;

  const { hash, salt } = await hashPassword(password);
  await env.DB.prepare('UPDATE admin_users SET pass_hash = ?, pass_salt = ?, session_ver = session_ver + 1 WHERE id = ?').bind(hash, salt, row.user_id).run();
  await env.DB.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ?').bind(row.user_id).run();
  try {
    await env.DB.prepare('INSERT INTO edit_log (editor, entity_type, entity_key, old_value, new_value, note) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(row.name || row.email, 'user', String(row.user_id), null, row.email, 'reset password by email').run();
  } catch (err) { console.error('edit_log insert failed:', err); }
  return json({ ok: true, email: row.email });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
