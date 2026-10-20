import { logError } from './errors.js';
import { SITE } from '../site.config.js';

const RESEND_BATCH_MAX = 100;
const CHUNK_DELAY_MS = 250;
const MAX_IMAGE_BYTES = 1.9 * 1024 * 1024;
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' };
const MAX_PREVIEW_TO = 10;

export const DEFAULT_SETTINGS = {
  width: 600,
  outerBg: '#f4f4f4',
  innerBg: '#ffffff',
  footerColor: '#888888',
  footerText: `You're receiving this because you registered at ${SITE.name}.`,
  showFooter: true,
};
const FONT = 'Arial, Helvetica, sans-serif';

const STEP_PASTE = (where) => [
  'Click <b>Copy HTML</b> (or <b>Download .html</b>).',
  where,
  'Delete any sample code already there, paste yours and save.',
  'Copy the subject line and preview text into the campaign settings.',
  'Send a test to yourself, check it on your computer and phone, then send to your list.',
];
export const PLATFORMS = [
  { id: 'keap', name: 'Keap', autoFooter: true, note: 'Keap adds its own unsubscribe footer and address, so the export leaves that part out.',
    steps: STEP_PASTE('In Keap, start a new broadcast email and choose the option to code your own (paste HTML).') },
  { id: 'mailchimp', name: 'Mailchimp', unsub: '*|UNSUB|*', view: '*|ARCHIVE|*',
    note: 'Paste into a "Code your own" template.',
    steps: STEP_PASTE('In Mailchimp go to <b>Campaigns → Create → Email</b> and pick <b>Code your own → Paste in code</b>.') },
  { id: 'constantcontact', name: 'Constant Contact', autoFooter: true, note: 'Constant Contact adds its own unsubscribe footer.',
    steps: STEP_PASTE('In Constant Contact go to <b>Campaigns → Create → Email</b> and choose <b>Custom Code</b>.') },
  { id: 'hubspot', name: 'HubSpot', unsub: '{{ unsubscribe_link }}', view: '{{ view_as_page_url }}', note: 'Paste into a coded email template.',
    steps: STEP_PASTE('In HubSpot open <b>Design Manager</b>, create a <b>coded email template</b> and paste the code.') },
  { id: 'klaviyo', name: 'Klaviyo', unsub: '{% unsubscribe_link %}', note: 'Paste into an HTML template.',
    steps: STEP_PASTE('In Klaviyo go to <b>Templates → Create template</b> and choose the <b>HTML</b> editor.') },
  { id: 'brevo', name: 'Brevo', unsub: '{{ unsubscribe }}', view: '{{ mirror }}', note: 'Paste into "Paste your code".',
    steps: STEP_PASTE('In Brevo create an email campaign and choose <b>Paste your code</b> at the design step.') },
  { id: 'activecampaign', name: 'ActiveCampaign', unsub: '%UNSUBSCRIBELINK%', view: '%WEBCOPY%', note: 'Paste into the Custom HTML designer.',
    steps: STEP_PASTE('In ActiveCampaign create a campaign and choose <b>Custom HTML</b>.') },
  { id: 'mailerlite', name: 'MailerLite', unsub: '{$unsubscribe}', view: '{$url}', note: 'Paste into the Custom HTML editor.',
    steps: STEP_PASTE('In MailerLite create a campaign and choose the <b>Custom HTML editor</b>.') },
  { id: 'campaignmonitor', name: 'Campaign Monitor', unsubTag: '<unsubscribe style="color:{C};">Unsubscribe</unsubscribe>', viewTag: '<webversion style="color:{C};">View in browser</webversion>',
    note: 'Import the downloaded .html file.', steps: ['Click <b>Download .html</b>.', 'In Campaign Monitor create a campaign and choose <b>Import HTML</b>.', 'Upload the file, add the subject and preview text, send yourself a test, then send.'] },
  { id: 'gmail', name: 'Gmail or Outlook', manual: true, unsubText: 'Don\'t want these emails? Reply with "Unsubscribe" and we\'ll take you off the list.',
    note: 'Paste the finished design straight into a new message. No code involved.',
    steps: ['Click <b>Copy for email</b>.', 'Start a new message, click in the message area and paste (Ctrl+V, or ⌘+V on a Mac).', 'Add the subject. For a group, put your own address in To and everyone else in Bcc.', 'Send it to yourself first, then send it for real.'] },
  { id: 'custom', name: 'Another platform', custom: true, note: 'Type your platform\'s unsubscribe merge tag below (search its help for "unsubscribe merge tag").',
    steps: STEP_PASTE('In your platform, create a campaign and choose its custom HTML or "code your own" option.') },
  { id: 'none', name: 'Plain HTML (no unsubscribe link)', none: true, note: 'For developers or one-to-one use. Bulk email needs an unsubscribe link under CASL.',
    steps: ['Click <b>Copy HTML</b> or <b>Download .html</b> and use it wherever you need.'] },
];
const platformById = (id) => PLATFORMS.find((p) => p.id === id) || PLATFORMS[0];

