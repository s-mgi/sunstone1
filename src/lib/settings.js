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

export const PERMISSIONS = [
  { key: 'edit', label: 'Edit pages', desc: 'Change the text and photos on the site.' },
  { key: 'gallery', label: 'Gallery', desc: 'Upload, sort and delete photos.' },
  { key: 'registrations', label: 'Registrations', desc: 'See leads from the site form, change their status, import, export and delete them.' },
  { key: 'contacts', label: 'Contacts', desc: 'See and import the contact list.' },
  { key: 'eblast', label: 'Eblast', desc: 'Build and send email blasts.' },
  { key: 'seo', label: 'SEO & Analytics', desc: 'Run the SEO audit, change search and social settings, see visitor stats.' },
  { key: 'tags', label: 'Tags', desc: 'Add or change Google Analytics, ad pixels and other tracking code.' },
  { key: 'logs', label: 'Logs', desc: 'See site problems and the activity log of every change.' },
  { key: 'users', label: 'Users', desc: 'Add, edit and remove Managers and Editors, and reset their passwords.' },
  { key: 'features', label: 'Features', desc: 'Switch dashboard features on or off for everyone.' },
  { key: 'notifications', label: 'Email alerts', desc: 'Change who gets emailed about form errors.' },
];

export const EDITABLE_ROLES = ['manager', 'editor'];

export const DEFAULT_PERMISSIONS = {
  manager: { edit: true, gallery: true, registrations: true, contacts: true, eblast: true, seo: true, tags: false, logs: true, users: true, features: false, notifications: true },
  editor: { edit: true, gallery: true, registrations: true, contacts: true, eblast: false, seo: true, tags: false, logs: false, users: false, features: false, notifications: false },
};

export function permissionsFrom(settings) {
  const saved = (settings && settings.permissions) || {};
  const out = {};
  for (const role of EDITABLE_ROLES) {
    out[role] = {};
    for (const p of PERMISSIONS) {
      const v = saved[role] && saved[role][p.key];
      out[role][p.key] = typeof v === 'boolean' ? v : DEFAULT_PERMISSIONS[role][p.key];
    }
  }
  return out;
}

export function userPermissions(user, settings) {
  if (user.owner || user.role === 'admin') return Object.fromEntries(PERMISSIONS.map((p) => [p.key, true]));
  return permissionsFrom(settings)[user.role === 'manager' ? 'manager' : 'editor'];
}

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
