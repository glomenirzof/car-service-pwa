// Owner cabinet API. Every call: verify the Supabase JWT, then run SQL as
// role authenticated with the verified claims. Membership in the tenant is
// checked by the database (app.assert_member / RLS), never trusted from input.
import {asUser, one, type Claims} from '../_shared/db.ts';
import {HttpError, json, readJson, query, serveRoutes} from '../_shared/http.ts';
import {requireOwner} from '../_shared/auth.ts';
import {enforce, PUBLIC_LIMITS} from '../_shared/limits.ts';
import {objectExists, removeObject, signedUpload} from '../_shared/storage.ts';
import {
  availabilityQuery,
  isoDate,
  ownerBlockBody,
  ownerCancelBody,
  ownerCreateBookingBody,
  ownerExceptionBody,
  ownerMediaBody,
  ownerPausedBody,
  ownerPaymentBody,
  ownerPushBody,
  ownerRescheduleBody,
  ownerStatusBody,
  ownerUploadUrlBody,
  statsQuery,
  uuid,
} from '../_shared/core/contract.ts';
import {z} from 'zod';

const T = '([0-9a-f-]{36})';
const ID = '([0-9a-f-]{36})';
const DATE = '(\\d{4}-\\d{2}-\\d{2})';

type Handler = (req: Request, claims: Claims, params: string[], url: URL) => Promise<Response>;

function owner(handler: Handler) {
  return async (req: Request, params: string[], url: URL) => {
    const claims = await requireOwner(req);
    await enforce(PUBLIC_LIMITS.owner(claims.sub));
    for (const p of params) if (p.length === 36) uuid.parse(p);
    return handler(req, claims, params, url);
  };
}

const call = (claims: Claims, fn: (tx: Parameters<Parameters<typeof asUser>[1]>[0]) => Promise<readonly {r: unknown}[]>) =>
  asUser(claims, async (tx) => one(await fn(tx)));

const scheduleQuery = z.object({from: isoDate, to: isoDate, cancelled: z.enum(['0', '1']).optional()});
const searchQuery = z.object({q: z.string().trim().min(2).max(60)});
const ownerAvailabilityQuery = availabilityQuery.extend({exclude: uuid.optional()});

