# Your turn: Sunstone Towns

Claude has built the files. These are the steps only you can do, in order.
Tick each one and tell Claude when you're done (or paste what it asks for).

Status: Files built and self-checked on 2026-09-28. D1 ID added to wrangler.toml. Next: step 2 (GitHub + Worker).

## 1. Create the database (5 min)
- [x] Cloudflare dashboard > Storage & Databases > D1 > Create > name it `sunstonetowns`
- [x] Copy the **Database ID** and paste it to Claude
      (Claude puts it in `wrangler.toml`)

## 2. Create the Worker and connect GitHub (10 min)
- [ ] Create a private GitHub repo `sunstone-towns`
- [ ] Upload everything in `Lexar > EDENBROOK > sunstone1-main 3` EXCEPT: `YOUR-TURN.md`
      (Hidden `._` files and `.DS_Store` don't upload from Finder anyway, and the site ignores them.)
      (Add file > Upload files, commit to `main`)
- [ ] Cloudflare > Workers & Pages > Create > Import a repository > pick your repo
      Confirm it is a **Worker**, not Pages.
- [ ] Tell Claude the workers.dev URL

## 3. Run the database setup (2 min)
- [ ] D1 > `sunstonetowns` > Console > paste the whole of `migrations/0001_init.sql` > Execute
- [ ] Tell Claude it ran (or paste any error)

## 4. Add variables and secrets (5 min)
Workers & Pages > `sunstone1` > Settings > Variables and secrets:

| Name | Type | Value |
| --- | --- | --- |
| `ADMIN_USER` | Text | the login name you want for /admin |
| `ADMIN_PASSWORD` | Secret | a strong password (also signs the unsubscribe links) |
| `RESEND_API_KEY` | Secret | your Resend API key (starts with `re_`) |
| `FROM_EMAIL` | Text | see step 5 |
| `FROM_NAME` | Text | `Sunstone Towns` |
| `TO_EMAIL` | Text | where lead notifications go; several addresses can be separated by commas |
| `AUTOREPLY_REPLY_TO` | Text | optional: where replies to the auto-reply go (defaults to info@edenbrookhomes.com) |
| `AUTOREPLY_ENABLED` | Text | optional: set to `false` only if you want to switch the auto-reply off |
| `PAGESPEED_API_KEY` | Secret | optional: makes the speed check in /admin more reliable |
| `GA_PROPERTY_ID` | Text | the numeric GA4 property ID (GA > Admin > Property details), not G-79BMJG9WBP |
| `GA_SERVICE_ACCOUNT` | Secret | the whole contents of the service account's JSON key file |

## 5. Email sending (Resend)
- [ ] For testing now: FROM_EMAIL `Sunstone Towns <onboarding@resend.dev>`, TO_EMAIL = your Resend login email
- [ ] For launch: Resend > Domains > add `sunstonetowns.com`, add the DNS records it shows, wait for Verified
- [ ] Then change FROM_EMAIL to an address on the domain, e.g. `Sunstone Towns <hello@sunstonetowns.com>`,
      and TO_EMAIL to whoever should get new-lead notifications

## 6. Keap (2 min)
The form still posts to Keap exactly as before. The site also keeps its own copy of each lead.
- [ ] In Keap, open the Sunstone web form's settings and check where it sends people after they submit.
      Point it at `https://sunstonetowns.com/thank-you` so they see the thank-you page you can edit in /admin.
- [ ] If Keap also sends its own "thanks for registering" email, turn one of them off so people don't get two
      (either Keap's, or this site's with `AUTOREPLY_ENABLED` = `false`).

## 7. Domain (when ready)
- [ ] Workers & Pages > `sunstone1` > Settings > Domains & Routes > add `sunstonetowns.com`
- [ ] Tell Claude when it's live (canonical URL, robots.txt and sitemap.xml already point at sunstonetowns.com)

## 8. Test
- [ ] Tell Claude when the site is up. Claude gives you the short test list for anything it can't check itself.

## 9. Google Analytics in /admin (SEO & Analytics > Analytics)
- [x] Google Cloud: Analytics Data API enabled, service account + JSON key created
- [ ] GA > Admin > Property access management: add the service account's email (ends in `iam.gserviceaccount.com`) as **Viewer**
- [ ] Cloudflare: add `GA_PROPERTY_ID` (Text) and `GA_SERVICE_ACCOUNT` (Secret, paste the whole JSON file)
- [ ] Open /admin > SEO & Analytics > Analytics. If something's wrong, the panel says exactly what.
- [ ] After your first test registration (can take up to a day to appear): GA > Admin > Events,
      find `generate_lead` and turn on **Mark as key event**, so sign-ups count as conversions

## Every later change
Claude edits files in `Lexar > EDENBROOK > sunstone1-main 3` and lists exactly which ones changed.
You upload those files to GitHub `main`; Cloudflare redeploys in about a minute.
If a change adds a `migrations/000N_*.sql` file, paste it into the D1 console after uploading.
