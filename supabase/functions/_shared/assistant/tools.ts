// Server-side tools the model may request. The model only picks a tool name and
// small, validated arguments; the SQL, the tenant and the caller's authority
// come from the verified request context. Client and owner tools are separate
// registries: a client conversation can never reach an owner tool.
import {z} from 'zod';
import {asAnon, asUser, one, type Claims} from '../db.ts';
import {tokenHash} from '../crypto.ts';
import {addDays, localDate, PERIOD_PRESETS, resolvePeriod, isoWeekday} from '../core/periods.ts';
import type {AssistantAction} from '../core/contract.ts';

export type ServiceBrief = {id: string; key: string; name: string; category: string; durationMinutes: number; completion: string; price: {amount: number; isFrom: boolean}};

export type ClientContext = {
  scope: 'client';
  tenantId: string;
  slug: string;
  name: string;
  timezone: string;
  profile: Record<string, unknown>;
  services: ServiceBrief[];
  tokens: string[];
  now: Date;
};

export type OwnerContext = {
  scope: 'owner';
  tenantId: string;
  slug: string;
  name: string;
  timezone: string;
  claims: Claims;
  services: ServiceBrief[];
  now: Date;
};

export type ToolContext = ClientContext | OwnerContext;

export type ToolOutcome = {data: unknown; actions?: AssistantAction[]};

export type ToolDef<S extends z.ZodType = z.ZodType> = {
  name: string;
  scope: 'client' | 'owner';
  description: string;
  args: S;
  parameters: Record<string, unknown>;
  run: (ctx: ToolContext, args: z.infer<S>) => Promise<ToolOutcome>;
};

/** Keeps argument types inferred from the Zod schema, then erases them for the registry. */
function defineTool<S extends z.ZodType>(tool: ToolDef<S>): ToolDef {
  return tool as unknown as ToolDef;
}

const WEEKDAY = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function slotLabel(date: string, time: string) {
  const [, m, d] = date.split('-');
  return `${WEEKDAY[isoWeekday(date)]} ${Number(d)}.${m} · ${time}`;
}

function findService(ctx: ToolContext, key: string): ServiceBrief {
  const s = ctx.services.find((x) => x.key === key || x.name.toLowerCase() === key.toLowerCase());
  if (!s) throw new ToolInputError(`Неизвестная услуга "${key}". Допустимые ключи: ${ctx.services.map((x) => x.key).join(', ')}`);
  return s;
}

export class ToolInputError extends Error {}

type Availability = {timezone: string; days: {date: string; slots: {startAt: string; time: string}[]}[]};

function summarizeAvailability(ctx: ToolContext, s: ServiceBrief, a: Availability): ToolOutcome {
  const days = a.days.map((d) => ({date: d.date, weekday: WEEKDAY[isoWeekday(d.date)], times: d.slots.slice(0, 10).map((x) => x.time), total: d.slots.length}));
  const actions: AssistantAction[] = [];
  for (const d of a.days) {
    for (const slot of d.slots.slice(0, 2)) {
      if (actions.length >= 4) break;
      actions.push({type: 'book', serviceId: s.id, startAt: slot.startAt, label: `Записаться: ${slotLabel(d.date, slot.time)}`});
    }
  }
  return {
    data: {service: s.name, serviceKey: s.key, durationMinutes: s.durationMinutes, multiDay: s.completion === 'multi_day', timezone: a.timezone, days},
    actions: ctx.scope === 'client' ? actions : [],
  };
}

const slotsArgs = z.object({
  service_key: z.string().min(1).max(64),
  date_from: dateArg.optional(),
  days: z.number().int().min(1).max(7).optional(),
}).strict();
const slotsParameters = {
  type: 'object',
  properties: {
    service_key: {type: 'string', description: 'Ключ услуги из списка услуг'},
    date_from: {type: 'string', description: 'Первая дата YYYY-MM-DD в часовом поясе студии (по умолчанию сегодня)'},
    days: {type: 'integer', minimum: 1, maximum: 7, description: 'Сколько дней смотреть (1–7)'},
  },
  required: ['service_key'],
  additionalProperties: false,
};

const empty = z.object({}).strict();
const emptyParameters = {type: 'object', properties: {}, additionalProperties: false};

