// The admin API — inquiries, content fields, edit log, SEO check.
import { renderHome } from './render.js';

const VALID_STATUSES = ['new', 'contacted', 'qualified', 'toured', 'closed', 'lost', 'needs_review'];

export async function listInquiries(request, env) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const format = url.searchParams.get('format');

  let query = 'SELECT * FROM inquiries';
  const binds = [];
  if (status) { query += ' WHERE status = ?'; binds.push(status); }
  query += ' ORDER BY created_at DESC LIMIT 500';

  const { results } = await env.DB.prepare(query).bind(...binds).all();

  if (format === 'csv') {
    const cols = ['id', 'created_at', 'first_name', 'last_name', 'email', 'phone', 'purchase_timeframe', 'hear_about', 'comments', 'consent', 'source_path', 'utm_source', 'utm_medium', 'utm_campaign', 'status', 'note'];
    const lines = [cols.join(',')];
    for (const row of results) lines.push(cols.map((c) => csvEscape(row[c])).join(','));
    return new Response(lines.join('\n'), {
      headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="inquiries.csv"' },
    });
  }
  return json({ ok: true, inquiries: results });
}

// The Contacts tab's "+ Add contact" button — a manual addition to the
// eblast recipient list that didn't come through the registration form.
// Lives in the same inquiries table Registrations and Eblast both already
// read from, tagged source_path = 'manual' so Contacts can tell them apart;
// nothing else in the pipeline (status, edit log, unsubscribe) needs to
// know or care that this row didn't come from a real registration.
export async function createInquiry(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON body.' }, 400); }

  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'Enter a valid email address.' }, 400);

  const firstName = String(body.first_name || '').trim();
  const lastName = String(body.last_name || '').trim();
  const phone = String(body.phone || '').trim();
  const editor = decodeEditor(env);

  const res = await env.DB.prepare(
    `INSERT INTO inquiries (first_name, last_name, email, phone, source_path, status) VALUES (?, ?, ?, ?, 'manual', 'new')`
  ).bind(firstName, lastName, email, phone || null).run();
  const id = res.meta.last_row_id;

  await env.DB.prepare(
    'INSERT INTO edit_log (editor, entity_type, entity_key, old_value, new_value, note) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(editor, 'inquiry', String(id), null, email, 'contact added manually').run();

  const created = await env.DB.prepare('SELECT * FROM inquiries WHERE id = ?').bind(id).first();
  return json({ ok: true, inquiry: created });
}

const IMPORT_MAX_ROWS = 2000; // a sanity cap, not a real technical limit — keeps one bad paste from hanging the request
const IMPORT_CHUNK = 50; // rows per D1 batch call, mirrors the eblast send chunking for the same subrequest-budget reason

