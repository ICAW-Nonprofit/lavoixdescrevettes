export type Lang = 'fr' | 'en';
export const langs: Lang[] = ['fr', 'en'];

/** Localised routes (without the GitHub Pages base path). */
const routes = {
  home: { fr: '/', en: '/en/' },
  agenda: { fr: '/agenda/', en: '/en/events/' },
  blog: { fr: '/blog/', en: '/en/blog/' },
  resources: { fr: '/ressources/', en: '/en/resources/' },
  report: { fr: '/rapport-souffrance-en-rayon/', en: '/en/report/' },
  about: { fr: '/a-propos/', en: '/en/about/' },
  contact: { fr: '/contact/', en: '/en/contact/' },
  thanks: { fr: '/merci/', en: '/en/thanks/' },
  thanksNewsletter: { fr: '/merci-newsletter/', en: '/en/thanks-newsletter/' },
  legal: { fr: '/mentions-legales/', en: '/en/legal-notice/' },
  privacy: { fr: '/confidentialite/', en: '/en/privacy/' },
} as const;
export type RouteKey = keyof typeof routes;

/** Prefix a site path with the deploy base path. */
export function url(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return base + path;
}

export function route(key: RouteKey, lang: Lang): string {
  return routes[key][lang];
}

export function alternatesFor(key: RouteKey) {
  return { fr: routes[key].fr, en: routes[key].en };
}

export const eventPath = (slug: string, lang: Lang) => `${routes.agenda[lang]}${slug}/`;
export const postPath = (slug: string, lang: Lang) => `${routes.blog[lang]}${slug}/`;

export const locale = { fr: 'fr-FR', en: 'en-GB' } as const;

const TZ = 'Europe/Paris';

/** French writes the first day of the month as "1er". */
const premier = (s: string, lang: Lang) => (lang === 'fr' ? s.replace(/(^|\s)1(?= [a-zéû])/, '$11er') : s);

export function formatDay(d: Date, lang: Lang) {
  return premier(new Intl.DateTimeFormat(locale[lang], { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }).format(d), lang);
}
export function formatDate(d: Date, lang: Lang) {
  return premier(new Intl.DateTimeFormat(locale[lang], { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }).format(d), lang);
}
export function formatShort(d: Date, lang: Lang) {
  return new Intl.DateTimeFormat(locale[lang], { day: 'numeric', month: 'short', timeZone: TZ }).format(d);
}
export function formatTime(d: Date, lang: Lang) {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')!.value);
  const m = parts.find((p) => p.type === 'minute')!.value;
  if (lang === 'fr') return m === '00' ? `${h} h` : `${h} h ${m}`;
  return `${h}:${m}`;
}
export function dayParts(d: Date, lang: Lang) {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale[lang], { ...o, timeZone: TZ }).format(d);
  return { day: f({ day: 'numeric' }), month: f({ month: 'short' }).replace('.', ''), weekday: f({ weekday: 'short' }).replace('.', '') };
}

