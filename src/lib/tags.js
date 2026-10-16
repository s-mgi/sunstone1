import { DEFAULT_TAGS, getSettings, tagsFrom } from './settings.js';

const MAX_CODE = 20000;
const MAX_CUSTOM = 30;
export const PLACEMENTS = ['head', 'body_start', 'body_end'];
export const PAGE_SCOPES = ['all', 'home', 'thankyou', 'privacy'];

const ID_RULES = {
  ga4_id: { re: /^G-[A-Z0-9]{4,20}$/, label: 'Google Analytics ID', example: 'G-XXXXXXXXXX' },
  ads_id: { re: /^AW-\d{6,15}$/, label: 'Google Ads ID', example: 'AW-123456789' },
  ads_conversion_label: { re: /^[A-Za-z0-9_-]{4,64}$/, label: 'Conversion label', example: 'AbC-D_efG1hIjk' },
  gtm_id: { re: /^GTM-[A-Z0-9]{4,12}$/, label: 'Tag Manager ID', example: 'GTM-XXXXXXX' },
  meta_pixel_id: { re: /^\d{6,20}$/, label: 'Meta Pixel ID', example: '1234567890123456' },
  verify_google: { re: /^[A-Za-z0-9_\-]{10,100}$/, label: 'Google verification code' },
  verify_bing: { re: /^[A-Za-z0-9]{10,100}$/, label: 'Bing verification code' },
  verify_facebook: { re: /^[A-Za-z0-9]{10,100}$/, label: 'Facebook verification code' },
};

export function validateTags(input) {
  const errors = [];
  const warnings = [];
  const tags = { ...DEFAULT_TAGS };
  for (const key of Object.keys(DEFAULT_TAGS)) {
    if (input[key] === undefined || key === 'custom') continue;
    tags[key] = typeof DEFAULT_TAGS[key] === 'boolean' ? !!input[key] : String(input[key] ?? '').trim();
  }
  tags.ga4_id = tags.ga4_id.toUpperCase();
  tags.gtm_id = tags.gtm_id.toUpperCase();
  tags.ads_id = tags.ads_id.toUpperCase();
  tags.verify_google = extractContent(tags.verify_google);
  tags.verify_bing = extractContent(tags.verify_bing);
  tags.verify_facebook = extractContent(tags.verify_facebook);

  for (const [key, rule] of Object.entries(ID_RULES)) {
    if (tags[key] && !rule.re.test(tags[key])) errors.push(`${rule.label} "${tags[key]}" doesn't look right${rule.example ? ` (it should look like ${rule.example})` : ''}.`);
  }
  if (tags.ga4_on && !tags.ga4_id) errors.push('Add a Google Analytics ID or turn it off.');
  if (tags.ads_on && !tags.ads_id) errors.push('Add a Google Ads ID or turn it off.');
  if (tags.gtm_on && !tags.gtm_id) errors.push('Add a Tag Manager ID or turn it off.');
  if (tags.meta_pixel_on && !tags.meta_pixel_id) errors.push('Add a Meta Pixel ID or turn it off.');
  if (tags.ads_conversion_value && !/^\d+(\.\d{1,2})?$/.test(tags.ads_conversion_value)) errors.push('Conversion value should be a number like 1.0.');
  if (!/^[A-Z]{3}$/.test(tags.ads_conversion_currency || '')) errors.push('Conversion currency should be a 3-letter code like CAD.');
  if (tags.gtm_on && tags.ga4_on) warnings.push('Tag Manager and Google Analytics are both on. If your Tag Manager container also loads GA4, visits will be counted twice.');

  if (Array.isArray(input.custom)) {
    if (input.custom.length > MAX_CUSTOM) errors.push(`You can have up to ${MAX_CUSTOM} custom tags.`);
    tags.custom = input.custom.slice(0, MAX_CUSTOM).map((t, i) => ({
      name: String((t && t.name) || '').trim().slice(0, 80) || `Custom tag ${i + 1}`,
      placement: PLACEMENTS.includes(t && t.placement) ? t.placement : 'head',
      pages: PAGE_SCOPES.includes(t && t.pages) ? t.pages : 'all',
      on: !!(t && t.on),
      code: String((t && t.code) || '').trim(),
    }));
  }
  tags.custom.forEach((t) => {
    const problem = checkCode(t.code);
    if (problem) errors.push(`${t.name}: ${problem}`);
    else if (t.on && !t.code) errors.push(`${t.name}: paste its code or turn it off.`);
  });
  return { ok: errors.length === 0, errors, warnings, tags };
}

function extractContent(v) {
  const m = /content\s*=\s*["']([^"']+)["']/i.exec(v || '');
  return (m ? m[1] : v || '').trim();
}

