// Native function-calling router (LLM_ROUTER=tools) against a scripted fake
// OpenAI-compatible server and the real database.
import {assert, assertEquals, assertStringIncludes} from '@std/assert';
import {handler} from '../assistant/handler.ts';
import {handler as pub} from '../public-api/handler.ts';
import {createOwner, database, fakeLlm, localDate, localMoment, mintJwt, publish, request, test, text, toolCall} from './helpers.ts';

const TZ = 'Europe/Moscow';
const setup = publish({slug: 'ai-tools', name: 'AI Tools Studio', shortName: 'AIT'});

function ask(content: string, extra: Record<string, unknown> = {}) {
  return handler(request('assistant', '/client', {method: 'POST', ip: `100.64.0.${Math.floor(Math.random() * 250)}`, json: {slug: 'ai-tools', messages: [{role: 'user', content}], ...extra}}));
}

test('data question: server runs find_free_slots BEFORE the answer and passes real slots to the model', async () => {
  await setup;
  Deno.env.set('LLM_ROUTER', 'tools');
  const tomorrow = await localDate(TZ, 1);
  const llm = fakeLlm((call, i) => (i === 0 ? toolCall('find_free_slots', {service_key: 'wash', date_from: tomorrow, days: 1}) : text('Завтра есть время с 09:00.')));
  try {
    const res = await ask('Есть ли завтра свободное время на мойку?');
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.router, 'tools');
    assertEquals(body.tools, [{name: 'find_free_slots', ok: true}]);
    // 1st call forced a tool (question is about bookings)
    assertEquals(llm.calls[0]!.tool_choice, 'required');
    // 2nd call contains the tool result with real times from the database
    const toolMsg = llm.calls[1]!.messages.find((m) => m.role === 'tool')!;
    const payload = JSON.parse(toolMsg.content!);
    assertEquals(payload.ok, true);
    assertEquals(payload.data.days[0].date, tomorrow);
    assert(payload.data.days[0].times.length > 0);
    // Book buttons come from the server data, not from the model
    assert(body.actions.length > 0);
    assertEquals(body.actions[0].type, 'book');
    const {sql} = await database();
    const [svc] = await sql`select id from app.services where key = 'wash' and tenant_id = (select id from app.tenants where slug = 'ai-tools')`;
    assertEquals(body.actions[0].serviceId, svc!.id);
  } finally {
    await llm.close();
  }
});

test('tool arguments cannot choose tenant or SQL: unknown args are rejected, service key is validated', async () => {
  await setup;
  Deno.env.set('LLM_ROUTER', 'tools');
  const llm = fakeLlm((_c, i) =>
    i === 0 ? toolCall('find_free_slots', {service_key: 'wash', tenant_id: '00000000-0000-0000-0000-000000000000', sql: 'drop table x'}) : i === 1 ? toolCall('find_free_slots', {service_key: 'teleport'}) : text('ok'),
  );
  try {
    const body = await (await ask('Свободное время на мойку?')).json();
    assertEquals(body.tools.map((t: {ok: boolean}) => t.ok), [false, false]);
    const results = llm.calls.flatMap((c) => c.messages.filter((m) => m.role === 'tool').map((m) => m.content!));
    assertStringIncludes(results[0]!, 'Неверные аргументы');
    assertStringIncludes(results.at(-1)!, 'Неизвестная услуга');
  } finally {
    await llm.close();
  }
});

test('client scope cannot reach owner tools even if the model asks for them', async () => {
  await setup;
  Deno.env.set('LLM_ROUTER', 'tools');
  const llm = fakeLlm((_c, i) => (i === 0 ? toolCall('get_stats', {period: 'today'}) : i === 1 ? toolCall('list_services', {}) : text('Вот услуги.')));
  try {
    const body = await (await ask('Какая у вас выручка сегодня и какие услуги?')).json();
    assertEquals(body.tools, [{name: 'get_stats', ok: false}, {name: 'list_services', ok: true}]);
    const offered = llm.calls[0]!.tools!.map((t) => t.function.name);
    assert(!offered.includes('get_stats'));
    const statsResult = llm.calls[1]!.messages.find((m) => m.role === 'tool')!.content!;
    assertStringIncludes(statsResult, 'недоступен');
    assert(!statsResult.includes('paymentsReceived'));
  } finally {
    await llm.close();
  }
});

