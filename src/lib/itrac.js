import { logError } from './errors.js';

export function itracFields(lead) {
  return {
    FirstName: lead.firstName,
    LastName: lead.lastName,
    Email: lead.email,
    Phone: lead.phone,
    Realtor: lead.broker === 'yes' ? 'Yes' : lead.broker === 'no' ? 'No' : '',
    HowDidYouHear: lead.hearAbout,
    Comments: lead.comments,
    Consent: lead.consent === 'yes' ? 'Yes' : 'No',
    ConsentDate: lead.consent === 'yes' ? new Date().toISOString() : '',
    SourcePage: lead.sourcePath,
    UTMSource: lead.utmSource,
    UTMMedium: lead.utmMedium,
    UTMCampaign: lead.utmCampaign,
  };
}

export async function sendToItrac(env, lead) {
  const url = env.ITRAC_POST_URL;
  if (!url) return;
  const leadName = `${lead.firstName} ${lead.lastName}`.trim() || lead.email;
  try {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(itracFields(lead))) body.append(k, v || '');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 500);
      await logError(env, { area: 'form', message: 'A registration was not accepted by iTrac', detail: `Lead: ${leadName} <${lead.email}> (saved in the CMS)\niTrac said (${res.status}): ${detail}`, path: lead.sourcePath });
    }
  } catch (err) {
    await logError(env, { area: 'form', message: 'A registration could not be sent to iTrac', detail: `Lead: ${leadName} <${lead.email}> (saved in the CMS)\n${err && err.message ? err.message : err}`, path: lead.sourcePath });
  }
}