export async function eblastState(env) {
  const [{ results: activeRows }, { results: unsubRows }, { results: campaigns }] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(DISTINCT email) AS n FROM inquiries WHERE unsubscribed = 0 AND email IS NOT NULL AND TRIM(email) != ''`).all(),
    env.DB.prepare(`SELECT COUNT(DISTINCT email) AS n FROM inquiries WHERE unsubscribed = 1`).all(),
    env.DB.prepare(`SELECT * FROM eblast_campaigns ORDER BY created_at DESC LIMIT 100`).all(),
  ]);
  const cols = await campaignColumns(env);

  return json({
    ok: true,
    recipients: { active: (activeRows && activeRows[0] && activeRows[0].n) || 0, unsubscribed: (unsubRows && unsubRows[0] && unsubRows[0].n) || 0 },
    campaigns: campaigns.map(({ blocks, settings, ...c }) => c),
    platforms: PLATFORMS.map(({ unsub, view, unsubTag, viewTag, unsubText, ...p }) => p),
    defaults: DEFAULT_SETTINGS,
    needsMigration: !cols.has('settings') || !(await hasImagesTable(env)),
    mailConfigured: !!(env.RESEND_API_KEY && env.FROM_EMAIL),
  });
}

export async function getCampaign(env, id) {
  const campaign = await env.DB.prepare('SELECT * FROM eblast_campaigns WHERE id = ?').bind(id).first();
  if (!campaign) return json({ ok: false, error: 'Blast not found.' }, 404);
  return json({ ok: true, campaign: shape(campaign) });
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

  const subject = source.subject || '';
  const res = await insertCampaign(env, {
    editor: decodeEditor(env),
    subject,
    previewText: source.preview_text || '',
    blocks: source.blocks || '[]',
    trackingName: cleanTrackingName(source.tracking_name) || trackingSlug(subject),
    settings: source.settings || '{}',
  });
  const created = await env.DB.prepare('SELECT * FROM eblast_campaigns WHERE id = ?').bind(res.meta.last_row_id).first();
  return json({ ok: true, campaign: shape(created) });
}

export async function saveDraft(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON body.' }, 400); }

  const subject = String(body.subject || '').trim();
  const previewText = String(body.previewText || '').trim().slice(0, 150);
  const blocks = cleanBlocks(body.blocks);
  const settings = cleanSettings(body.settings);
  const trackingName = cleanTrackingName(body.trackingName) || trackingSlug(subject);
  const editor = decodeEditor(env);

  if (body.id) {
    const current = await env.DB.prepare('SELECT * FROM eblast_campaigns WHERE id = ?').bind(body.id).first();
    if (!current) return json({ ok: false, error: 'Draft not found.' }, 404);
    if (current.status !== 'draft') return json({ ok: false, error: 'That campaign has already been sent and can no longer be edited.' }, 400);
    const cols = await campaignColumns(env);
    const sets = ['subject = ?', 'preview_text = ?', 'blocks = ?', 'editor = ?'];
    const vals = [subject, previewText, JSON.stringify(blocks), editor];
    if (cols.has('tracking_name')) { sets.push('tracking_name = ?'); vals.push(trackingName); }
    if (cols.has('settings')) { sets.push('settings = ?'); vals.push(JSON.stringify(settings)); }
    await env.DB.prepare(`UPDATE eblast_campaigns SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, body.id).run();
    const updated = await env.DB.prepare('SELECT * FROM eblast_campaigns WHERE id = ?').bind(body.id).first();
    return json({ ok: true, campaign: shape(updated) });
  }

  const res = await insertCampaign(env, { editor, subject, previewText, blocks: JSON.stringify(blocks), trackingName, settings: JSON.stringify(settings) });
  const created = await env.DB.prepare('SELECT * FROM eblast_campaigns WHERE id = ?').bind(res.meta.last_row_id).first();
  return json({ ok: true, campaign: shape(created) });
}

