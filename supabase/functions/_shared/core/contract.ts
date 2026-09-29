// Request contracts shared by the browser (forms) and Edge Functions
// (validation). Note what is NOT here: tenant_id, price and duration — the
// server derives them from the slug/service.
import {z} from 'zod';
import {normalizePhone} from './phone.ts';

export const uuid = z.uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const isoInstant = z.iso.datetime({offset: true});
export const bookingToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'invalid token');

export const phone = z
  .string()
  .trim()
  .min(5, 'Введите телефон')
  .transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) {
      ctx.addIssue({code: 'custom', message: 'Телефон в формате +7 999 123-45-67'});
      return z.NEVER;
    }
    return n;
  });

export const createBookingBody = z.object({
  serviceId: uuid,
  startAt: isoInstant,
  name: z.string().trim().min(1, 'Как к вам обращаться?').max(80),
  phone,
  car: z.string().trim().max(80).optional().default(''),
  carPlate: z.string().trim().max(16).optional().default(''),
  comment: z.string().trim().max(500).optional().default(''),
  idempotencyKey: uuid,
  consent: z.literal(true, {error: 'Нужно согласие на обработку данных'}),
});
export type CreateBookingBody = z.input<typeof createBookingBody>;

export const tokenBody = z.object({token: bookingToken});
export const tokenAvailabilityBody = z.object({token: bookingToken, from: isoDate, to: isoDate});
export const rescheduleBody = z.object({token: bookingToken, startAt: isoInstant, idempotencyKey: uuid});
export const cancelBody = z.object({token: bookingToken, reason: z.string().trim().max(300).optional().default('')});

export const pushSubscription = z.object({
  endpoint: z.url().refine((u) => u.startsWith('https://'), 'https only').refine((u) => u.length <= 2000),
  keys: z.object({p256dh: z.string().min(40).max(200), auth: z.string().min(8).max(100)}),
});
export const clientPushBody = z.object({token: bookingToken, subscription: pushSubscription});
export const clientPushDeleteBody = z.object({token: bookingToken, endpoint: z.url()});

export const availabilityQuery = z.object({service: uuid, from: isoDate, to: isoDate});

// Owner
export const ownerCreateBookingBody = createBookingBody.omit({consent: true}).extend({resourceId: uuid.optional()});
export const ownerRescheduleBody = z.object({startAt: isoInstant, idempotencyKey: uuid});
export const ownerCancelBody = z.object({reason: z.string().trim().max(300).optional().default('')});
export const ownerStatusBody = z.object({
  status: z.enum(['arrived', 'completed', 'no_show']),
  finalAmount: z.number().min(0).max(100_000_000).nullable().optional(),
});
export const ownerPaymentBody = z.object({
  amount: z.number().positive().max(100_000_000),
  method: z.enum(['cash', 'card', 'transfer', 'other']),
  receivedAt: isoInstant.optional(),
  note: z.string().trim().max(200).optional().default(''),
  idempotencyKey: uuid,
});
export const ownerBlockBody = z.object({resourceId: uuid, from: isoInstant, to: isoInstant, note: z.string().trim().max(200).optional().default('')});
export const ownerPausedBody = z.object({kind: z.enum(['service', 'resource']), id: uuid, paused: z.boolean()});
export const hhmm = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/);
export const ownerExceptionBody = z.object({intervals: z.array(z.tuple([hhmm, hhmm])).max(4), note: z.string().trim().max(120).optional().default('')});
export const ownerUploadUrlBody = z.object({contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']), size: z.number().int().positive().max(10 * 1024 * 1024)});
export const ownerMediaBody = z.object({
  path: z.string().max(300),
  alt: z.string().trim().max(140).optional().default(''),
  width: z.number().int().positive().max(20000).optional(),
  height: z.number().int().positive().max(20000).optional(),
});
export const ownerPushBody = z.object({subscription: pushSubscription});
export const statsQuery = z.object({from: isoDate, to: isoDate});

// Assistant
export const chatMessage = z.object({role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(2000)});
export const clientAssistantBody = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  messages: z.array(chatMessage).min(1).max(20),
  // Booking tokens stored on this device; the server (not the model) decides to use them.
  tokens: z.array(bookingToken).max(10).optional().default([]),
});
export const ownerAssistantBody = z.object({tenantId: uuid, messages: z.array(chatMessage).min(1).max(20)});

export type AssistantAction = {type: 'book'; serviceId: string; startAt: string; label: string} | {type: 'open_booking'; bookingId: string; label: string};
export type AssistantReply = {
  reply: string;
  actions: AssistantAction[];
  tools: {name: string; ok: boolean}[];
  router: 'tools' | 'json';
};
