export const FEATURES = [
  { key: 'gallery', label: 'Gallery', desc: 'The Gallery tab for uploading and managing images.' },
  { key: 'registrations', label: 'Registrations', desc: 'The Registrations tab and its import. The form on the site keeps saving leads either way.' },
  { key: 'contacts', label: 'Contacts', desc: 'The Contacts tab and its CSV import.' },
  { key: 'eblast', label: 'Eblast', desc: 'Building and sending email blasts. Unsubscribe links keep working either way.' },
  { key: 'seo', label: 'SEO & Analytics', desc: 'The SEO audit, search and social settings, analytics and tags. Saved tags keep running on the site either way.' },
  { key: 'autoreply', label: 'Auto-reply email', desc: 'The thank-you email the site sends each new registrant. Turn this off if Keap sends its own.' },
];

export const DEFAULT_FEATURES = Object.fromEntries(FEATURES.map((f) => [f.key, true]));

export const DEFAULT_TAGS = {
  ga4_id: 'G-79BMJG9WBP',
  ga4_on: true,
  ads_id: 'AW-18490114228',
  ads_on: true,
  ads_conversion_label: 'ArjtCJTiiY4dELSB4_BE',
  ads_conversion_value: '1.0',
  ads_conversion_currency: 'CAD',
  gtm_id: '',
  gtm_on: false,
  meta_pixel_id: '',
  meta_pixel_on: false,
  verify_google: '',
  verify_bing: '',
  verify_facebook: '',
  custom_on: true,
  custom: [
    {
      name: 'Keap web tracking',
      placement: 'body_end',
      pages: 'home',
      on: true,
      code: '<script type="text/javascript" src="https://wu242.infusionsoft.app/app/webTracking/getTrackingCode"></script>',
    },
  ],
};

export const DEFAULT_LOG_SETTINGS = { email_alerts: false, alert_to: '' };

export async function getSettings(env) {
  const out = {};
  if (!env.DB) return out;
  try {
    const { results } = await env.DB.prepare('SELECT key, value FROM site_settings').all();
    for (const row of results) {
      try { out[row.key] = JSON.parse(row.value); } catch { out[row.key] = null; }
    }
  } catch (err) {
    console.error('site_settings read failed:', err);
  }
  return out;
}

export async function putSetting(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, JSON.stringify(value)).run();
}

export function featuresFrom(settings) {
  return { ...DEFAULT_FEATURES, ...((settings && settings.features) || {}) };
}

export function tagsFrom(settings) {
  return { ...DEFAULT_TAGS, ...((settings && settings.tags) || {}) };
}

export function logSettingsFrom(settings) {
  return { ...DEFAULT_LOG_SETTINGS, ...((settings && settings.logs) || {}) };
}

export async function getFeatures(env) {
  return featuresFrom(await getSettings(env));
}