export async function previewEblast(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON body.' }, 400); }
  const origin = new URL(request.url).origin;
  const draft = {
    subject: String(body.subject || '').trim(),
    previewText: String(body.previewText || '').trim().slice(0, 150),
    blocks: cleanBlocks(body.blocks),
    settings: cleanSettings(body.settings),
  };
  const html = buildEmailHtml(draft, { origin, mode: 'test' });
  return json({ ok: true, html, checks: checkEblast(draft, origin, html) });
}

export async function exportEblast(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON body.' }, 400); }
  const campaign = body.id ? await env.DB.prepare('SELECT * FROM eblast_campaigns WHERE id = ?').bind(body.id).first() : null;
  if (!campaign) return json({ ok: false, error: 'Save the blast before exporting it.' }, 404);
  const c = shape(campaign);
  const origin = new URL(request.url).origin;
  const platform = platformById(body.platform);
  const trackingName = cleanTrackingName(c.tracking_name) || trackingSlug(c.subject);
  const draft = { subject: c.subject || '', previewText: c.preview_text || '', settings: c.settings, blocks: withTracking(c.blocks, trackingName) };
  const opts = { origin, mode: 'export', platform, customUnsub: String(body.customUnsub || '').trim().slice(0, 300) };
  const html = buildEmailHtml(draft, opts);

  const cols = await campaignColumns(env);
  if (body.record !== false && cols.has('exported_at')) {
    await env.DB.prepare(`UPDATE eblast_campaigns SET exported_at = datetime('now') WHERE id = ?`).bind(c.id).run();
  }
  return json({
    ok: true,
    html,
    pasteHtml: platform.manual ? pasteHtml(html) : null,
    text: buildEmailText(draft.subject, draft.blocks, ''),
    filename: (trackingName || `eblast-${c.id}`) + '.html',
    checks: checkEblast(draft, origin, html, platform, opts.customUnsub),
  });
}

