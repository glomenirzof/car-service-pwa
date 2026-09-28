// Formatting in the studio's timezone and locale (ru-RU). Every date shown to
// a client or owner is rendered in the studio timezone, not the device's.
const moneyFmt = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'RUB', maximumFractionDigits: 0});

export function money(amount: number, isFrom = false): string {
  return `${isFrom ? 'от ' : ''}${moneyFmt.format(amount)}`;
}

export function duration(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `${d} ${plural(d, 'день', 'дня', 'дней')}`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d} ${plural(d, 'день', 'дня', 'дней')} ${h % 24} ч`;
  }
  return [h ? `${h} ч` : '', m ? `${m} мин` : ''].filter(Boolean).join(' ');
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function time(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('ru-RU', {timeZone: tz, hour: '2-digit', minute: '2-digit'}).format(new Date(iso));
}

export function dateLong(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('ru-RU', {timeZone: tz, weekday: 'long', day: 'numeric', month: 'long'}).format(new Date(iso));
}

/** "6 октября" — for phrases like "до 6 октября" where a weekday would not decline. */
export function dayMonth(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('ru-RU', {timeZone: tz, day: 'numeric', month: 'long'}).format(new Date(iso));
}

export function dateShort(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('ru-RU', {timeZone: tz, weekday: 'short', day: 'numeric', month: 'short'}).format(new Date(iso));
}

export function dateTime(iso: string, tz: string): string {
  return `${dateLong(iso, tz)}, ${time(iso, tz)}`;
}

/** Local calendar date (YYYY-MM-DD) → parts for a date chip. */
export function dayChip(date: string): {weekday: string; day: string; month: string} {
  const d = new Date(`${date}T12:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat('ru-RU', {weekday: 'short', timeZone: 'UTC'}).format(d),
    day: String(d.getUTCDate()),
    month: new Intl.DateTimeFormat('ru-RU', {month: 'short', timeZone: 'UTC'}).format(d),
  };
}

export function relativeDay(date: string, today: string): string | null {
  const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Завтра';
  return null;
}

export const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Запланирована',
  arrived: 'Автомобиль на месте',
  completed: 'Выполнена',
  cancelled: 'Отменена',
  no_show: 'Неявка',
};