export const ui = {
  fr: {
    skip: 'Aller au contenu',
    homeLabel: 'La Voix des Crevettes, accueil',
    nav: { agenda: 'Agenda', report: 'Le rapport', blog: 'Blog', resources: 'Ressources', about: 'À propos', contact: 'Contact' },
    navLabel: 'Navigation principale',
    menu: 'Menu',
    close: 'Fermer',
    ctaNext: 'Prochaine action',
    ctaAgenda: "Voir l'agenda",
    switchTo: 'English',
    switchLabel: 'Read this page in English',
    breadcrumbHome: 'Accueil',
    nextAction: 'Prochaine action',
    rdv: 'RDV',
    join: 'Je participe',
    getNews: 'Recevoir les infos',
    readMore: 'Lire la suite',
    allEvents: "Tout l'agenda",
    allPosts: 'Tous les articles',
    details: 'Voir les détails',
    addToCalendar: 'Ajouter au calendrier',
    calGoogle: 'Google Calendar',
    calIcs: 'Apple / Outlook (.ics)',
    calOutlook: 'Outlook.com',
    share: 'Partager',
    shareWhatsapp: 'WhatsApp',
    copyLink: 'Copier le lien',
    copied: 'Lien copié !',
    when: 'Quand',
    where: 'Où',
    access: 'Accès',
    upcoming: 'À venir',
    past: 'Actions passées',
    noUpcoming: "Pas d'action prévue pour l'instant. Inscris-toi à la newsletter pour être prévenu·e de la prochaine.",
    minRead: 'min de lecture',
    by: 'Par',
    sources: 'Sources',
    related: 'À lire aussi',
    otherLang: 'Read in English',
    statusCancelled: 'Annulée',
    statusPostponed: 'Reportée',
    footer: {
      blurb:
        "Groupe local d'actions organisées en France pour lutter contre les pires pratiques d'élevage des crevettes.",
      with: 'Une initiative menée avec',
      follow: 'Suivre',
      site: 'Le site',
      legal: 'Légal',
      cookies: 'Cookies',
      legalNotice: 'Mentions légales',
      privacy: 'Confidentialité',
      rss: 'Flux RSS',
    },
    sticky: 'Prochaine action',
    newsletter: {
      title: 'Ne rate aucune action',
      text: "Reçois les prochaines actions et les nouvelles de la campagne, en France. Pas de spam, désinscription en un clic.",
      email: 'Email',
      firstName: 'Prénom',
      city: 'Ville',
      participate: 'Tu veux participer à des actions ?', // non-breaking space keeps « ? » on the line
      choices: ['Participer à des actions dans ma ville', 'Organiser des actions dans ma ville', 'Juste recevoir les infos'],
      consent: "J'accepte de recevoir les emails de La Voix des Crevettes et de l'ICAW.",
      privacyLink: 'Données personnelles',
      submit: "Je m'inscris",
      sending: 'Envoi…',
      error: "Oups, ça n'a pas marché. Réessaie ou inscris-toi sur",
      errorLink: 'la page Mailchimp',
      optional: 'facultatif',
    },
  },
  en: {
    skip: 'Skip to content',
    homeLabel: 'La Voix des Crevettes, home',
    nav: { agenda: 'Events', report: 'The report', blog: 'Blog', resources: 'Resources', about: 'About', contact: 'Contact' },
    navLabel: 'Main navigation',
    menu: 'Menu',
    close: 'Close',
    ctaNext: 'Next action',
    ctaAgenda: 'See all events',
    switchTo: 'Français',
    switchLabel: 'Lire cette page en français',
    breadcrumbHome: 'Home',
    nextAction: 'Next action',
    rdv: 'Meet at',
    join: "I'll be there",
    getNews: 'Get updates',
    readMore: 'Read more',
    allEvents: 'All events',
    allPosts: 'All articles',
    details: 'See details',
    addToCalendar: 'Add to calendar',
    calGoogle: 'Google Calendar',
    calIcs: 'Apple / Outlook (.ics)',
    calOutlook: 'Outlook.com',
    share: 'Share',
    shareWhatsapp: 'WhatsApp',
    copyLink: 'Copy link',
    copied: 'Link copied!',
    when: 'When',
    where: 'Where',
    access: 'Getting there',
    upcoming: 'Upcoming',
    past: 'Past actions',
    noUpcoming: 'No action planned right now. Sign up to the newsletter to hear about the next one.',
    minRead: 'min read',
    by: 'By',
    sources: 'Sources',
    related: 'Read next',
    otherLang: 'Lire en français',
    statusCancelled: 'Cancelled',
    statusPostponed: 'Postponed',
    footer: {
      blurb: 'A grassroots group organising actions across France against the worst practices in shrimp farming.',
      with: 'An initiative run with the',
      follow: 'Follow',
      site: 'Site',
      legal: 'Legal',
      cookies: 'Cookies',
      legalNotice: 'Legal notice',
      privacy: 'Privacy',
      rss: 'RSS feed',
    },
    sticky: 'Next action',
    newsletter: {
      title: 'Never miss an action',
      text: 'Get the next actions and campaign news in France. No spam, one-click unsubscribe. Emails are in French.',
      email: 'Email',
      firstName: 'First name',
      city: 'City',
      participate: 'Would you like to take part in actions?',
      choices: ['Join actions in my city', 'Organise actions in my city', 'Just get the news'],
      consent: 'I agree to receive emails from La Voix des Crevettes and ICAW.',
      privacyLink: 'Personal data',
      submit: 'Sign me up',
      sending: 'Sending…',
      error: "Oops, that didn't work. Try again or sign up on",
      errorLink: 'the Mailchimp page',
      optional: 'optional',
    },
  },
} as const;