export async function testEblast(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON body.' }, 400); }
  if (!env.RESEND_API_KEY || !env.FROM_EMAIL) {
    return json({ ok: false, error: 'Email isn\'t set up yet (RESEND_API_KEY / FROM_EMAIL in Cloudflare).' }, 400);
  }
  const fallback = (env.CURRENT_USER && env.CURRENT_USER.email) || '';
  const to = [...new Set(String(body.to || fallback).split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!to.length) return json({ ok: false, error: 'Enter the email address to send the preview to.' }, 400);
  if (to.length > MAX_PREVIEW_TO) return json({ ok: false, error: `Up to ${MAX_PREVIEW_TO} addresses at a time.` }, 400);
  const bad = to.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (bad) return json({ ok: false, error: `"${bad}" doesn't look like an email address.` }, 400);

  const campaign = body.id ? await env.DB.prepare('SELECT * FROM eblast_campaigns WHERE id = ?').bind(body.id).first() : null;
  if (!campaign) return json({ ok: false, error: 'Save the blast before sending a preview.' }, 404);
  const c = shape(campaign);
  if (!c.blocks.length) return json({ ok: false, error: 'Add something to the email first.' }, 400);

  const origin = new URL(request.url).origin;
  const draft = { subject: c.subject || '', previewText: c.preview_text || '', settings: c.settings, blocks: c.blocks };
  const subject = `[Preview] ${draft.subject || 'Eblast'}`.slice(0, 300);
  const fromName = (env.FROM_NAME || SITE.name).trim();
  const from = /[<>]/.test(env.FROM_EMAIL) ? env.FROM_EMAIL : `${fromName} <${env.FROM_EMAIL}>`;
  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html: buildEmailHtml(draft, { origin, mode: 'test' }), text: buildEmailText(subject, draft.blocks, '') }),
    });
  } catch (e) {
    return json({ ok: false, error: 'Couldn\'t reach Resend. Try again in a moment.' }, 502);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    await logError(env, { area: 'email', message: 'An eblast preview could not be sent', detail: `${res.status} ${detail}`.slice(0, 800) });
    return json({ ok: false, error: `Resend didn't accept the preview: ${detail.slice(0, 200) || res.status}` }, 502);
  }
  return json({ ok: true, to });
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

  const c = shape(campaign);
  const blocks = c.blocks;
  if (!blocks.length) return json({ ok: false, error: 'Add something to the email before sending.' }, 400);
  const missingAlt = blocks.find((b) => b.type === 'image' && !b.alt.trim());
  if (missingAlt) return json({ ok: false, error: 'Every image needs alt text before this can send, one is missing it.' }, 400);

  const { results: recipients } = await env.DB.prepare(
    `SELECT DISTINCT email FROM inquiries WHERE unsubscribed = 0 AND email IS NOT NULL AND TRIM(email) != ''`
  ).all();
  if (!recipients.length) return json({ ok: false, error: 'There are no active (non-unsubscribed) registrants to send to.' }, 400);

  await env.DB.prepare(`UPDATE eblast_campaigns SET status = 'sending', recipient_count = ? WHERE id = ?`).bind(recipients.length, id).run();

  const origin = new URL(request.url).origin;
  const trackingName = cleanTrackingName(campaign.tracking_name) || trackingSlug(subject);
  const draft = { subject, previewText: campaign.preview_text || '', settings: c.settings, blocks: withTracking(blocks, trackingName) };
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
        html: buildEmailHtml(draft, { origin, mode: 'send', unsubUrl }),
        text: buildEmailText(subject, draft.blocks, unsubUrl),
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

  if (failedCount) await logError(env, { area: 'email', message: `Eblast "${subject.slice(0, 80)}" failed for ${failedCount} of ${recipients.length} recipients`, detail: 'See the campaign in the Eblast tab for each address. The most common causes are a Resend sending limit or an unverified sending domain.' });
  const finalStatus = failedCount === 0 ? 'sent' : (sentCount === 0 ? 'failed' : 'sent');
  await env.DB.prepare(`UPDATE eblast_campaigns SET status = ?, sent_at = datetime('now'), sent_count = ?, failed_count = ? WHERE id = ?`)
    .bind(finalStatus, sentCount, failedCount, id).run();

  return json({ ok: true, sent: sentCount, failed: failedCount, total: recipients.length });
}

