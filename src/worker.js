// Sunstone Towns CMS — single Worker entry point (from cms-template).
//
// This project deploys as a Cloudflare Worker with static assets (not
// Pages), so there is no functions/ directory-based routing — every route
// is dispatched here by hand, and anything not matched below falls through
// to env.ASSETS.fetch(request), which serves the static files (index.html,
// admin.html, login.html, images/, robots.txt, sitemap.xml, thank-you.html)
// as-is.
import { requireAuth, checkLogin, createSessionCookie, clearSessionCookie } from './lib/auth.js';
import { renderHome, renderThankYou } from './lib/render.js';
import { handleRegister } from './lib/register.js';
import { listInquiries, createInquiry, importContacts, patchInquiry, deleteInquiry, listContent, putContent, listEditLog, seoCheck, perfCheck, serveMedia } from './lib/api.js';
import { eblastState, saveDraft, sendCampaign, handleUnsubscribe, getCampaign, deleteCampaign, duplicateCampaign } from './lib/eblast.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // --- Login / logout: must work without a session already present ---
    if (path === '/api/login' && method === 'POST') {
      const result = await checkLogin(request, env);
      if (!result.ok) return json({ ok: false, error: result.error }, 401);
      return json({ ok: true }, 200, { 'Set-Cookie': await createSessionCookie(env) });
    }
    if (path === '/api/logout' && method === 'POST') {
      return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
    }

    // --- Unsubscribe link: clicked from inside an email, so it must work
    // for a logged-out recipient. Its own signed token (not the session
    // cookie) is what proves the request is legitimate — see eblast.js.
    // POST is handled here too: it's what Gmail/Yahoo's one-click
    // unsubscribe (RFC 8058, advertised via List-Unsubscribe-Post) actually
    // sends, and it has to work without a session cookie same as the GET. ---
    if (path === '/api/unsubscribe' && (method === 'GET' || method === 'POST')) return handleUnsubscribe(request, env);

    // --- Auth gate: the admin page (either spelling) and the whole API ---
    if (path === '/admin' || path === '/admin.html' || path.startsWith('/api/')) {
      const denied = await requireAuth(request, env);
      if (denied) {
        if (path.startsWith('/api/')) return denied; // JSON 401
        const next = encodeURIComponent(path);
        return Response.redirect(`${url.origin}/login.html?next=${next}`, 302);
      }
    }

    if (path === '/' && method === 'GET') return renderHome(request, env);
    if ((path === '/thank-you.html' || path === '/thank-you') && method === 'GET') return renderThankYou(request, env);
    if (path === '/register' && method === 'POST') return handleRegister(request, env, ctx);

    if (path === '/api/inquiries' && method === 'GET') return listInquiries(request, env);
    if (path === '/api/inquiries' && method === 'POST') return createInquiry(request, env);
    if (path === '/api/inquiries/import' && method === 'POST') return importContacts(request, env);
    const inquiryMatch = path.match(/^\/api\/inquiries\/([^/]+)$/);
    if (inquiryMatch && method === 'PATCH') return patchInquiry(request, env, inquiryMatch[1]);
    if (inquiryMatch && method === 'DELETE') return deleteInquiry(request, env, inquiryMatch[1]);

    if (path === '/api/content' && method === 'GET') return listContent(env);
    const contentMatch = path.match(/^\/api\/content\/([^/]+)$/);
    if (contentMatch && method === 'PUT') return putContent(request, env, decodeURIComponent(contentMatch[1]));

    if (path === '/api/edit-log' && method === 'GET') return listEditLog(request, env);
    if (path === '/api/seo-check' && method === 'GET') return seoCheck(request, env);
    if (path === '/api/perf-check' && method === 'GET') return perfCheck(request, env);

    if (path === '/api/eblast/state' && method === 'GET') return eblastState(env);
    if (path === '/api/eblast/draft' && method === 'POST') return saveDraft(request, env);
    if (path === '/api/eblast/send' && method === 'POST') return sendCampaign(request, env);
    const eblastCampaignMatch = path.match(/^\/api\/eblast\/campaigns\/([^/]+)$/);
    if (eblastCampaignMatch && method === 'GET') return getCampaign(env, eblastCampaignMatch[1]);
    if (eblastCampaignMatch && method === 'DELETE') return deleteCampaign(env, eblastCampaignMatch[1]);
    const eblastDuplicateMatch = path.match(/^\/api\/eblast\/campaigns\/([^/]+)\/duplicate$/);
    if (eblastDuplicateMatch && method === 'POST') return duplicateCampaign(env, eblastDuplicateMatch[1]);

    // Gallery uploads live in D1 as data URLs (see api.js), so they need a
    // real URL of their own here — an email client can't load a data: URI.
    const mediaMatch = path.match(/^\/media\/([^/]+)$/);
    if (mediaMatch && method === 'GET') return serveMedia(env, decodeURIComponent(mediaMatch[1]));

    // Everything else — admin.html itself (once authed above), login.html,
    // images, robots.txt, sitemap.xml, thank-you.html, logo.png.
    return env.ASSETS.fetch(request);
  },
};

function json(obj, status, extraHeaders) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) } });
}