// The Contacts tab's "Import CSV" button — bulk-adds a mailing list a
// client hands over (a spreadsheet export, a list from another platform).
// Matches existing contacts by email (case-insensitive) and only fills in
// name/phone where they're currently blank, so it never clobbers data
// someone already entered by hand; anything new comes in tagged
// source_path = 'import', same idea as 'manual' for the add-one-at-a-time flow.
export async function importContacts(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON body.' }, 400); }

  const csvText = String(body.csv || '');
  if (!csvText.trim()) return json({ ok: false, error: 'No CSV content received.' }, 400);

  const rows = parseCsv(csvText);
  if (!rows.length) return json({ ok: false, error: 'Could not find any rows in that file.' }, 400);

  const header = rows[0].map((h) => String(h || '').trim().toLowerCase());
  const colOf = (names) => { for (const n of names) { const i = header.indexOf(n); if (i !== -1) return i; } return -1; };
  const emailIdx = colOf(['email', 'email address', 'e-mail']);
  if (emailIdx === -1) return json({ ok: false, error: 'Could not find an "email" column in the CSV header. The first row must have a column named "email".' }, 400);
  const firstIdx = colOf(['first_name', 'first name', 'first', 'firstname']);
  const lastIdx = colOf(['last_name', 'last name', 'last', 'lastname']);
  const nameIdx = colOf(['name', 'full name', 'contact name']);
  const phoneIdx = colOf(['phone', 'phone number', 'mobile', 'cell']);

  const dataRows = rows.slice(1).filter((r) => r.some((c) => String(c || '').trim() !== ''));
  if (!dataRows.length) return json({ ok: false, error: 'That file has a header row but no contacts under it.' }, 400);
  if (dataRows.length > IMPORT_MAX_ROWS) {
    return json({ ok: false, error: `That file has ${dataRows.length} rows — split it into batches of ${IMPORT_MAX_ROWS} or fewer and import each separately.` }, 400);
  }

  const { results: existing } = await env.DB.prepare('SELECT id, email, first_name, last_name, phone FROM inquiries').all();
  const byEmail = new Map(existing.map((r) => [r.email.toLowerCase(), r]));

  const editor = decodeEditor(env);
  const inserts = [];
  const updates = [];
  const errors = [];
  let skipped = 0;

  dataRows.forEach((r, i) => {
    const email = String(r[emailIdx] || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      skipped++;
      if (errors.length < 20) errors.push(`Row ${i + 2}: missing or invalid email`);
      return;
    }

    let firstName = firstIdx !== -1 ? String(r[firstIdx] || '').trim() : '';
    let lastName = lastIdx !== -1 ? String(r[lastIdx] || '').trim() : '';
    if (!firstName && !lastName && nameIdx !== -1) {
      const parts = String(r[nameIdx] || '').trim().split(/\s+/).filter(Boolean);
      firstName = parts.shift() || '';
      lastName = parts.join(' ');
    }
    const phone = phoneIdx !== -1 ? String(r[phoneIdx] || '').trim() : '';

    const existingRow = byEmail.get(email);
    if (existingRow) {
      // Only fill in blanks — never overwrite something already on file.
      const newFirst = !existingRow.first_name && firstName ? firstName : null;
      const newLast = !existingRow.last_name && lastName ? lastName : null;
      const newPhone = !existingRow.phone && phone ? phone : null;
      if (newFirst || newLast || newPhone) {
        updates.push({ id: existingRow.id, first_name: newFirst, last_name: newLast, phone: newPhone });
      } else {
        skipped++;
      }
    } else {
      inserts.push({ email, first_name: firstName, last_name: lastName, phone });
      byEmail.set(email, { id: null, email, first_name: firstName, last_name: lastName, phone }); // catch dupes within the same file
    }
  });

  for (let i = 0; i < inserts.length; i += IMPORT_CHUNK) {
    const chunk = inserts.slice(i, i + IMPORT_CHUNK);
    const stmt = env.DB.prepare(
      `INSERT INTO inquiries (first_name, last_name, email, phone, source_path, status) VALUES (?, ?, ?, ?, 'import', 'new')`
    );
    await env.DB.batch(chunk.map((c) => stmt.bind(c.first_name, c.last_name, c.email, c.phone || null)));
  }
  for (let i = 0; i < updates.length; i += IMPORT_CHUNK) {
    const chunk = updates.slice(i, i + IMPORT_CHUNK);
    await env.DB.batch(chunk.map((u) => {
      const sets = [];
      const binds = [];
      if (u.first_name) { sets.push('first_name = ?'); binds.push(u.first_name); }
      if (u.last_name) { sets.push('last_name = ?'); binds.push(u.last_name); }
      if (u.phone) { sets.push('phone = ?'); binds.push(u.phone); }
      binds.push(u.id);
      return env.DB.prepare(`UPDATE inquiries SET ${sets.join(', ')} WHERE id = ?`).bind(...binds);
    }));
  }

  if (inserts.length || updates.length) {
    await env.DB.prepare(
      'INSERT INTO edit_log (editor, entity_type, entity_key, old_value, new_value, note) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(editor, 'inquiry', 'bulk', null, null, `CSV import: ${inserts.length} added, ${updates.length} updated, ${skipped} skipped`).run();
  }

  return json({ ok: true, imported: inserts.length, updated: updates.length, skipped, total: dataRows.length, errors });
}

// Minimal RFC 4180-ish CSV parser: handles quoted fields, commas and
// newlines inside quotes, and doubled "" as an escaped quote. Good enough
// for a spreadsheet export without pulling in a dependency for one function.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushRow();
    } else if (c === '\r') {
      // swallow, \n (or end of text) handles the row break
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) pushRow();
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

