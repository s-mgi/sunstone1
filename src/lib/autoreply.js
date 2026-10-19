import { signToken } from './eblast.js';
import { SITE } from '../site.config.js';
import { logError } from './errors.js';
import { getFeatures } from './settings.js';

const MAILING_ADDRESS = [SITE.company, ...SITE.mailingAddress].filter(Boolean);
const DEFAULT_REPLY_TO = SITE.defaultReplyTo;

const C = { ...SITE.colors, maroon: SITE.colors.brand, gold: SITE.colors.accent };

const FIELDS = { subject: 150, preheader: 200, heading: 120, greeting: 120, message: 1500, note: 1500, photo: 500, photo_alt: 300 };

export function autoReplyDefaults() {
  return {
    subject: SITE.autoReplySubject,
    preheader: `${SITE.autoReplyIntro} ${SITE.name} ${SITE.byline}`.trim(),
    heading: 'Thank you for registering!',
    greeting: 'Hi {first_name},',
    message: SITE.autoReplyIntro,
    note: "Please add {sender} to your safe senders list to make sure you don't miss any future emails with exciting news and exclusive updates.",
    photo: SITE.emailHero,
    photo_alt: SITE.emailHeroAlt,
  };
}

function cleanSettings(input) {
  const out = {};
  for (const [k, max] of Object.entries(FIELDS)) {
    if (input && typeof input[k] === 'string') out[k] = input[k].replace(/\r\n?/g, '\n').trim().slice(0, max);
  }
  return out;
}

async function savedSettings(env) {
  const { results } = await env.DB.prepare(`SELECT key, value FROM content_fields WHERE key LIKE 'autoreply\\_%' ESCAPE '\\'`).all();
  const out = {};
  for (const r of results || []) out[r.key.slice('autoreply_'.length)] = r.value;
  return cleanSettings(out);
}

const OPTIONAL = new Set(['preheader', 'greeting', 'note', 'photo']);
const NONE = '(none)';

function withDefaults(saved) {
  const d = autoReplyDefaults();
  const out = {};
  for (const k of Object.keys(FIELDS)) out[k] = saved[k] === NONE ? '' : (saved[k] ? saved[k] : d[k]);
  return out;
}

export async function getAutoReplySettings(env) {
  const saved = await savedSettings(env);
  const features = await getFeatures(env);
  return json({
    ok: true,
    settings: withDefaults(saved),
    defaults: autoReplyDefaults(),
    enabled: !!features.autoreply && env.AUTOREPLY_ENABLED !== 'false',
    disabledBy: env.AUTOREPLY_ENABLED === 'false' ? 'variable' : (features.autoreply ? null : 'feature'),
    emailReady: !!(env.RESEND_API_KEY && env.FROM_EMAIL),
    brand: { name: SITE.name, byline: SITE.byline || '' },
  });
}

