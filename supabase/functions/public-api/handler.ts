// Public client API. Runs every database call as role anon, after rate limits.
// The client identifies the studio by slug (public) and never sends tenant_id,
// price or duration. Booking access = bearer token; only its hash is stored.
import {asAnon, one} from '../_shared/db.ts';
import {HttpError, json, readJson, query, serveRoutes, clientIp} from '../_shared/http.ts';
import {deriveBookingToken, ipKey, tokenHash} from '../_shared/crypto.ts';
import {enforce, PUBLIC_LIMITS} from '../_shared/limits.ts';
import {
  availabilityQuery,
  cancelBody,
  clientPushBody,
  clientPushDeleteBody,
  createBookingBody,
  rescheduleBody,
  tokenAvailabilityBody,
  tokenBody,
} from '../_shared/core/contract.ts';
import {daysBetween} from '../_shared/core/periods.ts';

const SLUG = '([a-z0-9-]{2,40})';

async function ip(req: Request) {
  return ipKey(clientIp(req));
}

export const handler = serveRoutes('public-api', [
  {
    method: 'GET',
    pattern: new RegExp(`^/tenant/${SLUG}$`),
    handler: async (req, [slug]) => {
      await enforce(PUBLIC_LIMITS.read(await ip(req)));
      const tenant = await asAnon(async (tx) => one<Record<string, unknown> | null>(await tx`select app.public_tenant(${slug!}) as r`));
      if (!tenant) throw new HttpError(404, 'tenant_unavailable', 'Студия не найдена');
      return json(req, {tenant}, 200, {'Cache-Control': 'public, max-age=30'});
    },
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/tenant/${SLUG}/availability$`),
    handler: async (req, [slug], url) => {
      await enforce(PUBLIC_LIMITS.read(await ip(req)));
      const q = query(url, availabilityQuery);
      if (daysBetween(q.from, q.to) < 0 || daysBetween(q.from, q.to) > 14) throw new HttpError(400, 'invalid_input', 'Период до 15 дней');
      const availability = await asAnon(async (tx) =>
        one(await tx`select app.public_availability(${slug!}, ${q.service}, ${q.from}::date, ${q.to}::date) as r`),
      );
      return json(req, {availability});
    },
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/tenant/${SLUG}/bookings$`),
    handler: async (req, [slug]) => {
      const key = await ip(req);
      const body = await readJson(req, createBookingBody);
      await enforce(PUBLIC_LIMITS.create(key), PUBLIC_LIMITS.createTenant(slug!));
      const token = await deriveBookingToken(slug!, body.idempotencyKey);
      const hash = await tokenHash(token);
      const result = await asAnon(async (tx) =>
        one<{booking: unknown; replayed: boolean}>(
          await tx`select app.public_create_booking(${slug!}, ${body.serviceId}, ${body.startAt}, ${body.name}, ${body.phone},
                     ${body.car}, ${body.carPlate}, ${body.comment}, ${body.idempotencyKey}, ${hash}) as r`,
        ),
      );
      // The same idempotency key always yields the same token, so a retry after a
      // lost response gets working access to the booking it already created.
      return json(req, {booking: result.booking, token, replayed: result.replayed}, result.replayed ? 200 : 201);
    },
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/tenant/${SLUG}/booking/get$`),
    handler: async (req, [slug]) => {
      await enforce(PUBLIC_LIMITS.token(await ip(req)));
      const {token} = await readJson(req, tokenBody);
      const r = await asAnon(async (tx) => one(await tx`select app.public_get_booking(${slug!}, ${await tokenHash(token)}) as r`));
      return json(req, r);
    },
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/tenant/${SLUG}/booking/availability$`),
    handler: async (req, [slug]) => {
      await enforce(PUBLIC_LIMITS.token(await ip(req)), PUBLIC_LIMITS.read(await ip(req)));
      const b = await readJson(req, tokenAvailabilityBody);
      const availability = await asAnon(async (tx) =>
        one(await tx`select app.public_booking_availability(${slug!}, ${await tokenHash(b.token)}, ${b.from}::date, ${b.to}::date) as r`),
      );
      return json(req, {availability});
    },
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/tenant/${SLUG}/booking/reschedule$`),
    handler: async (req, [slug]) => {
      await enforce(PUBLIC_LIMITS.token(await ip(req)));
      const b = await readJson(req, rescheduleBody);
      const r = await asAnon(async (tx) =>
        one(await tx`select app.public_reschedule_booking(${slug!}, ${await tokenHash(b.token)}, ${b.startAt}, ${b.idempotencyKey}) as r`),
      );
      return json(req, r);
    },
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/tenant/${SLUG}/booking/cancel$`),
    handler: async (req, [slug]) => {
      await enforce(PUBLIC_LIMITS.token(await ip(req)));
      const b = await readJson(req, cancelBody);
      const r = await asAnon(async (tx) => one(await tx`select app.public_cancel_booking(${slug!}, ${await tokenHash(b.token)}, ${b.reason}) as r`));
      return json(req, r);
    },
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/tenant/${SLUG}/booking/push$`),
    handler: async (req, [slug]) => {
      await enforce(PUBLIC_LIMITS.token(await ip(req)));
      const b = await readJson(req, clientPushBody);
      const r = await asAnon(async (tx) =>
        one(
          await tx`select app.public_save_push_subscription(${slug!}, ${await tokenHash(b.token)}, ${b.subscription.endpoint},
                     ${b.subscription.keys.p256dh}, ${b.subscription.keys.auth}, ${req.headers.get('user-agent') ?? ''}) as r`,
        ),
      );
      return json(req, r);
    },
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/tenant/${SLUG}/booking/push/delete$`),
    handler: async (req, [slug]) => {
      await enforce(PUBLIC_LIMITS.token(await ip(req)));
      const b = await readJson(req, clientPushDeleteBody);
      const r = await asAnon(async (tx) =>
        one(await tx`select app.public_delete_push_subscription(${slug!}, ${await tokenHash(b.token)}, ${b.endpoint}) as r`),
      );
      return json(req, r);
    },
  },
  {
    method: 'GET',
    pattern: /^\/health$/,
    handler: async (req) => json(req, {ok: true}),
  },
]);
