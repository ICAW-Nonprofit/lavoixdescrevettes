/**
 * Site-wide settings. Everything here is public (it ends up in the HTML),
 * so never put a password or private API key in this file.
 */
export const site = {
  name: 'La Voix des Crevettes',
  instagram: 'https://www.instagram.com/lavoixdescrevettes/',
  icaw: {
    name: 'International Council for Animal Welfare',
    short: 'ICAW',
    url: 'https://www.i-caw.org/',
    instagram: 'https://www.instagram.com/icaw_org/',
  },

  /** Photographer of most action photos: credited in the legal notice and on every photo of people (components/PhotoCredit.astro). */
  photographer: {
    handle: 'come_closer_project',
    instagram: 'https://www.instagram.com/come_closer_project/',
  },

  /** Mailchimp audience run by ICAW (same list as https://mailchi.mp/i-caw/la-voix-des-crevettes). */
  newsletter: {
    hostedPage: 'https://mailchi.mp/i-caw/la-voix-des-crevettes',
    host: 'https://mc.us8.list-manage.com',
    u: '36319b923b3113d1a8ae9e072',
    id: '9e4aad0155',
    fId: '00406fe0f0',
    gdprId: '35311',
    /** Values of the "Souhaitez-vous participer à des actions ?" dropdown — must match Mailchimp exactly. */
    choices: [
      'Participer à des actions dans ma ville',
      'Organiser des actions dans ma ville',
      'Actions en ligne',
      'Je ne suis pas intéressé-e',
    ],
  },

  /**
   * WhatsApp group invite link (e.g. "https://chat.whatsapp.com/…"), used in the "share the action" text.
   * An event can override it with its own `whatsapp:` field. Empty = the text points to Instagram instead.
   * Tip: turn on "Approve new members" in the group settings, since this link will be public.
   */
  whatsappGroup: '',

  /**
   * Contact form endpoint (Formspree, e.g. "https://formspree.io/f/abcdwxyz").
   * Empty = the form shows a notice and points to Instagram instead.
   */
  contactEndpoint: '',

  /**
   * Google Analytics 4 measurement ID (e.g. "G-XXXXXXXXXX").
   * Empty = no analytics and no cookie banner. Once set, GA only loads after consent.
   */
  gaId: '',
};
