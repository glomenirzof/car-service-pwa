import {bookingIcs} from '@shared/ics';
import {normalizePhone, formatPhone} from '@shared/phone';
import {resolvePeriod, localDate, addDays, isoWeekday} from '@shared/periods';
import {createBookingBody} from '@shared/contract';

describe('phone', () => {
  it.each([
    ['8 999 123-45-67', '+79991234567'],
    ['+7 (999) 123-45-67', '+79991234567'],
    ['9991234567', '+79991234567'],
    ['79991234567', '+79991234567'],
    ['+49 30 1234567', '+49301234567'],
  ])('%s -> %s', (input, out) => expect(normalizePhone(input)).toBe(out));
  it('rejects garbage', () => expect(normalizePhone('12')).toBeNull());
  it('formats Russian numbers', () => expect(formatPhone('+79991234567')).toBe('+7 999 123-45-67'));
});

describe('periods (same code in UI and AI)', () => {
  const now = new Date('2026-03-01T21:30:00Z'); // 2026-03-02 00:30 in Moscow, 2026-03-01 in UTC
  it('uses the studio timezone for "today"', () => {
    expect(localDate(now, 'Europe/Moscow')).toBe('2026-03-02');
    expect(resolvePeriod('today', 'Europe/Moscow', now)).toEqual({from: '2026-03-02', to: '2026-03-02', timezone: 'Europe/Moscow'});
    expect(resolvePeriod('today', 'UTC', now).from).toBe('2026-03-01');
  });
  it('weeks start on Monday, months handle lengths', () => {
    expect(isoWeekday('2026-03-02')).toBe(1);
    expect(resolvePeriod('this_week', 'Europe/Moscow', now)).toMatchObject({from: '2026-03-02', to: '2026-03-08'});
    expect(resolvePeriod('last_month', 'Europe/Moscow', now)).toMatchObject({from: '2026-02-01', to: '2026-02-28'});
    expect(resolvePeriod('this_month', 'Europe/Moscow', now)).toMatchObject({from: '2026-03-01', to: '2026-03-31'});
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });
});

describe('ics', () => {
  const b = {
    id: 'b1', status: 'scheduled', startAt: '2026-10-05T07:00:00Z', endAt: '2026-10-05T08:30:00Z',
    serviceName: 'Мойка; кузов, диски', studioName: 'Студия', address: 'ул. Длинная, 1', phone: '+79990000000',
    url: 'https://example.test/s/x/bookings', sequence: 2,
  };
  it('produces a stable UID, SEQUENCE and escaped, folded lines', () => {
    const ics = bookingIcs(b, new Date('2026-10-01T00:00:00Z'));
    expect(ics).toContain('UID:booking-b1@car-service-pwa');
    expect(ics).toContain('SEQUENCE:2');
    expect(ics).toContain('DTSTART:20261005T070000Z');
    expect(ics).toContain('Мойка\\; кузов\\, диски');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(ics).toContain('BEGIN:VALARM');
  });
  it('cancelled booking yields METHOD:CANCEL without alarm', () => {
    const ics = bookingIcs({...b, status: 'cancelled'});
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).not.toContain('VALARM');
  });
});

describe('booking contract', () => {
  it('normalizes phone and requires consent; has no price/tenant/duration fields', () => {
    const r = createBookingBody.parse({serviceId: crypto.randomUUID(), startAt: '2026-10-05T07:00:00Z', name: ' Иван ', phone: '8 (999) 111-22-33', consent: true, idempotencyKey: crypto.randomUUID(), price: 1});
    expect(r.phone).toBe('+79991112233');
    expect(r.name).toBe('Иван');
    expect(r).not.toHaveProperty('price');
    expect(createBookingBody.safeParse({...r, consent: false}).success).toBe(false);
  });
});
