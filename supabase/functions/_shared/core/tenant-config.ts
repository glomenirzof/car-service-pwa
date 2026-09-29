// business.json contract. Isomorphic: imported by the Vite app, Node pipeline
// scripts and Deno Edge Functions. The database is the runtime source of truth;
// this file only describes the pipeline input that gets published into it.
import {z} from 'zod';

export const SCHEMA_VERSION = 1;

const slug = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/, 'slug: латиница, цифры и дефис, 2–40 символов');

const key = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'key: латиница в нижнем регистре, цифры и дефис');

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'цвет в формате #RRGGBB');

const hhmm = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'время в формате HH:MM');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'дата в формате YYYY-MM-DD');

const imagePath = z
  .string()
  .regex(/^images\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp|svg)$/, 'путь к изображению внутри images/');

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', {timeZone: tz});
    return tz.includes('/') || tz === 'UTC';
  } catch {
    return false;
  }
}

export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

const interval = z.tuple([hhmm, hhmm]).refine(([a, b]) => minutesOf(a) < minutesOf(b), {
  message: 'начало интервала должно быть раньше конца',
});

const dayHours = z.array(interval).max(4);

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const resourceSchema = z.object({
  key,
  name: z.string().min(1).max(60),
  kind: z.enum(['box', 'lift', 'wash', 'bay', 'other']).default('box'),
  capabilities: z.array(key).min(1),
  description: z.string().max(200).optional(),
});

export const serviceSchema = z.object({
  key,
  name: z.string().min(1).max(80),
  category: z.string().min(1).max(40),
  description: z.string().max(600).default(''),
  durationMinutes: z.number().int().min(10).max(60 * 24 * 14),
  bufferMinutes: z.number().int().min(0).max(24 * 60).default(0),
  // same_day: the work must finish inside the working window it starts in.
  // multi_day: the car stays on the resource continuously (nights included).
  completion: z.enum(['same_day', 'multi_day']).default('same_day'),
  capability: key,
  price: z.object({
    amount: z.number().min(0).max(10_000_000),
    from: z.boolean().default(false),
  }),
  image: imagePath.optional(),
  popular: z.boolean().default(false),
});

