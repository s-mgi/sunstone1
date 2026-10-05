import { SITE } from '../site.config.js';

const RESEND_BATCH_MAX = 100;
const CHUNK_DELAY_MS = 250;

export async function eblastState(env) {
  const [{ results: activeRows }, { results: unsubRows }, { results: campaigns }] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(DISTINCT email) AS n FROM inquiries WHERE unsubscribed = 0 AND email IS NOT NULL AND TRIM(email) != ''`).all(),
    env.DB.prepare(`SELECT COUNT(DISTINCT email) AS n FROM inquiries WHERE unsubscribed = 1`).all(),
    env.DB.prepare(`SELECT id, created_at, sent_at, editor, subject, status, recipient_count, sent_count, failed_count FROM eblast_campaigns ORDER BY created_at DESC LIMIT 100`).all(),
  ]);

  return json({
    ok: true,
    recipients: { active: (activeRows && activeRows[0] && activeRows[0].n) || 0, unsubscribed: (unsubRows && unsubRows[0] && unsubRows[0].n) || 0 },
    campaigns,
  });
}

export async function getCampaign(env, id) {
  const campaign = await env.DB.prepare('SELECT * FROM eblast_campaigns WHERE id = ?').bind(id).first();
  if (!campaign) return json({ ok: false, error: 'Blast not found.' }, 404);
  return json({ ok: true, campaign: { ...campaign, blocks: safeParse(campaign.blocks, []) } });
}

export async function deleteCampaign(env, id) {
  const current = await env.DB.prepare('SELECT status FROM eblast_campaigns WHERE id = ?').bind(id).first();
  if (!current) return json({ ok: false, error: 'Blast not found.' }, 404);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM eblast_sends WHERE campaign_id = ?').bind(id),
    env.DB.prepare('DELETE FROM eblast_campaigns WHERE id = ?').bind(id),
  ]);
  return json({ ok: true, deleted: id });
}

export async function duplicateCampaign(env, id) {
  const source = await env.DB.prepare('SELECT * FROM eblast_campaigns WHERE id = ?').bind(id).first();
  if (!source) return json({ ok: false, error: 'Blast not found.' }, 404);

  const editor = decodeEditor(env);
  const subject = source.subject || '';
  const previewText = source.preview_text || '';
  const blocks = source.blocks || JSON.stringify([]);
  const res = await env.DB.prepare('INSERT INTO eblast_campaigns (editor, subject, preview_text, blocks, status) VALUES (?, ?, ?, ?, ?)')
    .bind(editor, subject, previewText, blocks, 'draft').run();
  const id2 = res.meta.last_row_id;
  const created = await env.DB.prepare('SELECT * FROM eblast_campaigns WHERE id = ?').bind(id2).first();
  return json({ ok: true, campaign: { ...created, blocks: safeParse(created.blocks, []) } });
}

export async function saveDraft(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON body.' }, 400); }

  const subject = String(body.subject || '').trim();
  const previewText = String(body.previewText || '').trim().slice(0, 150);
  const blocks = Array.isArray(body.blocks) ? body.blocks.map(cleanBlock).filter(Boolean) : [];
  const editor = decodeEditor(env);

  if (body.id) {
    const current = await env.DB.prepare('SELECT * FROM eblast_campaigns WHERE id = ?').bind(body.id).first();
    if (!current) return json({ ok: false, error: 'Draft not found.' }, 404);
    if (current.status !== 'draft') return json({ ok: false, error: 'That campaign has already been sent and can no longer be edited.' }, 400);
    await env.DB.prepare('UPDATE eblast_campaigns SET subject = ?, preview_text = ?, blocks = ?, editor = ? WHERE id = ?')
      .bind(subject, previewText, JSON.stringify(blocks), editor, body.id).run();
    const updated = await env.DB.prepare('SELECT * FROM eblast_campaigns WHERE id = ?').bind(body.id).first();
    return json({ ok: true, campaign: { ...updated, blocks: safeParse(updated.blocks, []) } });
  }

  const res = await env.DB.prepare('INSERT INTO eblast_campaigns (editor, subject, preview_text, blocks, status) VALUES (?, ?, ?, ?, ?)')
    .bind(editor, subject, previewText, JSON.stringify(blocks), 'draft').run();
  const id = res.meta.last_row_id;
  const created = await env.DB.prepare('SELECT * FROM eblast_campaigns WHERE id = ?').bind(id).first();
  return json({ ok: true, campaign: { ...created, blocks: safeParse(created.blocks, []) } });
}

export async function sendCampaign(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON body.' }, 400); }
  const id = body.id;
  if (!id) return json({ ok: false, error: 'Save the draft before sending.' }, 400);

  const campaign = await env.DB.prepare('SELECT * FROM eblast_campaigns WHERE id = ?').bind(id).first();
  if (!campaign) return json({ ok: false, error: 'Campaign not found.' }, 404);
  if (campaign.status !== 'draft') return json({ ok: false, error: 'This campaign has already been sent.' }, 400);

  const apiKey = env.RESEND_API_KEY;
  const fromEmail = env.FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    return json({ ok: false, error: 'Resend is not configured (RESEND_API_KEY / FROM_EMAIL missing), add these in Cloudflare, same as the registration emails use.' }, 400);
  }

  const subject = (campaign.subject || '').trim();
  if (!subject) return json({ ok: false, error: 'Add a subject line before sending.' }, 400);

  const blocks = safeParse(campaign.blocks, []);
  if (!blocks.length) return json({ ok: false, error: 'Add at least one image before sending.' }, 400);
  const missingAlt = blocks.find((b) => !b.alt || !b.alt.trim());
  if (missingAlt) return json({ ok: false, error: 'Every image needs alt text before this can send, one is missing it.' }, 400);

  const { results: recipients } = await env.DB.prepare(
    `SELECT DISTINCT email FROM inquiries WHERE unsubscribed = 0 AND email IS NOT NULL AND TRIM(email) != ''`
  ).all();
  if (!recipients.length) return json({ ok: false, error: 'There are no active (non-unsubscribed) registrants to send to.' }, 400);

  await env.DB.prepare(`UPDATE eblast_campaigns SET status = 'sending', recipient_count = ? WHERE id = ?`).bind(recipients.length, id).run();

  const origin = new URL(request.url).origin;
  const replyTo = env.TO_EMAIL || fromEmail;
  const fromName = (env.FROM_NAME || SITE.name).trim();
  const from = /[<>]/.test(fromEmail) ? fromEmail : `${fromName} <${fromEmail}>`;
  let sentCount = 0;
  let failedCount = 0;

  for (let i = 0; i < recipients.length; i += RESEND_BATCH_MAX) {
    const chunk = recipients.slice(i, i + RESEND_BATCH_MAX);

    const items = await Promise.all(chunk.map(async (r) => {
      const token = await signToken(r.email, env.ADMIN_PASSWORD);
      const unsubUrl = `${origin}/api/unsubscribe?email=${encodeURIComponent(r.email)}&token=${token}`;
      return {
        from,
        to: [r.email],
        reply_to: replyTo,
        subject,
        html: buildEmailHtml(blocks, unsubUrl, campaign.preview_text || ''),
        text: buildEmailText(subject, blocks, unsubUrl),
        headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      };
    }));

    let ok = false;
    let detail = '';
    try {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(items),
      });
      ok = res.ok;
      if (!ok) detail = await res.text();
    } catch (e) {
      detail = e.message;
    }

    const stmt = env.DB.prepare(`INSERT INTO eblast_sends (campaign_id, email, status, error, sent_at) VALUES (?, ?, ?, ?, datetime('now'))`);
    await env.DB.batch(chunk.map((r) => stmt.bind(id, r.email, ok ? 'sent' : 'failed', ok ? null : (detail || 'Send failed').slice(0, 500))));

    if (ok) sentCount += chunk.length; else failedCount += chunk.length;
    if (i + RESEND_BATCH_MAX < recipients.length) await sleep(CHUNK_DELAY_MS);
  }

  const finalStatus = failedCount === 0 ? 'sent' : (sentCount === 0 ? 'failed' : 'sent');
  await env.DB.prepare(`UPDATE eblast_campaigns SET status = ?, sent_at = datetime('now'), sent_count = ?, failed_count = ? WHERE id = ?`)
    .bind(finalStatus, sentCount, failedCount, id).run();

  return json({ ok: true, sent: sentCount, failed: failedCount, total: recipients.length });
}

export async function handleUnsubscribe(request, env) {
  const url = new URL(request.url);
  const email = url.searchParams.get('email') || '';
  const token = url.searchParams.get('token') || '';

  if (!email || !token || !env.ADMIN_PASSWORD) return htmlPage('Unsubscribe', 'That unsubscribe link looks incomplete or invalid.');

  const expected = await signToken(email, env.ADMIN_PASSWORD);
  if (token !== expected) return htmlPage('Unsubscribe', 'That unsubscribe link is invalid or has expired.');

  try {
    await env.DB.prepare('UPDATE inquiries SET unsubscribed = 1 WHERE lower(email) = ?').bind(email.toLowerCase()).run();
  } catch (err) {
    console.error('Unsubscribe update failed:', err);
    return htmlPage('Unsubscribe', 'Something went wrong on our end, please try again in a moment.');
  }

  return htmlPage('Unsubscribed', `${escapeHtml(email)} has been unsubscribed and won't receive future emails from us.`);
}