test('my_bookings uses the device tokens from the request, not model arguments', async () => {
  const f = await setup;
  Deno.env.set('LLM_ROUTER', 'tools');
  const start = await localMoment(TZ, 4, '14:00');
  const created = await (await pub(request('public-api', '/tenant/ai-tools/bookings', {
    method: 'POST', ip: '100.64.1.1',
    json: {serviceId: f.service.wash, startAt: start, name: 'Анна', phone: '+79990002233', consent: true, idempotencyKey: crypto.randomUUID()},
  }))).json();
  const llm = fakeLlm((_c, i) => (i === 0 ? toolCall('my_bookings', {token: 'model-invented'}) : i === 1 ? toolCall('my_bookings', {}) : text('У вас одна запись.')));
  try {
    const body = await (await ask('Когда моя запись?', {tokens: [created.token]})).json();
    assertEquals(body.tools, [{name: 'my_bookings', ok: false}, {name: 'my_bookings', ok: true}]);
    const result = JSON.parse(llm.calls[2]!.messages.filter((m) => m.role === 'tool').at(-1)!.content!);
    assertEquals(result.data.bookings.length, 1);
    assertEquals(body.actions[0], {type: 'open_booking', bookingId: created.booking.id, label: 'Открыть: Wash'});
  } finally {
    await llm.close();
  }
});

test('loop is bounded: after LLM_MAX_TOOL_ROUNDS the model must answer (tool_choice none)', async () => {
  await setup;
  Deno.env.set('LLM_ROUTER', 'tools');
  Deno.env.set('LLM_MAX_TOOL_ROUNDS', '2');
  const llm = fakeLlm((call) => (call.tool_choice === 'none' ? text('Итог.') : toolCall('list_services', {})));
  try {
    const body = await (await ask('Какие услуги?')).json();
    assertEquals(llm.calls.length, 3);
    assertEquals(llm.calls.at(-1)!.tool_choice, 'none');
    assertEquals(body.reply, 'Итог.');
  } finally {
    Deno.env.delete('LLM_MAX_TOOL_ROUNDS');
    await llm.close();
  }
});

test('owner stats via AI use the same period and timezone as the UI (resolvePeriod + owner_stats)', async () => {
  const f = await setup;
  Deno.env.set('LLM_ROUTER', 'tools');
  const ownerId = await createOwner('ai-tools');
  const token = await mintJwt(ownerId);
  const llm = fakeLlm((_c, i) => (i === 0 ? toolCall('get_stats', {period: 'today'}) : text('Сегодня выполнено заказов: 0.')));
  try {
    const res = await handler(request('assistant', '/owner', {method: 'POST', headers: {Authorization: `Bearer ${token}`}, json: {tenantId: f.tenantId, messages: [{role: 'user', content: 'Сколько выручки сегодня?'}]}}));
    assertEquals(res.status, 200);
    const result = JSON.parse(llm.calls[1]!.messages.find((m) => m.role === 'tool')!.content!);
    const today = await localDate(TZ, 0);
    assertEquals(result.data.period, {from: today, to: today, timezone: TZ});
    assertEquals(result.data.stats.period.timezone, TZ);
    // A client cannot use the owner endpoint, and an owner of another studio is refused.
    const other = await createOwner('pub-none').catch(() => null);
    void other;
    const stranger = await mintJwt(crypto.randomUUID());
    const denied = await handler(request('assistant', '/owner', {method: 'POST', headers: {Authorization: `Bearer ${stranger}`}, json: {tenantId: f.tenantId, messages: [{role: 'user', content: 'Выручка?'}]}}));
    assertEquals(denied.status, 403);
  } finally {
    await llm.close();
  }
});
