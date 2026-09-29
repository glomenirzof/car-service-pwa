// Texts of push notifications, rendered at send time from the current booking.
import type {PushPayload} from './push.ts';

export type ClaimedJob = {
  id: number;
  kind: string;
  audience: 'client' | 'owner';
  attempts: number;
  maxAttempts: number;
  data: Record<string, unknown>;
  tenant: {slug: string; name: string; shortName: string; timezone: string; status: string};
  booking: {id: string; status: string; startAt: string; endAt: string; serviceName: string; customerName: string; resourceName: string; cancelReason: string | null};
  subscriptions: {id: string; endpoint: string; p256dh: string; auth: string}[];
};

function when(iso: string, tz: string, now = new Date()): string {
  const date = new Date(iso);
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', {timeZone: tz, dateStyle: 'short'}).format(d);
  const time = new Intl.DateTimeFormat('ru-RU', {timeZone: tz, hour: '2-digit', minute: '2-digit'}).format(date);
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (day(date) === day(now)) return `сегодня в ${time}`;
  if (day(date) === day(tomorrow)) return `завтра в ${time}`;
  const dm = new Intl.DateTimeFormat('ru-RU', {timeZone: tz, day: 'numeric', month: 'long', weekday: 'short'}).format(date);
  return `${dm}, ${time}`;
}

export function renderNotification(job: ClaimedJob, now = new Date()): PushPayload {
  const b = job.booking;
  const t = job.tenant;
  const at = when(b.startAt, t.timezone, now);
  const owner = `/s/${t.slug}/owner/bookings/${b.id}`;
  const client = `/s/${t.slug}/bookings`;
  const tag = `booking-${b.id}`;
  switch (job.kind) {
    case 'owner_new_booking':
      return {title: 'Новая запись', body: `${b.serviceName} · ${at} · ${b.customerName}`, url: owner, tag};
    case 'owner_booking_rescheduled':
      return {title: 'Клиент перенёс запись', body: `${b.customerName}: ${b.serviceName} → ${at}`, url: owner, tag};
    case 'owner_booking_cancelled':
      return {title: 'Клиент отменил запись', body: `${b.customerName}: ${b.serviceName}, ${at}`, url: owner, tag};
    case 'client_reminder':
      return {title: `Запись в ${t.shortName}`, body: `${b.serviceName} ${at}. Ждём вас!`, url: client, tag};
    case 'client_booking_rescheduled':
      return {title: `${t.shortName}: запись перенесена`, body: `${b.serviceName} — теперь ${at}`, url: client, tag};
    case 'client_booking_cancelled':
      return {
        title: `${t.shortName}: запись отменена`,
        body: `${b.serviceName}, ${at}${b.cancelReason ? `. ${b.cancelReason}` : ''}`,
        url: client,
        tag,
      };
    default:
      return {title: t.shortName, body: `${b.serviceName}, ${at}`, url: client, tag};
  }
}
