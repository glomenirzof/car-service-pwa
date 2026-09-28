import {idempotencyKeyFor, clearIdempotencyKey, saveBooking, getSavedBookings, forgetBooking, tokenFor} from './store';

describe('client store', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('reuses the idempotency key for the same payload and rotates it when the payload changes', () => {
    const a = idempotencyKeyFor('alpha', {serviceId: 's', startAt: 'x'});
    expect(idempotencyKeyFor('alpha', {serviceId: 's', startAt: 'x'})).toBe(a);
    const b = idempotencyKeyFor('alpha', {serviceId: 's', startAt: 'y'});
    expect(b).not.toBe(a);
    clearIdempotencyKey('alpha');
    expect(idempotencyKeyFor('alpha', {serviceId: 's', startAt: 'y'})).not.toBe(b);
  });

  it('keeps booking links per studio and can forget them', () => {
    saveBooking('alpha', {token: 't1', bookingId: 'b1', startAt: '2030-01-01T10:00:00Z', serviceName: 'Wash'});
    saveBooking('beta', {token: 't2', bookingId: 'b2', startAt: '2030-01-01T10:00:00Z', serviceName: 'Tires'});
    expect(getSavedBookings('alpha').map((b) => b.bookingId)).toEqual(['b1']);
    expect(tokenFor('alpha', 'b2')).toBeNull();
    forgetBooking('alpha', 'b1');
    expect(getSavedBookings('alpha')).toEqual([]);
  });
});