export const CLIENT_TOOLS: ToolDef[] = [
  defineTool({
    name: 'list_services',
    scope: 'client',
    description: 'Список услуг студии с ценами и длительностью.',
    args: empty,
    parameters: emptyParameters,
    run: async (ctx) => ({
      data: ctx.services.map((s) => ({key: s.key, name: s.name, category: s.category, durationMinutes: s.durationMinutes, multiDay: s.completion === 'multi_day', price: s.price.amount, priceFrom: s.price.isFrom})),
    }),
  }),
  defineTool({
    name: 'find_free_slots',
    scope: 'client',
    description: 'Свободное время для записи на услугу. Возвращает реальные свободные моменты приёма.',
    args: slotsArgs,
    parameters: slotsParameters,
    run: async (ctx, args) => {
      const c = ctx as ClientContext;
      const s = findService(c, args.service_key);
      const from = args.date_from ?? localDate(c.now, c.timezone);
      const to = addDays(from, (args.days ?? 3) - 1);
      const a = await asAnon(async (tx) => one<Availability>(await tx`select app.public_availability(${c.slug}, ${s.id}, ${from}::date, ${to}::date) as r`));
      return summarizeAvailability(c, s, a);
    },
  }),
  defineTool({
    name: 'studio_info',
    scope: 'client',
    description: 'Адрес, телефон, часы работы и ближайшие изменения графика.',
    args: empty,
    parameters: emptyParameters,
    run: async (ctx) => {
      const c = ctx as ClientContext;
      const t = await asAnon(async (tx) => one<Record<string, unknown>>(await tx`select app.public_tenant(${c.slug}) as r`));
      return {data: {name: c.name, contacts: (c.profile as {contacts?: unknown}).contacts, workingHours: t.workingHours, exceptions: t.exceptions, timezone: c.timezone}};
    },
  }),
  defineTool({
    name: 'my_bookings',
    scope: 'client',
    description: 'Записи клиента, сохранённые на этом устройстве (статус, время, можно ли изменить).',
    args: empty,
    parameters: emptyParameters,
    run: async (ctx) => {
      const c = ctx as ClientContext;
      const bookings: unknown[] = [];
      const actions: AssistantAction[] = [];
      for (const token of c.tokens) {
        try {
          const r = await asAnon(async (tx) => one<{booking: {id: string; status: string; startAt: string; service: {name: string}; canChange: boolean}}>(
            await tx`select app.public_get_booking(${c.slug}, ${await tokenHash(token)}) as r`));
          bookings.push({service: r.booking.service.name, startAt: r.booking.startAt, status: r.booking.status, canChange: r.booking.canChange});
          actions.push({type: 'open_booking', bookingId: r.booking.id, label: `Открыть: ${r.booking.service.name}`});
        } catch {
          /* token of another studio or deleted booking: skip */
        }
      }
      return {data: {bookings, note: bookings.length ? undefined : 'На этом устройстве нет сохранённых записей'}, actions};
    },
  }),
];

const statsArgs = z.object({
  period: z.enum(PERIOD_PRESETS).optional(),
  date_from: dateArg.optional(),
  date_to: dateArg.optional(),
}).strict();