export function checkCode(code) {
  if (!code) return '';
  if (code.length > MAX_CODE) return `it's too long (over ${MAX_CODE.toLocaleString()} characters).`;
  if (/<\/?(html|head|body)\b/i.test(code)) return "it can't contain <html>, <head> or <body> tags. Paste only what goes inside them.";
  if (/<\?php|<%/.test(code)) return "it looks like server code, which won't run here.";
  const opens = (code.match(/<script\b/gi) || []).length;
  const closes = (code.match(/<\/script\s*>/gi) || []).length;
  if (opens !== closes) return `it has ${opens} opening <script> tag${opens === 1 ? '' : 's'} but ${closes} closing </script> tag${closes === 1 ? '' : 's'}.`;
  for (const tag of ['noscript', 'style', 'iframe']) {
    const o = (code.match(new RegExp(`<${tag}\\b`, 'gi')) || []).length;
    const c = (code.match(new RegExp(`</${tag}\\s*>`, 'gi')) || []).length;
    if (o !== c) return `the <${tag}> tags aren't closed properly.`;
  }
  const outside = code.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<style\b[\s\S]*?<\/style\s*>/gi, '').replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  if (/<(?!\/?(meta|link|script|noscript|style|img|iframe|div|span)\b)[a-z]/i.test(outside)) {
    return 'it contains HTML tags that tracking snippets normally don\'t use. Paste only the snippet your provider gave you.';
  }
  return '';
}

function inlineJs(s) {
  return JSON.stringify(String(s)).replace(/</g, '\\u003c');
}

function attr(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function buildTagHtml(tags, { page = 'home', inFrame = false, safeMode = false } = {}) {
  const head = [];
  const bodyStart = [];
  const bodyEnd = [];

  if (page === 'home') {
    if (tags.verify_google) head.push(`<meta name="google-site-verification" content="${attr(tags.verify_google)}">`);
    if (tags.verify_bing) head.push(`<meta name="msvalidate.01" content="${attr(tags.verify_bing)}">`);
    if (tags.verify_facebook) head.push(`<meta name="facebook-domain-verification" content="${attr(tags.verify_facebook)}">`);
  }

  const ga4 = tags.ga4_on && tags.ga4_id ? tags.ga4_id : '';
  const ads = tags.ads_on && tags.ads_id ? tags.ads_id : '';
  const gtm = tags.gtm_on && tags.gtm_id ? tags.gtm_id : '';
  const pixel = tags.meta_pixel_on && tags.meta_pixel_id ? tags.meta_pixel_id : '';

  if (ga4 || ads || gtm) {
    head.push(`<script>window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);}</script>`);
  }
  if (!inFrame) {
    if (ga4 || ads) {
      const ids = [ga4, ads].filter(Boolean);
      const lines = ids.map((id) => `  gtag('config', ${inlineJs(id)});`);
      if (page === 'thankyou' && ads && tags.ads_conversion_label) {
        lines.push(`  gtag('event', 'conversion', { 'send_to': ${inlineJs(`${ads}/${tags.ads_conversion_label}`)}, 'value': ${Number(tags.ads_conversion_value || 0)}, 'currency': ${inlineJs(tags.ads_conversion_currency || 'CAD')} });`);
      }
      head.push(`<script async src="https://www.googletagmanager.com/gtag/js?id=${attr(ids[0])}"></script>
<script>
if (window.self === window.top) {
  gtag('js', new Date());
${lines.join('\n')}
}
</script>`);
    }
    if (gtm) {
      head.push(`<script>if (window.self === window.top) { (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${inlineJs(gtm)}); }</script>`);
      bodyStart.push(`<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${attr(gtm)}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`);
    }
    if (pixel) {
      const leadEvent = page === 'thankyou' ? `\n  fbq('track', 'Lead');` : '';
      head.push(`<script>
if (window.self === window.top) {
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', ${inlineJs(pixel)});
  fbq('track', 'PageView');${leadEvent}
}
</script>`);
    }
    if (tags.custom_on && !safeMode) {
      const pageKey = page === 'page' ? 'privacy' : page;
      const target = { head, body_start: bodyStart, body_end: bodyEnd };
      for (const t of Array.isArray(tags.custom) ? tags.custom : []) {
        if (!t.on || !t.code || checkCode(t.code)) continue;
        if (t.pages !== 'all' && t.pages !== pageKey) continue;
        (target[t.placement] || head).push(t.code);
      }
    }
  }

  return { head: head.join('\n'), bodyStart: bodyStart.join('\n'), bodyEnd: bodyEnd.join('\n') };
}

export async function injectTags(html, request, env, page, settings) {
  let tags = DEFAULT_TAGS;
  try { tags = tagsFrom(settings || await getSettings(env)); } catch (err) { console.error('tags read failed:', err); }
  const url = new URL(request.url);
  const inFrame = (request.headers.get('Sec-Fetch-Dest') || '') === 'iframe';
  const safeMode = url.searchParams.get('notags') === '1';
  const out = buildTagHtml(tags, { page, inFrame, safeMode });
  return html
    .replace('<!--cms:head_tags-->', () => out.head)
    .replace('<!--cms:body_start_tags-->', () => out.bodyStart)
    .replace('<!--cms:body_end_tags-->', () => out.bodyEnd);
}
