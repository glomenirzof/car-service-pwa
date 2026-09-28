// Reporting periods resolved in the studio timezone. The owner UI and the
// owner AI tools call the same function, so "за эту неделю" means the same
// [from, to] local dates in both places.
export const PERIOD_PRESETS = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'last_30_days'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  today: 'Сегодня',
  yesterday: 'Вчера',
  this_week: 'Эта неделя',
  last_week: 'Прошлая неделя',
  this_month: 'Этот месяц',
  last_month: 'Прошлый месяц',
  last_30_days: '30 дней',
};

export type LocalPeriod = {from: string; to: string; timezone: string};

/** YYYY-MM-DD of an instant in a timezone. */
export function localDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday 1 (Mon) .. 7 (Sun) of a YYYY-MM-DD date. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function resolvePeriod(preset: PeriodPreset, timeZone: string, now: Date = new Date()): LocalPeriod {
  const today = localDate(now, timeZone);
  const weekStart = addDays(today, 1 - isoWeekday(today));
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = addDays(monthStart, -1);
  const lastMonthStart = `${lastMonthEnd.slice(0, 7)}-01`;
  const range: Record<PeriodPreset, [string, string]> = {
    today: [today, today],
    yesterday: [addDays(today, -1), addDays(today, -1)],
    this_week: [weekStart, addDays(weekStart, 6)],
    last_week: [addDays(weekStart, -7), addDays(weekStart, -1)],
    this_month: [monthStart, addDays(`${addDays(monthStart, 32).slice(0, 7)}-01`, -1)],
    last_month: [lastMonthStart, lastMonthEnd],
    last_30_days: [addDays(today, -29), today],
  };
  const [from, to] = range[preset];
  return {from, to, timezone: timeZone};
}
