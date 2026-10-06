import { sendAutoReply } from './autoreply.js';
import { SITE } from '../site.config.js';

export const FORM_VERSION = '2026-10-05';

const KEEP_PROVIDER = true;

export const HEAR_ABOUT_OPTIONS = ['Google', 'Instagram', 'Facebook', 'Friend or Family', 'Realtor or Broker', 'Signage or Drove By', 'Other'];

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

    if (data.company) return json({ ok: true });

    const clip = (v, n) => String(v || '').trim().slice(0, n);
    const firstName = clip(data.firstName, 100);
    const lastName = clip(data.lastName, 100);
    const email = clip(data.email, 254);
    const phone = clip(data.phone, 40);
    const broker = clip(data.broker, 10).toLowerCase();
    const hearAbout = clip(data.hearAbout, 255);
    const comments = clip(data.comments, 4000);
    const consent = data.consent === true || ['yes', 'on', 'true', '1'].includes(String(data.consent || '').toLowerCase()) ? 'yes' : '';
    const sourcePath = clip(data.sourcePath, 255);
    const utmSource = clip(data.utmSource, 255);
    const utmMedium = clip(data.utmMedium, 255);
    const utmCampaign = clip(data.utmCampaign, 255);

    const required = { firstName, lastName, email, phone, broker, hearAbout, consent };
    const missing = Object.keys(required).filter((k) => !required[k]);
    const badOptions = [];
    if (broker && !['yes', 'no'].includes(broker)) badOptions.push(`broker "${broker}" is not Yes or No`);
    if (hearAbout && !HEAR_ABOUT_OPTIONS.includes(hearAbout)) badOptions.push(`hearAbout "${hearAbout}" is not one of the dropdown options`);
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const sentVersion = clip(data.formVersion, 40);

    if (!email || (!KEEP_PROVIDER && (missing.length || badOptions.length))) {
      return json({ ok: false, error: 'Please complete the highlighted fields.', missing, badOptions, formVersion: FORM_VERSION }, 400);
    }
    if (!KEEP_PROVIDER && !emailOk) {
      return json({ ok: false, error: 'Please enter a valid email address.', missing: ['email'], formVersion: FORM_VERSION }, 400);
    }

    const issues = [];
    if (missing.length) issues.push(`Missing: ${missing.join(', ')}`);
    issues.push(...badOptions);
    if (!emailOk) issues.push('Email address looks invalid');
    if (sentVersion !== FORM_VERSION) {
      issues.push(sentVersion
        ? `Site files are on form version ${sentVersion} but the Worker is on ${FORM_VERSION}. Re-upload the site files and the Worker together.`
        : `The site didn't send a form version (Worker is on ${FORM_VERSION}). The site JS may be out of date.`);
    }
    const status = issues.length ? 'needs_review' : 'new';
    const note = issues.length ? `Form check: ${issues.join(' | ')}` : null;

    let returning = false;
    if (env.DB) {
      try {
        const existing = await env.DB.prepare(
          'SELECT id FROM inquiries WHERE lower(email) = ? ORDER BY id LIMIT 1'
        ).bind(email.toLowerCase()).first();
        if (existing) {
          returning = true;
          await env.DB.prepare(
            `UPDATE inquiries SET first_name = ?, last_name = ?, phone = COALESCE(?, phone), is_broker = ?, hear_about = ?,
               comments = COALESCE(?, comments), consent = ?,
               status = CASE WHEN ? = 'needs_review' THEN 'needs_review' ELSE status END, note = COALESCE(?, note),
               utm_source = COALESCE(?, utm_source), utm_medium = COALESCE(?, utm_medium), utm_campaign = COALESCE(?, utm_campaign)
             WHERE id = ?`
          ).bind(firstName, lastName, phone || null, broker, hearAbout, comments || null, consent,
            status, note, utmSource || null, utmMedium || null, utmCampaign || null, existing.id).run();
        } else {
          await env.DB.prepare(
            `INSERT INTO inquiries (first_name, last_name, email, phone, is_broker, hear_about, comments, consent, source_path, utm_source, utm_medium, utm_campaign, status, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(firstName, lastName, email.toLowerCase(), phone || null, broker, hearAbout, comments || null, consent,
            sourcePath || null, utmSource || null, utmMedium || null, utmCampaign || null, status, note).run();
        }
      } catch (dbErr) {
        console.error('D1 insert failed (inquiry still emailed if Resend is configured):', dbErr);
      }
    } else {
      console.error('No DB binding, inquiry was not stored, only emailed (if configured).');
    }

    if (emailOk) {
      const reply = sendAutoReply(env, new URL(request.url).origin, { firstName, email });
      if (ctx && ctx.waitUntil) ctx.waitUntil(reply); else await reply;
    }

    const apiKey = env.RESEND_API_KEY;
    const fromEmail = env.FROM_EMAIL;
    const toEmail = env.TO_EMAIL;

    if (!apiKey || !fromEmail || !toEmail) {
      console.error('Resend is not configured: missing RESEND_API_KEY, FROM_EMAIL, or TO_EMAIL.');
      return json({ ok: true, warning: 'stored_without_email', formVersion: FORM_VERSION, issues });
    }

    const html = [
      issues.length ? `<p style="font-family:sans-serif;font-size:14px;background:#fdecea;color:#8a1c12;padding:10px 12px;border-radius:4px;margin:0 0 14px;"><strong>Some fields didn't match the form setup.</strong><br>${issues.map(escapeHtml).join('<br>')}</p>` : '',
      `<h2 style="margin:0 0 12px;font-family:sans-serif;">${returning ? 'Returning registration (details updated)' : 'New registration'} &middot; ${escapeHtml(SITE.name)}</h2>`,
      '<table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;">',
      row('Name', `${escapeHtml(firstName)} ${escapeHtml(lastName)}`),
      row('Email', escapeHtml(email)),
      row('Phone', phone ? escapeHtml(phone) : '-'),
      row('Broker?', broker === 'yes' ? 'Yes' : 'No'),
      row('Heard about us via', escapeHtml(hearAbout)),
      row('Comments', comments ? escapeHtml(comments).replace(/\n/g, '<br>') : '-'),
      row('Consent to updates', consent === 'yes' ? 'Yes' : 'No'),
      row('Source', sourcePath ? escapeHtml(sourcePath) : '-'),
      row('UTM', [utmSource, utmMedium, utmCampaign].filter(Boolean).map(escapeHtml).join(' / ') || '-'),
      '</table>',
    ].join('');

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail,
        to: toEmail.split(',').map((s) => s.trim()).filter(Boolean),
        reply_to: emailOk ? email : undefined,
        subject: `${issues.length ? '[Check] ' : ''}${returning ? 'Returning registration' : 'New registration'}: ${firstName} ${lastName}`,
        html,
      }),
    });

    if (!resendRes.ok) {
      const detail = await resendRes.text();
      console.error('Resend API error:', resendRes.status, detail);
      return json({ ok: true, warning: 'stored_without_email', formVersion: FORM_VERSION, issues });
    }

    return json({ ok: true, formVersion: FORM_VERSION, issues });
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
