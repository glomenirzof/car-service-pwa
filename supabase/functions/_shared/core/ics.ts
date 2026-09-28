// RFC 5545 calendar file for one booking. The same UID is reused on every
// download, with SEQUENCE = reschedule count, so calendar apps update the event
// when the client re-imports it after a reschedule. A cancelled booking yields
// METHOD:CANCEL / STATUS:CANCELLED.
export type IcsBooking = {
  id: string;
  status: string;
  startAt: string;
  endAt: string;
  serviceName: string;
  studioName: string;
  address: string;
  phone: string;
  url: string;
  sequence: number;
};

const fmt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Lines longer than 75 octets must be folded (RFC 5545 §3.1).
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const len = new TextEncoder().encode(ch).length;
    if (size + len > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += len;
  }
  out.push(current);
  return out.join('\r\n ');
}

export function bookingIcs(b: IcsBooking, now: Date = new Date()): string {
  const cancelled = b.status === 'cancelled';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//car-service-pwa//booking//RU',
    'CALSCALE:GREGORIAN',
    `METHOD:${cancelled ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:booking-${b.id}@car-service-pwa`,
    `SEQUENCE:${b.sequence}`,
    `DTSTAMP:${fmt(now.toISOString())}`,
    `DTSTART:${fmt(b.startAt)}`,
    `DTEND:${fmt(b.endAt)}`,
    `SUMMARY:${esc(`${b.serviceName} — ${b.studioName}`)}`,
    `LOCATION:${esc(b.address)}`,
    `DESCRIPTION:${esc(`Запись: ${b.url}\nТелефон студии: ${b.phone}`)}`,
    `URL:${b.url}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    ...(cancelled
      ? []
      : ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Скоро запись в студии', 'TRIGGER:-PT2H', 'END:VALARM']),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
