// "Thank you for registering" auto-reply sent to each person who registers,
// via Resend (same account/key as the internal notification).
//
// Uses the existing Worker variables:
//   RESEND_API_KEY, FROM_EMAIL, FROM_NAME (optional), ADMIN_PASSWORD (signs
//   the unsubscribe link, same as eblasts)
// Optional overrides:
//   AUTOREPLY_ENABLED   — set to "false" to turn the auto-reply off
//   AUTOREPLY_REPLY_TO  — where replies go (default SITE.defaultReplyTo)
//
// CASL: the footer carries SITE.company + mailing address and a working
// unsubscribe link (plus List-Unsubscribe headers for Gmail/Yahoo's
// one-click button). The link hits the same /api/unsubscribe handler as
// eblasts.
// All names, copy, images and colours come from ../site.config.js.
import { signToken } from './eblast.js';
import { SITE } from '../site.config.js';

const MAILING_ADDRESS = [SITE.company, ...SITE.mailingAddress].filter(Boolean);
const DEFAULT_REPLY_TO = SITE.defaultReplyTo;

const C = { ...SITE.colors, maroon: SITE.colors.brand, gold: SITE.colors.accent };

// Never throws: a failed auto-reply must not affect the registration.
export async function sendAutoReply(env, origin, { firstName, email }) {
  try {
    if (env.AUTOREPLY_ENABLED === 'false') return;
    const apiKey = env.RESEND_API_KEY;
    const fromEmail = env.FROM_EMAIL;
    if (!apiKey || !fromEmail) return;

    const fromName = (env.FROM_NAME || SITE.name).trim();
    const from = /[<>]/.test(fromEmail) ? fromEmail : `${fromName} <${fromEmail}>`;
    const senderAddress = (fromEmail.match(/<([^>]+)>/) || [null, fromEmail])[1].trim();
    const replyTo = env.AUTOREPLY_REPLY_TO || DEFAULT_REPLY_TO;

    const to = email.toLowerCase();
    const token = await signToken(to, env.ADMIN_PASSWORD);
    const unsubUrl = `${origin}/api/unsubscribe?email=${encodeURIComponent(to)}&token=${token}`;

    const html = buildHtml({ origin, firstName, senderAddress, unsubUrl });
    const text = buildText({ firstName, senderAddress, unsubUrl });

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: replyTo,
        subject: SITE.autoReplySubject,
        html,
        text,
        headers: {
          'List-Unsubscribe': `<${unsubUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
    if (!res.ok) console.error('Auto-reply (Resend) error:', res.status, await res.text());
  } catch (err) {
    console.error('Auto-reply failed:', err);
  }
}

function buildHtml({ origin, firstName, senderAddress, unsubUrl }) {
  const e = escapeHtml;
  const year = new Date().getFullYear();
  const font = "font-family:Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif;";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${e(SITE.autoReplySubject)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${e(`${SITE.autoReplyIntro} ${SITE.name} ${SITE.byline}`.trim())}${'&nbsp;&zwnj;'.repeat(60)}</div>
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
    <img src="${origin}/${SITE.emailHero}" alt="${e(SITE.emailHeroAlt)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;">
  </td></tr>

  <tr><td align="center" style="padding:36px 40px 8px;${font}">
    <div style="font-size:20px;letter-spacing:1px;color:${C.maroon};text-transform:uppercase;">Thank you for registering!</div>
  </td></tr>
  <tr><td align="center" style="padding:12px 40px 0;${font}font-size:15px;line-height:1.6;color:${C.text};">
    ${firstName ? `Hi ${e(firstName)},<br>` : ''}${e(SITE.autoReplyIntro)}<br>
    <strong style="font-size:17px;color:${C.ink};">${e(SITE.name)}</strong>${SITE.byline ? `<br>
    <strong style="color:${C.ink};">${e(SITE.byline)}</strong>` : ''}
  </td></tr>
  <tr><td align="center" style="padding:18px 48px 36px;${font}font-size:14px;line-height:1.6;color:${C.text};">
    Please add <a href="mailto:${e(senderAddress)}" style="color:${C.maroon};">${e(senderAddress)}</a> to your safe senders list to make sure you don't miss any future emails with exciting news and exclusive updates.
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

function buildText({ firstName, senderAddress, unsubUrl }) {
  return [
    'THANK YOU FOR REGISTERING!',
    '',
    `${firstName ? `Hi ${firstName}, you` : 'You'} ${SITE.autoReplyIntro.replace(/^You /, '')} ${SITE.name} ${SITE.byline}`.trim() + '.',
    '',
    `Please add ${senderAddress} to your safe senders list to make sure you don't miss any future emails with exciting news and exclusive updates.`,
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

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