export async function putAutoReplySettings(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON body.' }, 400); }
  const next = cleanSettings(body.settings || {});
  const d = autoReplyDefaults();
  if (next.subject === '') return json({ ok: false, error: 'The subject line can\'t be empty.' }, 400);
  const before = await savedSettings(env);
  const editor = (env.CURRENT_USER && env.CURRENT_USER.name) || env.ADMIN_USER || 'admin';
  const stmts = [];
  for (const [k, v] of Object.entries(next)) {
    const value = v === d[k] ? '' : (v === '' && OPTIONAL.has(k) ? NONE : v);
    if ((before[k] || '') === value) continue;
    const key = `autoreply_${k}`;
    stmts.push(env.DB.prepare(`INSERT INTO content_fields (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(key, value));
    stmts.push(env.DB.prepare('INSERT INTO edit_log (editor, entity_type, entity_key, old_value, new_value, note) VALUES (?, ?, ?, ?, ?, ?)').bind(editor, 'content_field', key, before[k] || null, value || null, 'Auto-reply email'));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return getAutoReplySettings(env);
}

export async function previewAutoReply(request, env) {
  let body = {};
  try { body = await request.json(); } catch {}
  const origin = new URL(request.url).origin;
  const settings = withDefaults({ ...(await savedSettings(env)), ...cleanSettings(body.settings || {}) });
  const senderAddress = senderOf(env.FROM_EMAIL) || `hello@${new URL(origin).hostname}`;
  const firstName = typeof body.firstName === 'string' ? body.firstName.slice(0, 60) : 'Alex';
  return json({
    ok: true,
    subject: settings.subject,
    html: buildHtml({ origin, firstName, senderAddress, unsubUrl: '#', s: settings }),
    text: buildText({ origin, firstName, senderAddress, unsubUrl: '#', s: settings }),
  });
}

export async function testAutoReply(request, env) {
  let body = {};
  try { body = await request.json(); } catch {}
  const to = String(body.to || (env.CURRENT_USER && env.CURRENT_USER.email) || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ ok: false, error: 'Enter an email address to send the test to.' }, 400);
  if (!env.RESEND_API_KEY || !env.FROM_EMAIL) return json({ ok: false, error: 'Email isn\'t set up yet (RESEND_API_KEY / FROM_EMAIL in Cloudflare).' }, 400);
  const settings = withDefaults({ ...(await savedSettings(env)), ...cleanSettings(body.settings || {}) });
  const origin = new URL(request.url).origin;
  const res = await deliver(env, origin, { firstName: String(body.firstName || 'Alex').slice(0, 60), email: to }, settings, '[Test] ');
  if (!res.ok) return json({ ok: false, error: `Resend didn't accept the test: ${res.detail}` }, 502);
  return json({ ok: true, to });
}

function senderOf(fromEmail) {
  if (!fromEmail) return '';
  return (fromEmail.match(/<([^>]+)>/) || [null, fromEmail])[1].trim();
}

function photoUrl(origin, v) {
  v = String(v || '');
  if (/^https?:/i.test(v)) return v;
  return origin + (v.startsWith('/') ? v : '/' + v);
}

function fill(str, vars) {
  return String(str || '').replace(/\{(first_name|sender|name)\}/g, (_, k) => vars[k] || '');
}

function greetingLine(s, firstName) {
  if (!s.greeting) return '';
  if (/\{first_name\}/.test(s.greeting) && !firstName) return '';
  return fill(s.greeting, { first_name: firstName });
}

async function deliver(env, origin, { firstName, email }, settings, subjectPrefix = '') {
  const apiKey = env.RESEND_API_KEY;
  const fromEmail = env.FROM_EMAIL;
  const fromName = (env.FROM_NAME || SITE.name).trim();
  const from = /[<>]/.test(fromEmail) ? fromEmail : `${fromName} <${fromEmail}>`;
  const senderAddress = senderOf(fromEmail);
  const replyTo = env.AUTOREPLY_REPLY_TO || DEFAULT_REPLY_TO;
  const to = email.toLowerCase();
  const token = await signToken(to, env.ADMIN_PASSWORD);
  const unsubUrl = `${origin}/api/unsubscribe?email=${encodeURIComponent(to)}&token=${token}`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: replyTo,
      subject: subjectPrefix + fill(settings.subject, { first_name: firstName, name: SITE.name }),
      html: buildHtml({ origin, firstName, senderAddress, unsubUrl, s: settings }),
      text: buildText({ origin, firstName, senderAddress, unsubUrl, s: settings }),
      headers: {
        'List-Unsubscribe': `<${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  });
  return { ok: res.ok, status: res.status, detail: res.ok ? '' : await res.text() };
}

export async function sendAutoReply(env, origin, { firstName, email }) {
  try {
    if (env.AUTOREPLY_ENABLED === 'false') return;
    if (!(await getFeatures(env)).autoreply) return;
    if (!env.RESEND_API_KEY || !env.FROM_EMAIL) return;
    let saved = {};
    try { saved = await savedSettings(env); } catch {}
    const to = email.toLowerCase();
    const res = await deliver(env, origin, { firstName, email: to }, withDefaults(saved));
    if (!res.ok) {
      console.error('Auto-reply (Resend) error:', res.status, res.detail);
      await logError(env, { area: 'email', message: 'An auto-reply email was rejected by Resend', detail: `To: ${to}\nResend said (${res.status}): ${res.detail}` });
    }
  } catch (err) {
    console.error('Auto-reply failed:', err);
    await logError(env, { area: 'email', message: 'An auto-reply email could not be sent', detail: `To: ${email}\n${err && err.message ? err.message : err}` });
  }
}

function buildHtml({ origin, firstName, senderAddress, unsubUrl, s }) {
  const e = escapeHtml;
  const lines = (str) => e(str).replace(/&#39;/g, "'").replace(/\n/g, '<br>');
  const vars = { first_name: firstName, sender: senderAddress, name: SITE.name };
  const greeting = greetingLine(s, firstName);
  const note = lines(fill(s.note, { ...vars, sender: '\u0000' })).replace('\u0000', `<a href="mailto:${e(senderAddress)}" style="color:${C.maroon};">${e(senderAddress)}</a>`).replace(/\u0000/g, e(senderAddress));
  const year = new Date().getFullYear();
  const font = "font-family:Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif;";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${e(fill(s.subject, vars))}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${e(fill(s.preheader, vars))}${'&nbsp;&zwnj;'.repeat(60)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;">

  <tr><td align="center" style="padding:36px 24px 28px;">
    <img src="${origin}/${SITE.emailLogo}" alt="${e(SITE.name)}" width="300" style="display:block;width:300px;max-width:75%;height:auto;border:0;">
  </td></tr>

  <tr><td align="center" style="background:${C.maroon};padding:11px 16px;${font}font-size:13px;letter-spacing:4px;color:#ffffff;text-transform:uppercase;">
    ${e(SITE.tagline)}
  </td></tr>

  <tr><td style="padding:0;line-height:0;font-size:0;">
    ${s.photo ? `<img src="${e(photoUrl(origin, s.photo))}" alt="${e(s.photo_alt)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;">` : ''}
  </td></tr>

  <tr><td align="center" style="padding:36px 40px 8px;${font}">
    <div style="font-size:20px;letter-spacing:1px;color:${C.maroon};text-transform:uppercase;">${e(fill(s.heading, vars))}</div>
  </td></tr>
  <tr><td align="center" style="padding:12px 40px 0;${font}font-size:15px;line-height:1.6;color:${C.text};">
    ${greeting ? `${e(greeting)}<br>` : ''}${lines(fill(s.message, vars))}<br>
    <strong style="font-size:17px;color:${C.ink};">${e(SITE.name)}</strong>${SITE.byline ? `<br>
    <strong style="color:${C.ink};">${e(SITE.byline)}</strong>` : ''}
  </td></tr>
  <tr><td align="center" style="padding:18px 48px 36px;${font}font-size:14px;line-height:1.6;color:${C.text};">
    ${note}
  </td></tr>

  <tr><td align="center" style="background:${C.ink};padding:28px 24px 22px;">
    ${SITE.companyLogo ? `<img src="${origin}/${SITE.companyLogo}" alt="${e(SITE.companyLogoAlt)}" width="170" style="display:block;width:170px;height:auto;border:0;">` : `<div style="${font}font-size:14px;color:#ffffff;">${e(SITE.company)}</div>`}
    ${SITE.legalLine ? `<div style="${font}font-size:11px;color:${C.gold};padding-top:14px;">${e(SITE.legalLine)}</div>` : ''}
  </td></tr>

  <tr><td align="center" style="padding:26px 32px 32px;${font}font-size:12px;line-height:1.6;color:${C.muted};">
    <div style="font-style:italic;">Copyright &copy; ${year} ${e(SITE.company)}. All rights reserved.</div>
    <div style="font-style:italic;padding-bottom:14px;">You are receiving this email because you registered for ${e(SITE.name)} at <a href="${origin}" style="color:${C.muted};">${e(origin.replace(/^https?:\/\//, ''))}</a>.</div>
    <div style="color:${C.text};font-weight:bold;">Our mailing address is:</div>
    <div>${MAILING_ADDRESS.map(e).join('<br>')}</div>
    <div style="padding-top:14px;">Don't want to receive these emails?<br><a href="${unsubUrl}" style="color:${C.maroon};text-decoration:underline;">Unsubscribe from this list</a></div>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

function buildText({ firstName, senderAddress, unsubUrl, s }) {
  const vars = { first_name: firstName, sender: senderAddress, name: SITE.name };
  const greeting = greetingLine(s, firstName);
  return [
    fill(s.heading, vars).toUpperCase(),
    '',
    textOpening(greeting, fill(s.message, vars)),
    '',
    fill(s.note, vars),
    '',
    ...(SITE.legalLine ? [SITE.legalLine, ''] : []),
    '---',
    `Copyright ${new Date().getFullYear()} ${SITE.company}. All rights reserved.`,
    `You are receiving this email because you registered for ${SITE.name}.`,
    '',
    'Our mailing address is:',
    ...MAILING_ADDRESS,
    '',
    `Unsubscribe: ${unsubUrl}`,
  ].join('\n');
}

function textOpening(greeting, message) {
  const brand = [SITE.name, SITE.byline].filter(Boolean).join(' ');
  if (message.includes('\n')) return [greeting, message, brand].filter(Boolean).join('\n');
  const body = greeting && /^You /.test(message) ? message.replace(/^You /, 'you ') : message;
  const line = [greeting, body, brand].filter(Boolean).join(' ').trim();
  return /[.!?]$/.test(line) ? line : line + '.';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
