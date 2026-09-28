// ONE file of per-site identity for the backend. Nothing else in src/lib
// should contain a client's name, address or colours.
export const SITE = {
  name: 'Sunstone Towns',
  tagline: 'Freehold Townhomes in Vaughan',
  company: 'Edenbrook Homes',            // legal sender for email footers
  byline: 'by Edenbrook Homes',          // '' to hide
  mailingAddress: ['260 Edgeley Blvd, Unit 15', 'Concord, ON L4K 3Y4'],
  defaultReplyTo: 'info@edenbrookhomes.com', // auto-reply replies go here unless AUTOREPLY_REPLY_TO is set
  cookieName: 'sunstone-towns_admin_session',
  legalLine: '', // the live site carries no legal line; add e.g. 'E.&O.E.' here to show one in emails

  // Email images (paths on the live site). Email apps can't show SVG/AVIF,
  // so these are PNG copies of the site logos.
  emailLogo: 'assets/email/sunstone-logo.png',
  emailHero: 'assets/images/hero.jpg',
  emailHeroAlt: 'A GO train passing the wooded trail network beside Sunstone Towns',
  companyLogo: 'assets/email/edenbrook-logo-white.png', // '' to hide the dark company band logo
  companyLogoAlt: 'Edenbrook Homes',

  // Email colours (from css/styles.css)
  colors: {
    brand: '#B4712F',  // copper: band + headings + links
    accent: '#D79B5B', // copper-light: legal line on dark band
    ink: '#161510',    // charcoal
    text: '#333333',
    muted: '#8a8a8a',
    rule: '#e6ddcc',
    bg: '#F3EDE1',     // cream
  },

  autoReplySubject: 'Thank you for registering for Sunstone Towns!',
  autoReplyIntro: 'You are now a priority registrant of',
};
