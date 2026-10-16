export const CMS_VERSION = '2.6.0';

export const CHANGELOG = [
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
