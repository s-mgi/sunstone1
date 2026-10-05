
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const CACHE_SECONDS = 600;
let tokenCache = null;

export async function analyticsReport(request, env, ctx) {
  const url = new URL(request.url);
  const range = ['7', '28', '90'].includes(url.searchParams.get('range')) ? Number(url.searchParams.get('range')) : 28;
  const fresh = url.searchParams.get('fresh') === '1';

  if (!env.GA_PROPERTY_ID || !env.GA_SERVICE_ACCOUNT) {
    return json({ ok: false, configured: false, error: 'Google Analytics is not connected yet. Add GA_PROPERTY_ID and GA_SERVICE_ACCOUNT in Cloudflare.' });
  }
  const propertyId = String(env.GA_PROPERTY_ID).trim().replace(/^properties\//, '');
  if (!/^\d+$/.test(propertyId)) {
    return json({ ok: false, configured: false, error: 'GA_PROPERTY_ID must be the numeric property ID (GA > Admin > Property details), not the G- measurement ID.' });
  }

  let token;
  try { token = await getAccessToken(env); }
  catch (e) { return json({ ok: false, configured: true, error: e.message }, 502); }

  const api = (method, body) => gaFetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:${method}`, token, body);

  const realtimeP = api('runRealtimeReport', { metrics: [{ name: 'activeUsers' }] })
    .then((r) => Number(r.rows?.[0]?.metricValues?.[0]?.value || 0))
    .catch(() => null);

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request(`https://ga-cache.internal/${propertyId}/${range}`);
  let report = null;
  if (cache && !fresh) {
    const hit = await cache.match(cacheKey);
    if (hit) report = await hit.json();
  }

  if (!report) {
    const cur = { startDate: `${range - 1}daysAgo`, endDate: 'today', name: 'current' };
    const prev = { startDate: `${range * 2 - 1}daysAgo`, endDate: `${range}daysAgo`, name: 'previous' };
    const TOTAL_METRICS = ['activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'engagementRate', 'averageSessionDuration'];
    try {
      const [totals, daily, channels, sources, pages, devices] = await Promise.all([
        api('runReport', { dateRanges: [cur, prev], metrics: TOTAL_METRICS.map((name) => ({ name })) }),
        api('runReport', { dateRanges: [cur], dimensions: [{ name: 'date' }], metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }], orderBys: [{ dimension: { dimensionName: 'date' } }], keepEmptyRows: true }),
        api('runReport', { dateRanges: [cur], dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 8 }),
        api('runReport', { dateRanges: [cur], dimensions: [{ name: 'sessionSource' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 8 }),
        api('runReport', { dateRanges: [cur], dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 8 }),
        api('runReport', { dateRanges: [cur], dimensions: [{ name: 'deviceCategory' }], metrics: [{ name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }] }),
      ]);

      const byRange = {};
      for (const row of totals.rows || []) {
        const name = row.dimensionValues?.[0]?.value || 'current';
        byRange[name] = Object.fromEntries(TOTAL_METRICS.map((m, i) => [m, Number(row.metricValues[i].value || 0)]));
      }
      const zero = Object.fromEntries(TOTAL_METRICS.map((m) => [m, 0]));

      report = {
        range,
        totals: { current: byRange.current || zero, previous: byRange.previous || zero },
        daily: (daily.rows || []).map((r) => ({
          date: r.dimensionValues[0].value,
          users: Number(r.metricValues[0].value || 0),
          sessions: Number(r.metricValues[1].value || 0),
          views: Number(r.metricValues[2].value || 0),
        })),
        channels: rows(channels, ['sessions']),
        sources: rows(sources, ['sessions', 'users']),
        pages: rows(pages, ['views', 'users']),
        devices: rows(devices, ['users']),
        fetchedAt: new Date().toISOString(),
      };
      if (cache) {
        const put = cache.put(cacheKey, new Response(JSON.stringify(report), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_SECONDS}` } }));
        if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
      }
    } catch (e) {
      return json({ ok: false, configured: true, error: e.message }, 502);
    }
  }

  return json({ ok: true, configured: true, realtime: await realtimeP, ...report });
}

function rows(res, names) {
  return (res.rows || []).map((r) => {
    const o = { name: r.dimensionValues[0].value || '(not set)' };
    names.forEach((n, i) => { o[n] = Number(r.metricValues[i]?.value || 0); });
    return o;
  });
}

async function gaFetch(url, token, body) {
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || `Google Analytics returned ${res.status}.`;
    if (res.status === 403) throw new Error(`Google Analytics refused access: ${msg} Check that the service account's email is added as a Viewer in GA > Admin > Property access management, and that the Google Analytics Data API is enabled in Google Cloud.`);
    if (res.status === 404 || res.status === 400) throw new Error(`Google Analytics couldn't find that property: ${msg} Check GA_PROPERTY_ID.`);
    throw new Error(msg);
  }
  return data;
}

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 60 > now) return tokenCache.token;

  let sa;
  try { sa = JSON.parse(env.GA_SERVICE_ACCOUNT); }
  catch { throw new Error('GA_SERVICE_ACCOUNT is not valid JSON. Paste the entire contents of the service account key file.'); }
  if (!sa.client_email || !sa.private_key) throw new Error('GA_SERVICE_ACCOUNT is missing client_email or private_key. Paste the entire key file.');

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;

  const pem = sa.private_key.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Google sign-in for the service account failed: ${data.error_description || data.error || res.status}.`);
  tokenCache = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return tokenCache.token;
}

function b64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
