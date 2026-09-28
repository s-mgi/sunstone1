// Sunstone Towns render.js
// Injects CMS-managed fields into index.html ("/") and thank-you.html.
// Every token has a `plain` fallback equal to the current live copy (and to
// the seed rows in migrations/0001_init.sql), so if D1 is unreachable or a
// field was never set, the original page renders unchanged.
//
// Conventions:
//   - Plain text is always HTML-escaped.
//   - Keys in MULTILINE are headings: a line break typed in the admin
//     becomes a <br> on the page.
//   - Image fields hold a file name inside assets/images/.
//   - List fields are JSON, read with safeParse and a fallback.
//   - Absolute URLs (og:image, JSON-LD) are built from canonical_url.

const IMG_DIR = 'assets/images/';

export const HOME_PLAIN = {
  seo_title: 'Sunstone Towns — Freehold Townhomes in Vaughan | Edenbrook Homes',
  seo_description: "Coming soon to Vaughan: Sunstone Towns, a collection of freehold townhomes up to 2,427 sq.ft. from the $900's by Edenbrook Homes. Register today for priority access.",
  // Single source for every absolute URL below. Also keep robots.txt and
  // sitemap.xml (static files) pointing at the same domain.
  canonical_url: 'https://sunstonetowns.com/',
  og_title: 'Sunstone Towns — Freehold Townhomes in Vaughan',
  og_description: "Freehold townhomes up to 2,427 sq.ft. from the $900's. A community by Edenbrook Homes. Register for priority access.",
  og_image: 'assets/images/hero.jpg',
  favicon_href: 'assets/favicon.svg',

  hero_headline: 'A Brighter\nWay Home.',
  hero_tag: 'Freehold Townhomes · Vaughan',
  hero_sqft: '2,427',
  hero_price_label: 'From the',
  hero_price: "$900's",

  vision_heading: 'Designed\nFor The Way\nLife Moves.',
  vision_copy: "Sunstone Towns is where inspired design meets everyday convenience in the heart of Vaughan. Freehold townhomes with the space you live today — and the life you're building tomorrow.",
  vision_image: 'vision-building.jpg',
  vision_image_alt: 'Open parkland and meadow trails at sunset near Sunstone Towns',

  homes_heading: 'Room to Live.\nSpace to Become.',
  homes_copy: 'Thoughtfully laid out freehold townhomes with open-concept interiors, elevated finishes, and seamless indoor-outdoor living.',
  homes_image_main: 'homes-living.jpg',
  homes_image_main_alt: 'A couple relaxing in a sunlit open-concept living room',
  homes_image_thumb1: 'homes-details.jpg',
  homes_image_thumb1_alt: 'Quiet afternoon at home — wooden puzzle and coffee on the living room table',
  homes_image_thumb2: 'homes-bedroom.jpg',
  homes_image_thumb2_alt: 'Primary bedroom with floor-to-ceiling windows',
  homes_image_side: 'homes-patio.jpg',
  homes_image_side_alt: 'Reading with a coffee on a private outdoor terrace',

  setting_heading: 'Close to\nWhat Counts.',
  setting_lede: 'A connected address in Vaughan with transit, shopping, dining, and major routes just minutes away.',

  map_heading: 'Everything Nearby.',
  map_lede: 'Explore the amenities, transit, and green space that surround Sunstone Towns — click any point to locate it on the map.',

  community_heading: 'Rooted Here.\nConnected Everywhere.',
  community_copy: 'Beautifully planned streetscapes, green spaces, and gathering places create a neighbourhood where connections grow and life comes together.',
  community_image: 'community-trail.jpg',
  community_image_alt: 'Cyclists on the community trail through autumn green space',

  register_heading: 'Be First\nin Line.',
  register_lede: 'Register for priority access to floorplans, pricing and updates.',
};

export const DEFAULT_HERO_IMAGES = [
  { file: 'hero.jpg', alt: 'A GO train passing the wooded trail network beside Sunstone Towns' },
  { file: 'hero-2.jpg', alt: 'Vaughan Mills shopping and entertainment centre near Sunstone Towns' },
  { file: 'hero-3.jpg', alt: "Canada's Wonderland amusement park near Sunstone Towns" },
  { file: 'hero-4.jpg', alt: 'Community recreation centre near Sunstone Towns' },
];

export const DEFAULT_HOMES_SPECS = [
  { value: '2, 3, & 4', label: 'Bedrooms' },
  { value: 'Up to 2,427', label: 'Sq. Ft.' },
  { value: 'Private', label: 'Outdoor Space' },
];

export const DEFAULT_SETTING_ITEMS = [
  { title: 'Go Transit', place: 'Rutherford GO Station', distance: '6 min walk', image: 'setting-transit.jpg', alt: 'GO Transit train at a nearby Vaughan station' },
  { title: 'Shop & Dine', place: 'Vaughan Mills', distance: '5 min drive', image: 'setting-shops.jpg', alt: 'Friends sharing an outdoor dinner under string lights' },
  { title: 'Top-Rated Schools', place: 'Stephen Lewis Secondary', distance: '4 min drive', image: 'setting-schools.jpg', alt: 'Stephen Lewis Secondary School, 555 Autumn Hill Blvd, Thornhill' },
];

export const THANKYOU_PLAIN = {
  thankyou_headline: 'Thank You.',
  thankyou_lede: "You're on the list. A member of the Sunstone Towns team will be in touch soon with floorplans, pricing, and priority updates.",
  thankyou_note: 'In the meantime, take another look around the community.',
};