export async function uploadEblastImage(request, env) {
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES[type]) return json({ ok: false, error: 'Images must be JPG, PNG or GIF (email apps can\'t show WebP or SVG).' }, 400);
  const data = await request.arrayBuffer();
  if (!data.byteLength) return json({ ok: false, error: 'That file is empty.' }, 400);
  if (data.byteLength > MAX_IMAGE_BYTES) return json({ ok: false, error: 'That image is over 1.9 MB. Save it as a JPG or at a smaller size and try again.' }, 400);
  if (!(await hasImagesTable(env))) return json({ ok: false, error: 'Run migrations/0005_eblast_builder.sql in the D1 console first, then upload again.' }, 400);

  const url = new URL(request.url);
  const campaignId = Number(url.searchParams.get('campaign')) || 0;
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  const key = `e/${campaignId}/${rand}.${IMAGE_TYPES[type]}`;
  const uploadedBy = (env.CURRENT_USER && (env.CURRENT_USER.email || env.CURRENT_USER.name)) || '';
  await env.DB.prepare('INSERT INTO eblast_images (key, campaign_id, width, height, bytes, content_type, uploaded_by, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(key, campaignId, Number(url.searchParams.get('w')) || null, Number(url.searchParams.get('h')) || null, data.byteLength, type, uploadedBy, data).run();
  return json({ ok: true, key, url: `/i/${key}`, bytes: data.byteLength });
}

export async function serveEblastImage(request, env, ctx, key) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) { const hit = await cache.match(request); if (hit) return hit; }
  let row = null;
  try { row = await env.DB.prepare('SELECT data, content_type FROM eblast_images WHERE key = ?').bind(key).first(); } catch {}
  if (!row || !row.data) return new Response('Not found', { status: 404 });
  const res = new Response(new Uint8Array(row.data), {
    headers: {
      'Content-Type': row.content_type || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
      ETag: `"${key}"`,
    },
  });
  if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(request, res.clone()));
  return res;
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
    await logError(env, { area: 'email', message: 'An unsubscribe request could not be saved', detail: `${email}\n${err && err.message ? err.message : err}` });
    return htmlPage('Unsubscribe', 'Something went wrong on our end, please try again in a moment.');
  }

  return htmlPage('Unsubscribed', `${escapeHtml(email)} has been unsubscribed and won't receive future emails from us.`);
}

