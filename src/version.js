export const CMS_VERSION = '2.11.0';

export const CHANGELOG = [
  {
    version: '2.11.0',
    date: '2026-10-19',
    title: 'Edit the auto-reply email',
    changes: [
      'New: Registrations has an Auto-reply email tab where you can change the subject, photo, heading, greeting, message and closing note of the email new registrants get.',
      'New: A live preview shows the email as you type, and Send me a test emails it to you before you save.',
      'New: Reset to the original puts back the standard email.',
    ],
  },
  {
    version: '2.10.0',
    date: '2026-10-19',
    title: 'Eblast tracking',
    changes: [
      'New: Each eblast has a Tracking name. It fills in from the subject and you can change it.',
      'New: Links in an eblast get tracking tags, so visits show in Google Analytics under that name and registrations from the blast record it as their campaign.',
      'New: SEO & Analytics > Analytics has an Eblasts section with each blast\'s deliveries, visits, click rate and registrations.',
    ],
  },
  {
    version: '2.9.1',
    date: '2026-10-19',
    title: 'Publish bar in Manage, favicon from the Gallery',
    changes: [
      'Changed: In Manage, role and feature changes wait for a Publish changes button at the bottom, so you can undo them before they go live.',
      'New: Pick the site icon (favicon) from your site images or Gallery uploads in SEO & Analytics > Search appearance.',
      'Changed: The Logs tab is hidden for anyone whose role does not include Logs. Updates still open from the version number in the sidebar.',
    ],
  },
  {
    version: '2.9.0',
    date: '2026-10-19',
    title: 'Roles',
    changes: [
      'New: Users are Admin, Manager or Editor. Admins choose what Managers and Editors can do in Manage > Roles.',
      'Changed: This list of updates moved to Logs > Updates.',
    ],
  },
  {
    version: '2.8.0',
    date: '2026-10-19',
    title: 'Accounts',
    changes: [
      'New: "Forgot password?" on the sign-in page emails a one-time link to reset your password.',
      'New: Optional usernames. Sign in with your email or your username.',
      'New: Settings > My account to change your name, email, username and password.',
      'Changed: Logs has two tabs, Problems and Activity log. The form error email alert moved to Settings > Notifications.',
    ],
  },
  {
    version: '2.7.0',
    date: '2026-10-19',
    title: 'Formatting, search suggestions and smaller fixes',
    changes: [
      'New: Copy fields take simple formatting: *italic*, [link text](https://example.com) and Enter for a line break.',
      'New: SEO title and description show a length meter and a suggested version you can use with one click.',
      'Changed: robots.txt and sitemap.xml are now made from the Canonical URL in SEO, so they always match the site address.',
      'Changed: Someone who registers again moves back to the top of Registrations, and the email shows when they first registered.',
      'Changed: Registrations > Import sends big files in parts with a progress count, and you can choose the date order in the file.',
      'Changed: The PageSpeed check explains how to fix the problem when Google refuses it.',
    ],
  },
  {
    version: '2.6.0',
    date: '2026-10-16',
    title: 'Tags, Logs, Manage and version history',
    changes: [
      'New: SEO & Analytics > Tags for Google Analytics, Google Ads, Tag Manager, Meta Pixel and site verification, plus any number of custom tags with their own page and placement. Changes go live as soon as you save.',
      'New: Logs tab that records failed registrations, emails that did not send, analytics errors and server errors, with optional email alerts for form errors.',
      'New: Manage tab to add users (admin or editor), reset passwords, turn accounts off and switch features on or off.',
      'New: Sign in with your own email and password, and change your password from the avatar menu.',
      'New: The CMS version is shown in the sidebar, with this list of updates in Settings.',
      'Changed: The Google Analytics, Google Ads and Keap tracking tags now come from the CMS instead of being written into the page files.',
    ],
  },
  {
    version: '2.5.0',
    date: '2026-10-06',
    title: 'Registrations import',
    changes: [
      'New: Registrations > Import to bring in a CSV such as a Keap export, with column matching, a preview and no emails sent.',
    ],
  },
  {
    version: '2.3.0',
    date: '2026-10-06',
    title: 'Lead safety net',
    changes: [
      'New: Registrations with missing or unexpected fields are saved as "needs review" instead of being lost, with a [Check] notification email.',
      'New: Red banner on the Overview when a registration needs review.',
      'New: The form and the server check they are on the same form version.',
    ],
  },
  {
    version: '2.1.1',
    date: '2026-10-05',
    title: 'Form fixes',
    changes: [
      'Fixed: Registrations were not reaching the CMS after the broker question was added.',
      'Changed: Broker question now sends to the Keap field Broker2.',
      'Fixed: Required fields are checked before the form submits to Keap.',
      'New: A Google Analytics generate_lead event is sent on each valid registration.',
    ],
  },
  {
    version: '2.1.0',
    date: '2026-09-28',
    title: 'Sunstone Towns CMS launch',
    changes: [
      'Content editor with live preview, Gallery, Registrations, Contacts, Eblast, auto-reply email, SEO audit, speed check, Google Analytics panel and activity log.',
      'Registration form fields: name, email, phone, broker, how they heard about us, comments and consent.',
    ],
  },
];