export const businessConfigSchema = z
  .object({
    $schema: z.string().optional(),
    schemaVersion: z.literal(SCHEMA_VERSION),
    slug,
    name: z.string().min(2).max(60),
    shortName: z.string().min(1).max(12),
    tagline: z.string().min(1).max(90),
    description: z.string().max(1200).default(''),
    locale: z.enum(['ru-RU']).default('ru-RU'),
    currency: z.enum(['RUB']).default('RUB'),
    timezone: z.string().refine(isValidTimeZone, 'неизвестная IANA timezone'),
    contacts: z.object({
      phone: z.string().regex(/^\+\d{10,15}$/, 'телефон в формате E.164, например +79990000000'),
      address: z.string().min(5).max(200),
      city: z.string().min(2).max(60),
      mapUrl: z.url().optional(),
      telegram: z.string().regex(/^[A-Za-z0-9_]{4,32}$/).optional(),
      email: z.email().optional(),
    }),
    brand: z.object({
      accent: hexColor,
      background: hexColor.default('#0B0C0E'),
      logo: imagePath,
      icon: imagePath,
      maskableIcon: imagePath.optional(),
      hero: imagePath,
    }),
    gallery: z
      .array(z.object({file: imagePath, alt: z.string().min(3).max(140)}))
      .max(24)
      .default([]),
    booking: z
      .object({
        slotStepMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(30),
        minLeadMinutes: z.number().int().min(0).max(7 * 24 * 60).default(60),
        horizonDays: z.number().int().min(1).max(180).default(30),
        clientChangeUntilHours: z.number().int().min(0).max(168).default(12),
        reminderMinutesBefore: z.array(z.number().int().min(15).max(7 * 24 * 60)).max(3).default([1440, 120]),
      })
      .default({
        slotStepMinutes: 30,
        minLeadMinutes: 60,
        horizonDays: 30,
        clientChangeUntilHours: 12,
        reminderMinutesBefore: [1440, 120],
      }),
    workingHours: z.object({
      mon: dayHours,
      tue: dayHours,
      wed: dayHours,
      thu: dayHours,
      fri: dayHours,
      sat: dayHours,
      sun: dayHours,
    }),
    exceptions: z
      .array(
        z.object({
          date: isoDate,
          hours: dayHours.default([]),
          note: z.string().max(120).optional(),
        }),
      )
      .default([]),
    resources: z.array(resourceSchema).min(1).max(40),
    services: z.array(serviceSchema).min(1).max(120),
    ai: z
      .object({
        enabled: z.boolean().default(true),
        assistantName: z.string().min(1).max(30).default('Ассистент'),
        greeting: z.string().max(200).default('Подскажу по услугам и свободному времени.'),
      })
      .default({enabled: true, assistantName: 'Ассистент', greeting: 'Подскажу по услугам и свободному времени.'}),
    legal: z
      .object({
        companyName: z.string().max(120).optional(),
        privacyNote: z.string().max(400).optional(),
      })
      .default({}),
  })
  .superRefine((cfg, ctx) => {
    const unique = (items: {key: string}[], path: string) => {
      const seen = new Set<string>();
      items.forEach((item, i) => {
        if (seen.has(item.key)) {
          ctx.addIssue({code: 'custom', path: [path, i, 'key'], message: `повторяющийся key "${item.key}"`});
        }
        seen.add(item.key);
      });
    };
    unique(cfg.resources, 'resources');
    unique(cfg.services, 'services');

    const capabilities = new Set(cfg.resources.flatMap((r) => r.capabilities));
    cfg.services.forEach((s, i) => {
      if (!capabilities.has(s.capability)) {
        ctx.addIssue({
          code: 'custom',
          path: ['services', i, 'capability'],
          message: `ни один ресурс не умеет "${s.capability}"`,
        });
      }
      if (s.completion === 'same_day') {
        const longestWindow = Math.max(
          0,
          ...WEEKDAYS.flatMap((d) => cfg.workingHours[d].map(([a, b]) => minutesOf(b) - minutesOf(a))),
        );
        if (s.durationMinutes > longestWindow) {
          ctx.addIssue({
            code: 'custom',
            path: ['services', i, 'durationMinutes'],
            message: 'услуга same_day длиннее самого длинного рабочего окна — укажите completion: multi_day',
          });
        }
      }
    });

    WEEKDAYS.forEach((d) => {
      const sorted = [...cfg.workingHours[d]].sort((a, b) => minutesOf(a[0]) - minutesOf(b[0]));
      for (let i = 1; i < sorted.length; i++) {
        if (minutesOf(sorted[i]![0]) < minutesOf(sorted[i - 1]![1])) {
          ctx.addIssue({code: 'custom', path: ['workingHours', d], message: 'интервалы пересекаются'});
        }
      }
    });
    if (WEEKDAYS.every((d) => cfg.workingHours[d].length === 0)) {
      ctx.addIssue({code: 'custom', path: ['workingHours'], message: 'нет ни одного рабочего дня'});
    }
    const dates = new Set<string>();
    cfg.exceptions.forEach((e, i) => {
      if (dates.has(e.date)) ctx.addIssue({code: 'custom', path: ['exceptions', i, 'date'], message: 'дата повторяется'});
      dates.add(e.date);
    });
  });

export type BusinessConfig = z.infer<typeof businessConfigSchema>;
export type BusinessConfigInput = z.input<typeof businessConfigSchema>;
export type ServiceConfig = z.infer<typeof serviceSchema>;
export type ResourceConfig = z.infer<typeof resourceSchema>;

export function formatConfigIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}