export function buildEmailHtml(draft, { origin, mode = 'test', unsubUrl = '', platform = null, customUnsub = '' } = {}) {
  const s = draft.settings || DEFAULT_SETTINGS;
  const W = s.width;
  const fc = s.footerColor;
  const link = (href, label) => `<a href="${escapeHtml(href)}" target="_blank" style="color:${fc};text-decoration:underline;">${label}</a>`;
  const p = mode === 'export' ? (platform || PLATFORMS[0]) : null;

  let unsub = '';
  let view = '';
  if (mode === 'send') unsub = link(unsubUrl, 'Unsubscribe');
  else if (mode === 'test') unsub = link('#', 'Unsubscribe');
  else if (p.manual) unsub = escapeHtml(p.unsubText);
  else if (p.unsubTag) unsub = p.unsubTag.replace('{C}', fc);
  else if (p.custom) unsub = customUnsub ? link(customUnsub, 'Unsubscribe') : '';
  else if (p.unsub) unsub = link(p.unsub, 'Unsubscribe');
  if (p && p.viewTag) view = p.viewTag.replace('{C}', fc);
  else if (p && p.view) view = link(p.view, 'View in browser');

  const footerBits = [];
  if (s.footerText) footerBits.push(escapeHtml(s.footerText).replace(/\n/g, '<br>'));
  if (!(p && p.autoFooter)) {
    footerBits.push(`${escapeHtml(SITE.company)} &middot; ${SITE.mailingAddress.map(escapeHtml).join(', ')}`);
    if (unsub) footerBits.push(unsub);
  }
  const footer = s.showFooter && footerBits.length
    ? `<tr><td align="center" style="padding:20px 24px 28px;font-family:${FONT};font-size:11px;line-height:17px;color:${fc};">${footerBits.join('<br><br>')}</td></tr>` : '';
  const top = view ? `<tr><td align="center" style="padding:10px 16px;font-family:${FONT};font-size:11px;line-height:16px;color:${fc};">${view}</td></tr>` : '';

  const pre = (draft.previewText || '').trim() && !(p && p.manual)
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(draft.previewText)}${'&#8199;&#65279;&#847; '.repeat(60)}</div>`
    : '';
  const rows = (draft.blocks || []).map((b) => blockRow(b, W, origin)).join('\n');

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<title>${escapeHtml(draft.subject || SITE.name)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body{margin:0!important;padding:0!important;width:100%!important;}
  img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none;}
  table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}
  a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;}
  @media screen and (max-width:${W + 20}px){ .eb-wrap{width:100%!important;} .eb-img{width:100%!important;height:auto!important;} }
</style>
</head>
<body style="margin:0;padding:0;background-color:${s.outerBg};">
${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${s.outerBg};">
<tr><td align="center" style="padding:0;">
<!--[if mso]><table role="presentation" width="${W}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="eb-wrap" width="${W}" cellpadding="0" cellspacing="0" border="0" style="width:${W}px;max-width:${W}px;">
${top}
<tr><td style="background-color:${s.innerBg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${rows}
</table>
</td></tr>
${footer}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

function blockRow(b, W, origin) {
  const bgCss = b.bg ? `background-color:${b.bg};` : '';
  if (b.type === 'image') {
    const h = b.width ? Math.round((b.height / b.width) * W) : 0;
    const img = `<img class="eb-img" src="${escapeHtml(absoluteUrl(b.url, origin))}" width="${W}"${h ? ` height="${h}"` : ''} alt="${escapeHtml(b.alt)}" style="display:block;width:100%;max-width:${W}px;height:auto;border:0;font-family:${FONT};font-size:14px;line-height:20px;color:#555555;">`;
    const cell = b.link ? `<a href="${escapeHtml(b.link)}" target="_blank" style="text-decoration:none;">${img}</a>` : img;
    return `<tr><td style="padding:0;line-height:0;font-size:0;${bgCss}">${cell}</td></tr>`;
  }
  if (b.type === 'text') {
    const body = escapeHtml(b.text).replace(/\n/g, '<br>');
    return `<tr><td align="${b.align}" style="padding:16px 32px;font-family:${FONT};font-size:${b.size}px;line-height:${Math.round(b.size * 1.5)}px;color:${b.color || '#333333'};${b.bold ? 'font-weight:bold;' : ''}${bgCss}">${body}</td></tr>`;
  }
  if (b.type === 'button') {
    const href = escapeHtml(b.link || '#');
    const color = b.color || SITE.colors.brand;
    const tc = b.textColor || '#ffffff';
    const label = escapeHtml(b.text || 'Learn more');
    const w = Math.max(160, Math.min(W - 64, label.length * 10 + 64));
    return `<tr><td align="center" style="padding:16px 32px;${bgCss}">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:46px;v-text-anchor:middle;width:${w}px;" arcsize="6%" stroke="f" fillcolor="${color}"><w:anchorlock/><center style="color:${tc};font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${label}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${href}" target="_blank" style="display:inline-block;background-color:${color};color:${tc};font-family:${FONT};font-size:15px;font-weight:bold;line-height:46px;text-align:center;text-decoration:none;padding:0 28px;border-radius:3px;-webkit-text-size-adjust:none;">${label}</a><!--<![endif]-->
