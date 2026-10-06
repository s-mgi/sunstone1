import { requireAuth, checkLogin, createSessionCookie, clearSessionCookie } from './lib/auth.js';
import { renderHome, renderThankYou } from './lib/render.js';
import { handleRegister } from './lib/register.js';
import { listInquiries, createInquiry, importContacts, importRegistrations, patchInquiry, deleteInquiry, listContent, putContent, listEditLog, seoCheck, perfCheck, serveMedia } from './lib/api.js';
import { analyticsReport } from './lib/analytics.js';
import { eblastState, saveDraft, sendCampaign, handleUnsubscribe, getCampaign, deleteCampaign, duplicateCampaign } from './lib/eblast.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (path === '/api/login' && method === 'POST') {
      const result = await checkLogin(request, env);
      if (!result.ok) return json({ ok: false, error: result.error }, 401);
      return json({ ok: true }, 200, { 'Set-Cookie': await createSessionCookie(env) });
    }
    if (path === '/api/logout' && method === 'POST') {
      return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
    }

    if (path === '/api/unsubscribe' && (method === 'GET' || method === 'POST')) return handleUnsubscribe(request, env);

    if (path === '/admin' || path === '/admin.html' || path.startsWith('/api/')) {
      const denied = await requireAuth(request, env);
      if (denied) {
        if (path.startsWith('/api/')) return denied;
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
    if (path === '/api/inquiries/import-registrations' && method === 'POST') return importRegistrations(request, env);
    const inquiryMatch = path.match(/^\/api\/inquiries\/([^/]+)$/);
    if (inquiryMatch && method === 'PATCH') return patchInquiry(request, env, inquiryMatch[1]);
    if (inquiryMatch && method === 'DELETE') return deleteInquiry(request, env, inquiryMatch[1]);

    if (path === '/api/content' && method === 'GET') return listContent(env);
    const contentMatch = path.match(/^\/api\/content\/([^/]+)$/);
    if (contentMatch && method === 'PUT') return putContent(request, env, decodeURIComponent(contentMatch[1]));

    if (path === '/api/edit-log' && method === 'GET') return listEditLog(request, env);
    if (path === '/api/seo-check' && method === 'GET') return seoCheck(request, env);
    if (path === '/api/perf-check' && method === 'GET') return perfCheck(request, env);
    if (path === '/api/analytics' && method === 'GET') return analyticsReport(request, env, ctx);

    if (path === '/api/eblast/state' && method === 'GET') return eblastState(env);
    if (path === '/api/eblast/draft' && method === 'POST') return saveDraft(request, env);
    if (path === '/api/eblast/send' && method === 'POST') return sendCampaign(request, env);
    const eblastCampaignMatch = path.match(/^\/api\/eblast\/campaigns\/([^/]+)$/);
    if (eblastCampaignMatch && method === 'GET') return getCampaign(env, eblastCampaignMatch[1]);
    if (eblastCampaignMatch && method === 'DELETE') return deleteCampaign(env, eblastCampaignMatch[1]);
    const eblastDuplicateMatch = path.match(/^\/api\/eblast\/campaigns\/([^/]+)\/duplicate$/);
    if (eblastDuplicateMatch && method === 'POST') return duplicateCampaign(env, eblastDuplicateMatch[1]);

    const mediaMatch = path.match(/^\/media\/([^/]+)$/);
    if (mediaMatch && method === 'GET') return serveMedia(env, decodeURIComponent(mediaMatch[1]));

    return env.ASSETS.fetch(request);
  },
};

function json(obj, status, extraHeaders) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) } });
}