export const handler = serveRoutes('owner-api', [
  {
    method: 'GET',
    pattern: /^\/context$/,
    handler: owner(async (req, claims) => json(req, {user: {id: claims.sub, email: claims.email}, tenants: await call(claims, (tx) => tx`select app.owner_context() as r`)})),
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/t/${T}/tenant$`),
    handler: owner(async (req, claims, [t]) => json(req, {tenant: await call(claims, (tx) => tx`select app.owner_tenant(${t!}) as r`)})),
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/t/${T}/schedule$`),
    handler: owner(async (req, claims, [t], url) => {
      const q = query(url, scheduleQuery);
      return json(req, {schedule: await call(claims, (tx) => tx`select app.owner_schedule(${t!}, ${q.from}::date, ${q.to}::date, ${q.cancelled === '1'}) as r`)});
    }),
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/t/${T}/bookings/${ID}$`),
    handler: owner(async (req, claims, [t, id]) => json(req, {booking: await call(claims, (tx) => tx`select app.owner_booking(${t!}, ${id!}) as r`)})),
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/t/${T}/search$`),
    handler: owner(async (req, claims, [t], url) => {
      const q = query(url, searchQuery);
      return json(req, {results: await call(claims, (tx) => tx`select app.owner_find_bookings(${t!}, ${q.q}, 20) as r`)});
    }),
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/t/${T}/availability$`),
    handler: owner(async (req, claims, [t], url) => {
      const q = query(url, ownerAvailabilityQuery);
      return json(req, {
        availability: await call(claims, (tx) => tx`select app.owner_availability(${t!}, ${q.service}, ${q.from}::date, ${q.to}::date, ${q.exclude ?? null}) as r`),
      });
    }),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/t/${T}/bookings$`),
    handler: owner(async (req, claims, [t]) => {
      const b = await readJson(req, ownerCreateBookingBody);
      const r = await call(
        claims,
        (tx) => tx`select app.owner_create_booking(${t!}, ${b.serviceId}, ${b.startAt}, ${b.name}, ${b.phone}, ${b.car}, ${b.carPlate},
                   ${b.comment}, ${b.idempotencyKey}, ${b.resourceId ?? null}) as r`,
      );
      return json(req, r, 201);
    }),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/t/${T}/bookings/${ID}/reschedule$`),
    handler: owner(async (req, claims, [t, id]) => {
      const b = await readJson(req, ownerRescheduleBody);
      return json(req, await call(claims, (tx) => tx`select app.owner_reschedule_booking(${t!}, ${id!}, ${b.startAt}, ${b.idempotencyKey}) as r`));
    }),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/t/${T}/bookings/${ID}/cancel$`),
    handler: owner(async (req, claims, [t, id]) => {
      const b = await readJson(req, ownerCancelBody);
      return json(req, await call(claims, (tx) => tx`select app.owner_cancel_booking(${t!}, ${id!}, ${b.reason}) as r`));
    }),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/t/${T}/bookings/${ID}/status$`),
    handler: owner(async (req, claims, [t, id]) => {
      const b = await readJson(req, ownerStatusBody);
      return json(req, await call(claims, (tx) => tx`select app.owner_set_booking_status(${t!}, ${id!}, ${b.status}, ${b.finalAmount ?? null}) as r`));
    }),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/t/${T}/bookings/${ID}/payments$`),
    handler: owner(async (req, claims, [t, id]) => {
      const b = await readJson(req, ownerPaymentBody);
      return json(
        req,
        await call(claims, (tx) => tx`select app.owner_record_payment(${t!}, ${id!}, ${b.amount}, ${b.method}, ${b.receivedAt ?? null}, ${b.note}, ${b.idempotencyKey}) as r`),
        201,
      );
    }),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/t/${T}/blocks$`),
    handler: owner(async (req, claims, [t]) => {
      const b = await readJson(req, ownerBlockBody);
      return json(req, await call(claims, (tx) => tx`select app.owner_block_resource(${t!}, ${b.resourceId}, ${b.from}, ${b.to}, ${b.note}) as r`), 201);
    }),
  },
  {
    method: 'DELETE',
    pattern: new RegExp(`^/t/${T}/blocks/${ID}$`),
    handler: owner(async (req, claims, [t, id]) => json(req, await call(claims, (tx) => tx`select app.owner_unblock_resource(${t!}, ${id!}) as r`))),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/t/${T}/paused$`),
    handler: owner(async (req, claims, [t]) => {
      const b = await readJson(req, ownerPausedBody);
      return json(req, await call(claims, (tx) => tx`select app.owner_set_paused(${t!}, ${b.kind}, ${b.id}, ${b.paused}) as r`));
    }),
  },
  {
    method: 'PUT',
    pattern: new RegExp(`^/t/${T}/exceptions/${DATE}$`),
    handler: owner(async (req, claims, [t, date]) => {
      const b = await readJson(req, ownerExceptionBody);
      return json(req, await call(claims, (tx) => tx`select app.owner_set_exception(${t!}, ${date!}::date, ${tx.json(b.intervals)}, ${b.note}) as r`));
    }),
  },
  {
    method: 'DELETE',
    pattern: new RegExp(`^/t/${T}/exceptions/${DATE}$`),
    handler: owner(async (req, claims, [t, date]) => json(req, await call(claims, (tx) => tx`select app.owner_delete_exception(${t!}, ${date!}::date) as r`))),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/t/${T}/media/upload-url$`),
    handler: owner(async (req, claims, [t]) => {
      const b = await readJson(req, ownerUploadUrlBody);
      // Membership check first: only then is a signed URL minted.
      await asUser(claims, async (tx) => tx`select app.assert_member(${t!})`);
      return json(req, await signedUpload(t!, b.contentType));
    }),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/t/${T}/media$`),
    handler: owner(async (req, claims, [t]) => {
      const b = await readJson(req, ownerMediaBody);
      if (!b.path.startsWith(`tenants/${t}/owner/`)) throw new HttpError(400, 'invalid_input', 'path');
      if (!(await objectExists(b.path))) throw new HttpError(400, 'invalid_input', 'Файл не загружен');
      return json(req, await call(claims, (tx) => tx`select app.owner_add_media(${t!}, ${b.path}, ${b.alt}, ${b.width ?? null}, ${b.height ?? null}) as r`), 201);
    }),
  },
  {
    method: 'DELETE',
    pattern: new RegExp(`^/t/${T}/media/${ID}$`),
    handler: owner(async (req, claims, [t, id]) => {
      const r = await call(claims, (tx) => tx`select app.owner_delete_media(${t!}, ${id!}) as r`);
      await removeObject((r as {path: string}).path);
      return json(req, r);
    }),
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/t/${T}/push$`),
    handler: owner(async (req, claims, [t]) => json(req, await call(claims, (tx) => tx`select app.owner_push_status(${t!}) as r`))),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/t/${T}/push$`),
    handler: owner(async (req, claims, [t]) => {
      const b = await readJson(req, ownerPushBody);
      return json(
        req,
        await call(claims, (tx) => tx`select app.owner_save_push_subscription(${t!}, ${b.subscription.endpoint}, ${b.subscription.keys.p256dh},
                   ${b.subscription.keys.auth}, ${req.headers.get('user-agent') ?? ''}) as r`),
      );
    }),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/t/${T}/push/delete$`),
    handler: owner(async (req, claims, [t]) => {
      const b = await readJson(req, z.object({endpoint: z.url()}));
      return json(req, await call(claims, (tx) => tx`select app.owner_delete_push_subscription(${t!}, ${b.endpoint}) as r`));
    }),
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/t/${T}/stats$`),
    handler: owner(async (req, claims, [t], url) => {
      const q = query(url, statsQuery);
      return json(req, {stats: await call(claims, (tx) => tx`select app.owner_stats(${t!}, ${q.from}::date, ${q.to}::date) as r`)});
    }),
  },
]);