</td></tr>`;
  }
  if (b.type === 'spacer') return `<tr><td style="height:${b.height}px;line-height:${b.height}px;font-size:0;${bgCss}">&nbsp;</td></tr>`;
  return '';
}

function pasteHtml(full) {
  const m = full.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bg = (full.match(/<body[^>]*background-color:([^;"]+)/i) || [])[1] || '#ffffff';
  const inner = (m ? m[1] : full).replace(/<!--[\s\S]*?-->/g, '').trim();
  return `<div style="background-color:${bg};padding:0;margin:0;">${inner}</div>`;
}

function buildEmailText(subject, blocks, unsubscribeUrl) {
  const lines = [subject, ''];
  for (const b of blocks) {
    const t = b.type === 'image' ? b.alt : (b.type === 'text' || b.type === 'button') ? b.text : '';
    if (t) lines.push(t + (b.link ? ` (${b.link})` : ''));
  }
  lines.push('', `${SITE.company}, ${SITE.mailingAddress.join(', ')}`);
  if (unsubscribeUrl) lines.push(`Unsubscribe: ${unsubscribeUrl}`);
  return lines.join('\n');
}

function checkEblast(draft, origin, html, platform = null, customUnsub = '') {
  const blocks = draft.blocks || [];
  const imgs = blocks.filter((b) => b.type === 'image');
  const out = [];
  out.push(draft.subject ? ['ok', 'Subject line set'] : ['no', 'No subject line']);
  out.push(draft.previewText ? ['ok', 'Preview text set'] : ['wn', 'No preview text, inboxes will show the first words of the email instead']);
  const noAlt = imgs.filter((b) => !b.alt).length;
  if (imgs.length) out.push(noAlt ? ['no', `${noAlt} image${noAlt > 1 ? 's' : ''} missing alt text`] : ['ok', 'Every image has alt text']);
  const noLink = blocks.filter((b) => (b.type === 'image' || b.type === 'button') && !b.link).length;
  if (noLink) out.push(['wn', `${noLink} image${noLink > 1 ? 's or buttons' : ' or button'} without a link`]);
  const kb = Math.round(imgs.reduce((a, b) => a + (b.bytes || 0), 0) / 1024);
  if (kb) out.push(kb > 1500 ? ['wn', `Images total ${kb} KB, which is heavy on phones. Use a lower JPG quality when slicing.`] : ['ok', `Images total ${kb} KB`]);
  if (imgs.length && !blocks.some((b) => b.type === 'text' || b.type === 'button')) out.push(['wn', 'All images and no live text. Spam filters like some real text, so add a text block or button.']);
  const htmlKb = Math.round(html.length / 1024);
  out.push(htmlKb > 100 ? ['wn', `The HTML is ${htmlKb} KB. Gmail cuts off emails over 102 KB.`] : ['ok', `HTML is ${htmlKb} KB (under Gmail's 102 KB limit)`]);
  const host = (() => { try { return new URL(origin).hostname; } catch { return ''; } })();
  if (imgs.length && /workers\.dev$|localhost|127\.0\.0\.1/.test(host)) out.push(['wn', `Images point to ${host}. Export from your own domain's /admin once it's live so the images use it.`]);
  else if (imgs.length) out.push(['ok', `Images are hosted on ${host}`]);
  if (platform) {
    if (platform.none) out.push(['no', 'No unsubscribe link (bulk email needs one under CASL)']);
    else if (platform.custom && !customUnsub) out.push(['no', 'Type your platform\'s unsubscribe merge tag to add an unsubscribe link']);
    else if (platform.autoFooter) out.push(['ok', `${platform.name} adds its own unsubscribe footer`]);
    else if (!draft.settings.showFooter) out.push(['no', 'The footer is hidden, so there is no unsubscribe link']);
    else out.push(['ok', platform.manual ? 'Footer asks people to reply "Unsubscribe" to opt out' : 'Unsubscribe link included']);
  }
  return out;
}

function absoluteUrl(url, origin) {
  url = String(url || '');
  if (!origin) return url;
  if (url.startsWith('/')) return origin + url;
  if (!/^https?:/i.test(url)) return origin + '/' + url;
  try {
    const u = new URL(url);
    if (/^\/(i|media|assets)\//.test(u.pathname) && (u.hostname.endsWith('.workers.dev') || u.hostname === new URL(origin).hostname || /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) {
      return origin + u.pathname + u.search;
    }
  } catch {}
  return url;
}

function withTracking(blocks, trackingName) {
  return blocks.map((b) => (b.link ? { ...b, link: addTracking(b.link, trackingName) } : b));
}

function shape(row) {
  const settings = cleanSettings(safeParse(row.settings, {}));
  return { ...row, settings, blocks: cleanBlocks(safeParse(row.blocks, [])) };
}

