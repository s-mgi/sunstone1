// Handles POST /register: stores the lead in D1 (the CMS inquiries table),
// sends a notification email via Resend (https://resend.com) and the
// "thank you for registering" auto-reply.
//
// Sunstone Towns keeps Keap: the form on the page still posts to Keap
// (Infusionsoft) exactly as before, and js/main.js sends a copy of the same
// fields here in the background (fetch keepalive) as the visitor submits.
// So this endpoint's JSON answer is never shown to the visitor; Keap's own
// redirect decides where they land.
//
// Required Worker variables/secrets (Settings -> Variables and secrets):
//   RESEND_API_KEY  — your Resend API key (starts with "re_")
//   FROM_EMAIL      — a sender address on a domain verified in Resend
//   TO_EMAIL        — where new-registration notifications should land (comma-separated)
// Required binding: DB (this site's D1 database)
import { sendAutoReply } from './autoreply.js';
import { SITE } from '../site.config.js';

// Must match the <option>s of #timeframe in index.html.
export const TIMEFRAME_OPTIONS = ['Immediately', 'Within 6 months', '6–12 months', 'Just exploring'];

export async function handleRegister(request, env, ctx) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await request.json();
    } else {
      const form = await request.formData();
      data = Object.fromEntries(form.entries());
    }

    if (data.company) return json({ ok: true }); // honeypot (fed from Keap's hidden inf-sbt field)

    const clip = (v, n) => String(v || '').trim().slice(0, n);
    const firstName = clip(data.firstName, 100);
    const lastName = clip(data.lastName, 100);
    const email = clip(data.email, 254);
    const phone = clip(data.phone, 40);
    const timeframe = clip(data.timeframe, 40);
    const hearAbout = clip(data.hearAbout, 255);
    const comments = clip(data.comments, 4000);
    const consent = data.consent === true || ['yes', 'on', 'true', '1'].includes(String(data.consent || '').toLowerCase()) ? 'yes' : '';
    const sourcePath = clip(data.sourcePath, 255);
    const utmSource = clip(data.utmSource, 255);
    const utmMedium = clip(data.utmMedium, 255);
    const utmCampaign = clip(data.utmCampaign, 255);

    if (!firstName || !lastName || !email || !phone || !timeframe || !hearAbout || !consent) {
      return json({ ok: false, error: 'Please complete the highlighted fields.' }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
    }
    if (!TIMEFRAME_OPTIONS.includes(timeframe)) {
      return json({ ok: false, error: 'Please complete the highlighted fields.' }, 400);
    }

    let returning = false;
    if (env.DB) {
      try {
        // One contact per email: if this address has registered before,
        // refresh their details instead of adding a duplicate row.
        const existing = await env.DB.prepare(
          'SELECT id FROM inquiries WHERE lower(email) = ? ORDER BY id LIMIT 1'
        ).bind(email.toLowerCase()).first();
        if (existing) {
          returning = true;
          await env.DB.prepare(
            `UPDATE inquiries SET first_name = ?, last_name = ?, phone = COALESCE(?, phone), purchase_timeframe = ?, hear_about = ?,
               comments = COALESCE(?, comments), consent = ?,
               utm_source = COALESCE(?, utm_source), utm_medium = COALESCE(?, utm_medium), utm_campaign = COALESCE(?, utm_campaign)
             WHERE id = ?`
          ).bind(firstName, lastName, phone || null, timeframe, hearAbout, comments || null, consent,
            utmSource || null, utmMedium || null, utmCampaign || null, existing.id).run();
        } else {
          await env.DB.prepare(
            `INSERT INTO inquiries (first_name, last_name, email, phone, purchase_timeframe, hear_about, comments, consent, source_path, utm_source, utm_medium, utm_campaign, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`
          ).bind(firstName, lastName, email.toLowerCase(), phone || null, timeframe, hearAbout, comments || null, consent,
            sourcePath || null, utmSource || null, utmMedium || null, utmCampaign || null).run();
        }
      } catch (dbErr) {
        console.error('D1 insert failed (inquiry still emailed if Resend is configured):', dbErr);
      }
    } else {
      console.error('No DB binding — inquiry was not stored, only emailed (if configured).');
    }

    // "Thank you for registering" auto-reply to the registrant (Resend), in
    // the background so it never slows down or breaks the form. See autoreply.js.
    const reply = sendAutoReply(env, new URL(request.url).origin, { firstName, email });
    if (ctx && ctx.waitUntil) ctx.waitUntil(reply); else await reply;

    const apiKey = env.RESEND_API_KEY;
    const fromEmail = env.FROM_EMAIL;
    const toEmail = env.TO_EMAIL;

    if (!apiKey || !fromEmail || !toEmail) {
      console.error('Resend is not configured: missing RESEND_API_KEY, FROM_EMAIL, or TO_EMAIL.');
      return json({ ok: true, warning: 'stored_without_email' });
    }

    const html = [
      `<h2 style="margin:0 0 12px;font-family:sans-serif;">${returning ? 'Returning registration (details updated)' : 'New registration'} &middot; ${escapeHtml(SITE.name)}</h2>`,
      '<table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;">',
      row('Name', `${escapeHtml(firstName)} ${escapeHtml(lastName)}`),
      row('Email', escapeHtml(email)),
      row('Phone', phone ? escapeHtml(phone) : '&mdash;'),
      row('Purchase timeframe', escapeHtml(timeframe)),
      row('Heard about us via', escapeHtml(hearAbout)),
      row('Comments', comments ? escapeHtml(comments).replace(/\n/g, '<br>') : '&mdash;'),
      row('Consent to updates', consent === 'yes' ? 'Yes' : 'No'),
      row('Source', sourcePath ? escapeHtml(sourcePath) : '&mdash;'),
      row('UTM', [utmSource, utmMedium, utmCampaign].filter(Boolean).map(escapeHtml).join(' / ') || '&mdash;'),
      '</table>',
    ].join('');

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail,
        to: toEmail.split(',').map((s) => s.trim()).filter(Boolean),
        reply_to: email,
        subject: `${returning ? 'Returning registration' : 'New registration'}: ${firstName} ${lastName}`,
        html,
      }),
    });

    if (!resendRes.ok) {
      const detail = await resendRes.text();
      console.error('Resend API error:', resendRes.status, detail);
      return json({ ok: true, warning: 'stored_without_email' });
    }

    return json({ ok: true });
  } catch (err) {
    console.error('register.js error:', err);
    return json({ ok: false, error: 'Unexpected error. Please try again.' }, 500);
  }
}

function row(label, value) {
  return `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top;">${label}</td><td style="padding:4px 0;"><b>${value}</b></td></tr>`;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
