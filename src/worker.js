import { getUser, checkLogin, createSessionCookie, clearSessionCookie, unauthorized } from './lib/auth.js';
import { renderHome, renderThankYou, renderPlainPage } from './lib/render.js';
import { handleRegister } from './lib/register.js';
import { listInquiries, createInquiry, importContacts, importRegistrations, patchInquiry, deleteInquiry, listContent, putContent, listEditLog, seoCheck, perfCheck, serveMedia } from './lib/api.js';
import { analyticsReport } from './lib/analytics.js';
import { eblastState, saveDraft, sendCampaign, handleUnsubscribe, getCampaign, deleteCampaign, duplicateCampaign } from './lib/eblast.js';
import { logError, handleClientError, listErrors, patchError, resolveAllErrors } from './lib/errors.js';
import { me, listUsers, createUser, patchUser, deleteUser, changeOwnPassword, getAdminSettings, putFeatures, putTags, putLogSettings } from './lib/manage.js';
import { getFeatures } from './lib/settings.js';

const ADMIN_ONLY = [/^\/api\/users(\/|$)/, /^\/api\/settings(\/|$)/, /^\/api\/logs(\/|$)/];

function featureFor(path, method) {
  if (path.startsWith('/api/eblast/')) return ['eblast'];
  if (path === '/api/seo-check' || path === '/api/perf-check' || path === '/api/analytics') return ['seo'];
  if (path === '/api/inquiries/import-registrations') return ['registrations'];
  if (path === '/api/inquiries/import' || (path === '/api/inquiries' && method === 'POST')) return ['contacts'];
  if (/^\/api\/inquiries\/[^/]+$/.test(path)) return ['registrations', 'contacts'];
  if (path.startsWith('/api/content/gallery_upload') || path.startsWith('/api/content/gallery_')) return ['gallery'];
  return null;
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (err) {
      const path = new URL(request.url).pathname;
      console.error('Unhandled Worker error:', err);
      await logError(env, { area: 'site', message: `Unexpected error on ${request.method} ${path}`, detail: err, path });
      if (path.startsWith('/api/') || request.method !== 'GET') return json({ ok: false, error: 'Something went wrong on the server. It has been recorded in Logs.' }, 500);
      return new Response('Something went wrong loading this page. Please try again in a moment.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=UTF-8' } });
    }
  },
};

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === '/api/login' && method === 'POST') {
    const result = await checkLogin(request, env);
    if (!result.ok) return json({ ok: false, error: result.error }, 401);
    return json({ ok: true }, 200, { 'Set-Cookie': await createSessionCookie(env, result.user) });
  }
  if (path === '/api/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
  }

  if (path === '/api/unsubscribe' && (method === 'GET' || method === 'POST')) return handleUnsubscribe(request, env);
  if (path === '/log-error' && method === 'POST') return handleClientError(request, env);

  if (path === '/' && method === 'GET') return renderHome(request, env);
  if ((path === '/thank-you.html' || path === '/thank-you') && method === 'GET') return renderThankYou(request, env);
  if ((path === '/privacy-policy.html' || path === '/privacy-policy') && method === 'GET') return renderPlainPage(request, env);
  if (path === '/register' && method === 'POST') return handleRegister(request, env, ctx);

  const mediaMatch = path.match(/^\/media\/([^/]+)$/);
  if (mediaMatch && method === 'GET') return serveMedia(env, decodeURIComponent(mediaMatch[1]));

  if (path === '/admin' || path === '/admin.html' || path.startsWith('/api/')) {
    if (!env.ADMIN_USER || !env.ADMIN_PASSWORD) return unauthorized('Admin auth is not configured (ADMIN_USER / ADMIN_PASSWORD missing).');
    const user = await getUser(request, env);
    if (!user) {
      if (path.startsWith('/api/')) return unauthorized();
      return Response.redirect(`${url.origin}/login.html?next=${encodeURIComponent(path)}`, 302);
    }
    if (path.startsWith('/api/')) return api(request, { ...env, CURRENT_USER: user }, ctx, user, path, method);
  }

  return env.ASSETS.fetch(request);
}

async function api(request, env, ctx, user, path, method) {
  if (ADMIN_ONLY.some((re) => re.test(path)) && user.role !== 'admin') return unauthorized('Only admins can do this.', 403);
  const needs = featureFor(path, method);
  if (needs) {
    const features = await getFeatures(env);
    if (!needs.some((f) => features[f])) return unauthorized('This feature is turned off in Manage.', 403);
  }

  if (path === '/api/me' && method === 'GET') return me(env, user);
  if (path === '/api/me/password' && method === 'POST') return changeOwnPassword(request, env, user);

  if (path === '/api/users' && method === 'GET') return listUsers(env);
  if (path === '/api/users' && method === 'POST') return createUser(request, env, user);
  const userMatch = path.match(/^\/api\/users\/(\d+)$/);
  if (userMatch && method === 'PATCH') return patchUser(request, env, user, Number(userMatch[1]));
  if (userMatch && method === 'DELETE') return deleteUser(env, user, Number(userMatch[1]));

  if (path === '/api/settings' && method === 'GET') return getAdminSettings(env);
  if (path === '/api/settings/features' && method === 'PUT') return putFeatures(request, env, user);
  if (path === '/api/settings/tags' && method === 'PUT') return putTags(request, env, user);
  if (path === '/api/settings/logs' && method === 'PUT') return putLogSettings(request, env, user);

  if (path === '/api/logs' && method === 'GET') return listErrors(request, env);
  if (path === '/api/logs/resolve-all' && method === 'POST') return resolveAllErrors(env);
  const logMatch = path.match(/^\/api\/logs\/(\d+)$/);
  if (logMatch && method === 'PATCH') return patchError(request, env, Number(logMatch[1]));

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

  return json({ ok: false, error: 'Not found' }, 404);
}

function json(obj, status, extraHeaders) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) } });
}