let COLS = null;
async function campaignColumns(env) {
  if (COLS) return COLS;
  let names = [];
  try { names = (await env.DB.prepare('PRAGMA table_info(eblast_campaigns)').all()).results.map((r) => r.name); } catch {}
  const set = new Set(names);
  if (set.has('settings') && set.has('exported_at') && set.has('tracking_name')) COLS = set;
  return set;
}

let IMAGES_TABLE = false;
async function hasImagesTable(env) {
  if (IMAGES_TABLE) return true;
  try { IMAGES_TABLE = !!(await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'eblast_images'`).first()); } catch {}
  return IMAGES_TABLE;
}

async function insertCampaign(env, { editor, subject, previewText, blocks, trackingName, settings }) {
  const cols = await campaignColumns(env);
  const names = ['editor', 'subject', 'preview_text', 'blocks', 'status'];
  const vals = [editor, subject, previewText, blocks, 'draft'];
  if (cols.has('tracking_name')) { names.push('tracking_name'); vals.push(trackingName); }
  if (cols.has('settings')) { names.push('settings'); vals.push(settings); }
  return env.DB.prepare(`INSERT INTO eblast_campaigns (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).bind(...vals).run();
}

export function trackingSlug(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
}

function cleanTrackingName(value) {
  return trackingSlug(value);
}

export function addTracking(link, trackingName) {
  if (!link || !trackingName || !/^https?:\/\//i.test(link)) return link;
  let url;
  try { url = new URL(link); } catch { return link; }
  if ([...url.searchParams.keys()].some((k) => k.toLowerCase().startsWith('utm_'))) return link;
  url.searchParams.set('utm_source', 'eblast');
  url.searchParams.set('utm_medium', 'email');
  url.searchParams.set('utm_campaign', trackingName);
  return url.toString();
}

const colour = (v) => (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(v || '').trim()) ? String(v).trim() : '');
const clip = (v, max) => String(v ?? '').trim().slice(0, max);

function cleanSettings(s) {
  s = s && typeof s === 'object' ? s : {};
  const d = DEFAULT_SETTINGS;
  return {
    width: [600, 640, 700].includes(Number(s.width)) ? Number(s.width) : d.width,
    outerBg: colour(s.outerBg) || d.outerBg,
    innerBg: colour(s.innerBg) || d.innerBg,
    footerColor: colour(s.footerColor) || d.footerColor,
    footerText: s.footerText === undefined ? d.footerText : clip(s.footerText, 1000),
    showFooter: s.showFooter !== false,
  };
}

function cleanBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : []).slice(0, 80).map(cleanBlock).filter(Boolean);
}

function cleanBlock(b) {
  if (!b || typeof b !== 'object') return null;
  const type = b.type || (b.image ? 'image' : '');
  if (type === 'image') {
    const url = clip(b.url || b.image, 1000);
    if (!url) return null;
    return { type, url, key: clip(b.key, 300), width: Number(b.width) || 0, height: Number(b.height) || 0, bytes: Number(b.bytes) || 0,
      alt: clip(b.alt, 500), link: clip(b.link, 1000), bg: colour(b.bg) };
  }
  if (type === 'text') return { type, text: clip(b.text, 5000), align: ['left', 'center', 'right'].includes(b.align) ? b.align : 'center',
    size: Math.min(40, Math.max(10, Number(b.size) || 16)), color: colour(b.color), bg: colour(b.bg), bold: !!b.bold };
  if (type === 'button') return { type, text: clip(b.text, 120), link: clip(b.link, 1000), color: colour(b.color), textColor: colour(b.textColor), bg: colour(b.bg) };
  if (type === 'spacer') return { type, height: Math.min(200, Math.max(4, Number(b.height) || 24)), bg: colour(b.bg) };
  return null;
}

export async function signToken(value, key) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key || ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function safeParse(str, fallback) { try { return JSON.parse(str); } catch { return fallback; } }

function decodeEditor(env) { return (env && env.CURRENT_USER && env.CURRENT_USER.name) || (env && env.ADMIN_USER) || 'admin'; }

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