export const OWNER_TOOLS: ToolDef[] = [
  defineTool({
    name: 'get_stats',
    scope: 'owner',
    description:
      'Статистика студии за период в часовом поясе студии: заезды (visits), выполненные заказы (completedOrders), полученные оплаты (paymentsReceived), будущие записи с ожидаемой стоимостью (upcoming — это НЕ выручка), отмены, неявки, долги.',
    args: statsArgs,
    parameters: {
      type: 'object',
      properties: {
        period: {type: 'string', enum: [...PERIOD_PRESETS], description: 'Готовый период'},
        date_from: {type: 'string', description: 'Начало YYYY-MM-DD (если нет period)'},
        date_to: {type: 'string', description: 'Конец YYYY-MM-DD включительно (если нет period)'},
      },
      additionalProperties: false,
    },
    run: async (ctx, args) => {
      const o = ctx as OwnerContext;
      const p = args.date_from && args.date_to && !args.period
        ? {from: args.date_from, to: args.date_to, timezone: o.timezone}
        : resolvePeriod(args.period ?? 'today', o.timezone, o.now);
      const stats = await asUser(o.claims, async (tx) => one(await tx`select app.owner_stats(${o.tenantId}, ${p.from}::date, ${p.to}::date) as r`));
      return {data: {period: p, stats}};
    },
  }),
  defineTool({
    name: 'get_schedule',
    scope: 'owner',
    description: 'Записи и блокировки постов на дату (по умолчанию сегодня).',
    args: z.object({date: dateArg.optional()}).strict(),
    parameters: {type: 'object', properties: {date: {type: 'string', description: 'YYYY-MM-DD'}}, additionalProperties: false},
    run: async (ctx, args) => {
      const o = ctx as OwnerContext;
      const date = args.date ?? localDate(o.now, o.timezone);
      const s = await asUser(o.claims, async (tx) =>
        one<{resources: {id: string; name: string}[]; bookings: {id: string; status: string; startAt: string; resourceId: string; serviceName: string; customerName: string; car: string | null}[]; blocks: unknown[]}>(
          await tx`select app.owner_schedule(${o.tenantId}, ${date}::date, ${date}::date, false) as r`,
        ),
      );
      const res = new Map(s.resources.map((r) => [r.id, r.name]));
      const fmt = new Intl.DateTimeFormat('ru-RU', {timeZone: o.timezone, hour: '2-digit', minute: '2-digit'});
      return {
        data: {
          date,
          bookings: s.bookings.map((b) => ({time: fmt.format(new Date(b.startAt)), status: b.status, service: b.serviceName, customer: b.customerName, car: b.car, resource: res.get(b.resourceId)})),
          blocks: s.blocks.length,
        },
        actions: s.bookings.slice(0, 3).map((b) => ({type: 'open_booking' as const, bookingId: b.id, label: `${fmt.format(new Date(b.startAt))} ${b.customerName}`})),
      };
    },
  }),
  defineTool({
    name: 'find_booking',
    scope: 'owner',
    description: 'Поиск записей по имени клиента, телефону (цифры) или госномеру.',
    args: z.object({query: z.string().trim().min(2).max(60)}).strict(),
    parameters: {type: 'object', properties: {query: {type: 'string'}}, required: ['query'], additionalProperties: false},
    run: async (ctx, args) => {
      const o = ctx as OwnerContext;
      const r = await asUser(o.claims, async (tx) =>
        one<{id: string; startAt: string; serviceName: string; customerName: string; status: string}[]>(await tx`select app.owner_find_bookings(${o.tenantId}, ${args.query}, 10) as r`),
      );
      return {data: r, actions: r.slice(0, 3).map((b) => ({type: 'open_booking' as const, bookingId: b.id, label: `${b.customerName}: ${b.serviceName}`}))};
    },
  }),
  defineTool({
    name: 'find_free_slots',
    scope: 'owner',
    description: 'Свободное время на услугу (для записи клиента по телефону).',
    args: slotsArgs,
    parameters: slotsParameters,
    run: async (ctx, args) => {
      const o = ctx as OwnerContext;
      const s = findService(o, args.service_key);
      const from = args.date_from ?? localDate(o.now, o.timezone);
      const to = addDays(from, (args.days ?? 3) - 1);
      const a = await asUser(o.claims, async (tx) => one<Availability>(await tx`select app.owner_availability(${o.tenantId}, ${s.id}, ${from}::date, ${to}::date, null) as r`));
      return summarizeAvailability(o, s, a);
    },
  }),
  defineTool({
    name: 'list_services',
    scope: 'owner',
    description: 'Услуги студии с ценами, длительностью и статусом паузы.',
    args: empty,
    parameters: emptyParameters,
    run: async (ctx) => ({data: ctx.services}),
  }),
];

export function toolsFor(scope: 'client' | 'owner'): ToolDef[] {
  return scope === 'client' ? CLIENT_TOOLS : OWNER_TOOLS;
}

export type ToolRun = {name: string; ok: boolean; data: unknown; actions: AssistantAction[]};

/** Executes a tool call from the model after scope and argument validation. */
export async function runTool(ctx: ToolContext, name: string, rawArgs: unknown): Promise<ToolRun> {
  const tool = toolsFor(ctx.scope).find((t) => t.name === name);
  if (!tool) {
    console.warn(`assistant: tool "${name}" rejected for scope ${ctx.scope}`);
    return {name, ok: false, data: {error: `Инструмент ${name} недоступен`}, actions: []};
  }
  const parsed = tool.args.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return {name, ok: false, data: {error: 'Неверные аргументы', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)}, actions: []};
  }
  try {
    const out = await tool.run(ctx, parsed.data);
    return {name, ok: true, data: out.data, actions: out.actions ?? []};
  } catch (error) {
    if (error instanceof ToolInputError) return {name, ok: false, data: {error: error.message}, actions: []};
    console.error(`assistant: tool ${name} failed`, error);
    return {name, ok: false, data: {error: 'Не удалось получить данные'}, actions: []};
  }
}