// Headings where a typed line break becomes <br>. register_heading keeps the
// site's responsive break class.
const MULTILINE = {
  hero_headline: '<br>',
  vision_heading: '<br>',
  homes_heading: '<br>',
  setting_heading: '<br>',
  community_heading: '<br>',
  register_heading: '<br class="register__break"> ',
  thankyou_headline: '<br>',
};

async function loadFields(env) {
  const fields = {};
  try {
    const { results } = await env.DB.prepare('SELECT key, value FROM content_fields').all();
    for (const row of results) fields[row.key] = row.value;
  } catch (err) {
    console.error('CMS content_fields read failed:', err);
  }
  return fields;
}

function fieldHtml(key, value) {
  let out = escapeHtml(value);
  if (MULTILINE[key]) out = out.replace(/\s*\r?\n\s*/g, MULTILINE[key]);
  if (key === 'hero_tag') out = out.replace(/ · /g, '&nbsp;·&nbsp;');
  return out;
}

// Renders "/" with CMS-managed fields injected into index.html.
export async function renderHome(request, env) {
  const assetRes = await env.ASSETS.fetch(request);
  const contentType = assetRes.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return assetRes; // safety net

  let html = await assetRes.text();
  const fields = await loadFields(env);

  const resolved = {};
  for (const [key, fallback] of Object.entries(HOME_PLAIN)) {
    const v = fields[key];
    resolved[key] = v === undefined || v === null || v === '' ? fallback : v;
  }

  const origin = String(resolved.canonical_url).replace(/\/$/, '');
  const absolutize = (path) => (/^https?:\/\//i.test(path) ? path : `${origin}/${String(path).replace(/^\//, '')}`);
  resolved.og_image = absolutize(resolved.og_image);

  for (const [key, value] of Object.entries(resolved)) {
    html = html.split(`{{cms:${key}}}`).join(fieldHtml(key, value));
  }
  html = html
    .split('{{cms:jsonld_url}}').join(jsonStr(origin + '/'))
    .split('{{cms:jsonld_image}}').join(jsonStr(absolutize('assets/images/hero.jpg')))
    .split('{{cms:jsonld_logo}}').join(jsonStr(absolutize('assets/email/edenbrook-logo.png')));

  // Hero slideshow + matching dots
  let heroImages = safeParse(fields.hero_images, DEFAULT_HERO_IMAGES);
  if (!Array.isArray(heroImages) || !heroImages.length) heroImages = DEFAULT_HERO_IMAGES;
  const slidesHtml = heroImages.map((img, i) => (
    `<div class="hero-slider__slide${i === 0 ? ' is-active' : ''}">\n        ` +
    `<img src="${IMG_DIR}${escapeHtml(img.file)}" alt="${escapeHtml(img.alt || '')}" loading="${i === 0 ? 'eager' : 'lazy'}">\n      </div>`
  )).join('\n      ');
  const dotsHtml = heroImages.map((_, i) => (
    `<button type="button" class="hero-slider__dot${i === 0 ? ' is-active' : ''}" aria-label="Show image ${i + 1}"></button>`
  )).join('\n      ');
  html = html.replace('{{cms:hero_slides_html}}', slidesHtml).replace('{{cms:hero_dots_html}}', dotsHtml);

  // Homes spec strip
  let specs = safeParse(fields.homes_specs, DEFAULT_HOMES_SPECS);
  if (!Array.isArray(specs) || !specs.length) specs = DEFAULT_HOMES_SPECS;
  html = html.replace('{{cms:homes_specs_html}}', specs.map((s) => (
    `<div><strong>${escapeHtml(s.value || '')}</strong><span>${escapeHtml(s.label || '')}</span></div>`
  )).join('\n        <div class="divider"></div>\n        '));

  // Setting list + photo row (same items drive both)
  let items = safeParse(fields.setting_items, DEFAULT_SETTING_ITEMS);
  if (!Array.isArray(items) || !items.length) items = DEFAULT_SETTING_ITEMS;
  html = html.replace('{{cms:setting_list_html}}', items.map((it, i) => (
    `<li>\n          <span class="setting__num">${String(i + 1).padStart(2, '0')}</span>\n          <div>\n            ` +
    `<strong>${escapeHtml(it.title || '')}</strong>\n            <span>${escapeHtml(it.place || '')}<br>${escapeHtml(it.distance || '')}</span>\n          </div>\n        </li>`
  )).join('\n        '));
  html = html.replace('{{cms:setting_photos_html}}', items.map((it) => (
    `<div class="setting__photo">\n        <img src="${IMG_DIR}${escapeHtml(it.image || '')}" alt="${escapeHtml(it.alt || '')}" loading="lazy">\n        ` +
    `<span class="setting__photo-tag">${escapeHtml(it.title || '')}</span>\n      </div>`
  )).join('\n      '));

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
}

// Renders "/thank-you.html" (and "/thank-you").
export async function renderThankYou(request, env) {
  const assetRes = await env.ASSETS.fetch(request);
  const contentType = assetRes.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return assetRes; // safety net

  let html = await assetRes.text();
  const fields = await loadFields(env);

  for (const [key, fallback] of Object.entries(THANKYOU_PLAIN)) {
    const v = fields[key];
    const value = v === undefined || v === null || v === '' ? fallback : v;
    html = html.split(`{{cms:${key}}}`).join(fieldHtml(key, value));
  }

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
}

function safeParse(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

// For values placed inside a JSON-LD string: JSON-escape, drop the quotes,
// and make sure nothing can close the <script> tag.
function jsonStr(s) {
  return JSON.stringify(String(s)).slice(1, -1).replace(/</g, '\\u003c');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