export async function patchInquiry(request, env, id) {
  const current = await env.DB.prepare('SELECT * FROM inquiries WHERE id = ?').bind(id).first();
  if (!current) return json({ ok: false, error: 'Inquiry not found.' }, 404);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON body.' }, 400); }

  const updates = [];
  const binds = [];
  const editor = decodeEditor(env);
  const log = (key, oldVal, newVal, note) => env.DB.prepare(
    'INSERT INTO edit_log (editor, entity_type, entity_key, old_value, new_value, note) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(editor, 'inquiry', String(id), oldVal, newVal, note).run();

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) {
      return json({ ok: false, error: `Status must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
    }
    if (body.status !== current.status) {
      updates.push('status = ?'); binds.push(body.status);
      await log('status', current.status, body.status, 'status change');
    }
  }
  if (body.note !== undefined && body.note !== current.note) {
    updates.push('note = ?'); binds.push(body.note);
    await log('note', current.note || '', body.note, 'note updated');
  }
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'Enter a valid email address.' }, 400);
    if (email !== current.email) {
      updates.push('email = ?'); binds.push(email);
      await log('email', current.email, email, 'email updated');
    }
  }
  if (body.first_name !== undefined && body.first_name !== current.first_name) {
    updates.push('first_name = ?'); binds.push(String(body.first_name).trim());
    await log('first_name', current.first_name, body.first_name, 'name updated');
  }
  if (body.last_name !== undefined && body.last_name !== current.last_name) {
    updates.push('last_name = ?'); binds.push(String(body.last_name).trim());
    await log('last_name', current.last_name, body.last_name, 'name updated');
  }
  if (body.phone !== undefined) {
    const phone = String(body.phone).trim();
    if (phone !== (current.phone || '')) {
      updates.push('phone = ?'); binds.push(phone || null);
      await log('phone', current.phone || '', phone, 'phone updated');
    }
  }
  if (body.unsubscribed !== undefined) {
    const unsub = body.unsubscribed ? 1 : 0;
    if (unsub !== current.unsubscribed) {
      updates.push('unsubscribed = ?'); binds.push(unsub);
      await log('unsubscribed', String(current.unsubscribed), String(unsub), unsub ? 'unsubscribed manually' : 'resubscribed manually');
    }
  }

  if (updates.length === 0) return json({ ok: true, inquiry: current, changed: false });

  binds.push(id);
  await env.DB.prepare(`UPDATE inquiries SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
  const updated = await env.DB.prepare('SELECT * FROM inquiries WHERE id = ?').bind(id).first();
  return json({ ok: true, inquiry: updated, changed: true });
}

export async function deleteInquiry(request, env, id) {
  const current = await env.DB.prepare('SELECT * FROM inquiries WHERE id = ?').bind(id).first();
  if (!current) return json({ ok: false, error: 'Inquiry not found.' }, 404);

  const editor = decodeEditor(env);
  await env.DB.prepare(
    'INSERT INTO edit_log (editor, entity_type, entity_key, old_value, new_value, note) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(editor, 'inquiry', String(id), `${current.first_name} ${current.last_name} <${current.email}>`, null, 'deleted').run();

  await env.DB.prepare('DELETE FROM inquiries WHERE id = ?').bind(id).run();
  return json({ ok: true, deleted: id });
}

export async function listContent(env) {
  const { results } = await env.DB.prepare('SELECT key, value, updated_at FROM content_fields ORDER BY key').all();
  return json({ ok: true, fields: results });
}

// Serves a gallery-uploaded image (stored as a base64 data URL in
// content_fields under "gallery_upload__<name>") at a real, public URL —
// needed because email clients can't load a data: URI, they need to fetch
// an actual address. Static files under assets/images/ already have a real URL
// (/assets/images/<file>) and don't need this. Public on purpose: recipients'
// inboxes fetch it anonymously, so it isn't behind admin auth.
export async function serveMedia(env, name) {
  const row = await env.DB.prepare('SELECT value FROM content_fields WHERE key = ?').bind('gallery_upload__' + name).first();
  if (!row || !row.value) return new Response('Not found', { status: 404 });

  const match = /^data:([^;]+);base64,(.*)$/s.exec(row.value);
  if (!match) return new Response('Not found', { status: 404 });

  const [, contentType, b64] = match;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return new Response(bytes, { headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' } });
}

// Fields written automatically by running an audit / performance check —
// these shouldn't clutter the activity log with an entry every time someone
// clicks "Run audit" or checks Lighthouse scores.
const NO_LOG_KEYS = new Set(['seo_audit_history', 'seo_audit_last_score', 'perf_last_score_mobile', 'perf_last_score_desktop', 'perf_last_checked_at']);

export async function putContent(request, env, key) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON body.' }, 400); }
  if (typeof body.value !== 'string') return json({ ok: false, error: 'Body must include a string "value".' }, 400);

  if (looksLikeJson(body.value)) {
    try { JSON.parse(body.value); } catch (e) { return json({ ok: false, error: `Value is not valid JSON: ${e.message}` }, 400); }
  }

  const current = await env.DB.prepare('SELECT value FROM content_fields WHERE key = ?').bind(key).first();
  const oldValue = current ? current.value : null;

  await env.DB.prepare(
    `INSERT INTO content_fields (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, body.value).run();

  if (!NO_LOG_KEYS.has(key)) {
    const editor = decodeEditor(env);
    await env.DB.prepare(
      'INSERT INTO edit_log (editor, entity_type, entity_key, old_value, new_value, note) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(editor, 'content_field', key, oldValue, body.value, body.note || null).run();
  }

  return json({ ok: true, key, value: body.value });
}

export async function listEditLog(request, env) {
  const url = new URL(request.url);
  const entityType = url.searchParams.get('entity_type');
  const entityKey = url.searchParams.get('entity_key');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1000);

  let query = 'SELECT * FROM edit_log';
  const clauses = [];
  const binds = [];
  if (entityType) { clauses.push('entity_type = ?'); binds.push(entityType); }
  if (entityKey) { clauses.push('entity_key = ?'); binds.push(entityKey); }
  if (clauses.length) query += ' WHERE ' + clauses.join(' AND ');
  query += ' ORDER BY created_at DESC LIMIT ?';
  binds.push(limit);

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  return json({ ok: true, entries: results });
}

export async function seoCheck(request, env) {
  const origin = new URL(request.url).origin;
  // Run through the same CMS rendering the live site uses (not a raw asset
  // fetch) so the audit reflects actual current field values, not the
  // unfilled {{cms:...}} template — otherwise a fix made in the CMS would
  // never show up here as resolved.
  const homeRes = await renderHome(new Request(origin + '/'), env);
  const html = await homeRes.text();

  const checks = [];
  const push = (id, label, severity, pass, detail) => checks.push({ id, label, severity, pass, detail });

  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [, ''])[1].trim();
  push('title', 'Title tag', 'blocker', title.length > 0, title ? `"${title}" (${title.length} chars)` : 'Missing title tag');
  if (title) push('title_length', 'Title length (30–60 recommended)', 'warn', title.length >= 30 && title.length <= 60, `${title.length} characters`);

  const desc = (html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']/i) || [, ''])[1];
  push('meta_description', 'Meta description present', 'blocker', desc.length > 0, desc ? `${desc.length} chars` : 'Missing');
  if (desc) push('meta_description_length', 'Meta description length (120–160 recommended)', 'warn', desc.length >= 120 && desc.length <= 160, `${desc.length} characters`);

  const canonical = (html.match(/<link\s+rel=["']canonical["']\s+href=["']([\s\S]*?)["']/i) || [, ''])[1];
  push('canonical', 'Canonical URL set', 'warn', canonical.length > 0, canonical || 'Missing');

  const ogTitle = /<meta\s+property=["']og:title["']/i.test(html);
  const ogDesc = /<meta\s+property=["']og:description["']/i.test(html);
  const ogImage = /<meta\s+property=["']og:image["']/i.test(html);
  push('og_tags', 'Open Graph title/description/image present', 'warn', ogTitle && ogDesc && ogImage,
    [ogTitle ? 'title ok' : 'title missing', ogDesc ? 'description ok' : 'description missing', ogImage ? 'image ok' : 'image missing'].join(', '));

  const ldBlocks = [...html.matchAll(/<script type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi)];
  let ldValid = ldBlocks.length > 0;
  let ldError = ldBlocks.length ? '' : 'No JSON-LD block found';
  for (const m of ldBlocks) { try { JSON.parse(m[1]); } catch (e) { ldValid = false; ldError = e.message; } }
  push('structured_data', 'Structured data (JSON-LD) valid', 'blocker', ldValid, ldError || `${ldBlocks.length} block(s), valid JSON`);

  const imgTags = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const missingAlt = imgTags.filter((tag) => !/\salt=/.test(tag));
  const decorative = imgTags.filter((tag) => /\salt=["']["']/.test(tag) && /aria-hidden=["']true["']/.test(tag));
  push('image_alt', 'All images have alt text (decorative images excluded)', 'blocker', missingAlt.length === 0,
    missingAlt.length === 0 ? `${imgTags.length} images, ${decorative.length} marked decorative` : `${missingAlt.length} of ${imgTags.length} images missing alt`);

  const robotsRes = await env.ASSETS.fetch(new Request(origin + '/robots.txt'));
  const robotsOk = robotsRes.ok;
  let robotsHasSitemap = false;
  if (robotsOk) robotsHasSitemap = /sitemap:/i.test(await robotsRes.text());
  push('robots', 'robots.txt present and references a sitemap', 'warn', robotsOk && robotsHasSitemap,
    robotsOk ? (robotsHasSitemap ? 'ok' : 'present, but no Sitemap: line') : `robots.txt returned ${robotsRes.status}`);

  const sitemapRes = await env.ASSETS.fetch(new Request(origin + '/sitemap.xml'));
  let sitemapValid = false;
  if (sitemapRes.ok) {
    const sitemapText = await sitemapRes.text();
    sitemapValid = /<urlset[\s\S]*<\/urlset>/i.test(sitemapText) && /<loc>/i.test(sitemapText);
  }
  push('sitemap', 'sitemap.xml present and well-formed', 'blocker', sitemapRes.ok && sitemapValid,
    sitemapRes.ok ? (sitemapValid ? 'ok' : 'present, but missing <urlset>/<loc>') : `sitemap.xml returned ${sitemapRes.status}`);

  const htmlNoScripts = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const hrefs = [...htmlNoScripts.matchAll(/href=["'](#[a-zA-Z0-9\-_]+)["']/g)].map((m) => m[1]);
  const ids = new Set([...htmlNoScripts.matchAll(/\sid=["']([a-zA-Z0-9\-_]+)["']/g)].map((m) => m[1]));
  const brokenAnchors = [...new Set(hrefs)].filter((h) => !ids.has(h.slice(1)));
  push('internal_anchors', 'In-page anchor links resolve to a real section', 'warn', brokenAnchors.length === 0,
    brokenAnchors.length === 0 ? 'ok' : `Broken: ${brokenAnchors.join(', ')}`);

  const placeholderHit = /CLIENT TO CONFIRM|TODO|LOREM IPSUM/i.test(html);
  push('placeholder_content', 'No leftover placeholder/TODO markers in shipped HTML', 'warn', !placeholderHit,
    placeholderHit ? 'Found a placeholder marker in the HTML source' : 'ok');

  const blockers = checks.filter((c) => c.severity === 'blocker' && !c.pass).length;
  const warnings = checks.filter((c) => c.severity === 'warn' && !c.pass).length;

  return json({
    ok: true,
    checked_at: new Date().toISOString(),
    url: origin + '/',
    summary: { blockers, warnings, passed: checks.length - blockers - warnings, total: checks.length },
    checks,
  });
}

export async function perfCheck(request, env) {
  const strategy = new URL(request.url).searchParams.get('strategy') === 'desktop' ? 'desktop' : 'mobile';
  const origin = new URL(request.url).origin;
  let apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(origin + '/')}&strategy=${strategy}&category=performance`;
  if (env.PAGESPEED_API_KEY) apiUrl += `&key=${encodeURIComponent(env.PAGESPEED_API_KEY)}`;

  let res;
  try {
    res = await fetch(apiUrl);
  } catch (e) {
    return json({ ok: false, error: `Could not reach Google PageSpeed Insights: ${e.message}` }, 502);
  }
  if (!res.ok) {
    const hint = env.PAGESPEED_API_KEY
      ? `PageSpeed Insights returned ${res.status}. Try again in a minute.`
      : `PageSpeed Insights returned ${res.status}. Without an API key it's shared across everyone hitting Google's anonymous quota, so it gets rate-limited often — add a free PAGESPEED_API_KEY secret to fix this reliably.`;
    return json({ ok: false, error: hint }, 502);
  }

  let data;
  try { data = await res.json(); } catch { return json({ ok: false, error: 'PageSpeed Insights returned an unreadable response.' }, 502); }

  const lh = data.lighthouseResult;
  if (!lh) return json({ ok: false, error: 'PageSpeed Insights had no result for this URL yet.' }, 502);

  const score = Math.round((lh.categories?.performance?.score ?? 0) * 100);
  const audits = lh.audits || {};
  const metric = (id) => audits[id]?.displayValue || null;

  return json({
    ok: true,
    strategy,
    score,
    metrics: {
      lcp: metric('largest-contentful-paint'),
      cls: metric('cumulative-layout-shift'),
      fcp: metric('first-contentful-paint'),
      tbt: metric('total-blocking-time'),
    },
    checked_at: new Date().toISOString(),
  });
}

function looksLikeJson(s) {
  const t = s.trim();
  return t.startsWith('[') || t.startsWith('{');
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function decodeEditor(env) {
  return (env && env.ADMIN_USER) || 'admin';
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