function buildEmailHtml(blocks, unsubscribeUrl, previewText) {
  const rows = blocks.map((b) => {
    const img = `<img src="${escapeHtml(b.image)}" alt="${escapeHtml(b.alt || '')}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;">`;
    const cell = b.link ? `<a href="${escapeHtml(b.link)}" target="_blank" rel="noopener" style="text-decoration:none;">${img}</a>` : img;
    return `<tr><td style="padding:0;line-height:0;font-size:0;">${cell}</td></tr>`;
  }).join('');

  const preheader = (previewText || '').trim()
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#f4f4f4;">${escapeHtml(previewText)}${'&nbsp;&zwnj;'.repeat(80)}</div>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f4;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;">
${rows}
<tr><td style="padding:16px 20px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#888888;text-align:center;">
You're receiving this because you registered at ${escapeHtml(SITE.name)}.<br>
${escapeHtml(SITE.company)} &middot; ${SITE.mailingAddress.map(escapeHtml).join(', ')}<br>
<a href="${escapeHtml(unsubscribeUrl)}" style="color:#888888;">Unsubscribe</a>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function buildEmailText(subject, blocks, unsubscribeUrl) {
  const lines = [subject, ''];
  for (const b of blocks) lines.push(`- ${b.alt}${b.link ? ` (${b.link})` : ''}`);
  lines.push('', `Unsubscribe: ${unsubscribeUrl}`);
  return lines.join('\n');
}


function cleanBlock(b) {
  if (!b || typeof b !== 'object') return null;
  const image = String(b.image || '').trim();
  if (!image) return null;
  return {
    image,
    alt: String(b.alt || '').trim().slice(0, 500),
    link: String(b.link || '').trim().slice(0, 1000),
  };
}

export async function signToken(value, key) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key || ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function safeParse(str, fallback) { try { return JSON.parse(str); } catch { return fallback; } }

function decodeEditor(env) { return (env && env.ADMIN_USER) || 'admin'; }

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function htmlPage(title, message) {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(title)}, ${escapeHtml(SITE.name)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;background:#141219;color:#f4efe3;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
.card{max-width:26rem;margin:1rem;padding:2rem;border:1px solid rgba(244,239,227,.16);border-radius:0.6rem;text-align:center;}
h1{font-size:1.25rem;margin:0 0 0.75rem;}p{color:rgba(244,239,227,.75);}</style></head>
<body><div class="card"><h1>${escapeHtml(title)}</h1><p>${message}</p></div></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=UTF-8' } }
  );
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
