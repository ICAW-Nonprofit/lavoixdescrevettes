import type { EventEntry } from './content';
import type { Lang } from '../i18n';
import { stripMd } from './md';

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function addressOf(e: EventEntry) {
  const v = e.data.venue;
  return `${v.street}, ${v.postalCode} ${v.city}, France`;
}

export function googleCalendarUrl(e: EventEntry, lang: Lang, pageUrl: string) {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.data.title[lang],
    dates: `${stamp(e.data.start)}/${stamp(e.data.end)}`,
    details: `${e.data.summary[lang]}\n\n${pageUrl}`,
    location: addressOf(e),
    ctz: 'Europe/Paris',
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

export function outlookCalendarUrl(e: EventEntry, lang: Lang, pageUrl: string) {
  const p = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: e.data.title[lang],
    startdt: e.data.start.toISOString(),
    enddt: e.data.end.toISOString(),
    location: addressOf(e),
    body: `${e.data.summary[lang]}\n\n${pageUrl}`,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${p}`;
}

/* ---------- iCalendar (RFC 5545) ---------- */

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** fold lines at 75 octets */
function fold(line: string) {
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > 74) {
      out.push(cur);
      cur = ' ' + ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}

function vevent(e: EventEntry, lang: Lang, pageUrl: string) {
  const status = ({ prevu: 'CONFIRMED', reporte: 'TENTATIVE', annule: 'CANCELLED' } as const)[e.data.status];
  return [
    'BEGIN:VEVENT',
    `UID:${e.id}@lavoixdescrevettes`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(e.data.start)}`,
    `DTEND:${stamp(e.data.end)}`,
    `SUMMARY:${esc(e.data.title[lang])}`,
    `DESCRIPTION:${esc(`${stripMd(e.data.description[lang])}\n\n${pageUrl}`)}`,
    `LOCATION:${esc(addressOf(e))}`,
    `GEO:${e.data.lat};${e.data.lng}`,
    `URL:${pageUrl}`,
    `STATUS:${status}`,
    'END:VEVENT',
  ];
}

export function ics(events: { entry: EventEntry; url: string }[], lang: Lang, name: string) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//La Voix des Crevettes//Agenda//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`,
    'X-WR-TIMEZONE:Europe/Paris',
    ...events.flatMap(({ entry, url }) => vevent(entry, lang, url)),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
