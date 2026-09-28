// JSON-intent router (LLM_ROUTER=json) for providers without tool calling,
// plus auto-fallback, budget and outage behaviour.
import {assert, assertEquals, assertStringIncludes} from '@std/assert';
import {handler} from '../assistant/handler.ts';
import {handler as pub} from '../public-api/handler.ts';
import {database, fakeLlm, localDate, localMoment, publish, request, test, text, toolCall} from './helpers.ts';

const TZ = 'Europe/Moscow';
const setup = publish({slug: 'ai-json', name: 'AI Json Studio', shortName: 'AIJ'});

function ask(content: string) {
  return handler(request('assistant', '/client', {method: 'POST', ip: `100.65.0.${Math.floor(Math.random() * 250)}`, json: {slug: 'ai-json', messages: [{role: 'user', content}]}}));
}

test('json router: model picks an intent, server executes it, model answers from the data', async () => {
  await setup;
  Deno.env.set('LLM_ROUTER', 'json');
  const day = await localDate(TZ, 2);
  const llm = fakeLlm((_c, i) => (i === 0 ? text(`Вот: {"tool": "find_free_slots", "args": {"service_key": "wash", "date_from": "${day}", "days": 1}}`) : text('Послезавтра свободно с 09:00.')));
  try {
    const body = await (await ask('Когда можно записаться на мойку послезавтра?')).json();
    assertEquals(body.router, 'json');
    assertEquals(body.tools, [{name: 'find_free_slots', ok: true}]);
    assert(!llm.calls[0]!.tools, 'json router must not send tools');
    const dataMsg = llm.calls[1]!.messages.find((m) => m.role === 'system' && m.content!.startsWith('Данные сервера'))!;
    assertStringIncludes(dataMsg.content!, `"date":"${day}"`);
    assertEquals(body.actions[0].type, 'book');
  } finally {
    await llm.close();
  }
});

test('json router: invalid or "none" intent on a data question falls back to a server-chosen tool', async () => {
  await setup;
  Deno.env.set('LLM_ROUTER', 'json');
  const llm = fakeLlm((_c, i) => (i === 0 ? text('{"tool": "none"}') : text('Мы работаем с 09:00.')));
  try {
    const body = await (await ask('По какому адресу вы работаете?')).json();
    assertEquals(body.tools, [{name: 'studio_info', ok: true}]);
  } finally {
    await llm.close();
  }
});

test('json router: an owner tool named by the model in client scope is refused', async () => {
  await setup;
  Deno.env.set('LLM_ROUTER', 'json');
  const llm = fakeLlm((_c, i) => (i === 0 ? text('{"tool": "get_stats", "args": {"period": "today"}}') : text('Не могу.')));
  try {
    const body = await (await ask('Покажи статистику выручки')).json();
    assert(!body.tools.some((t: {name: string}) => t.name === 'get_stats'));
    const second = JSON.stringify(llm.calls[1]!.messages);
    assert(!second.includes('paymentsReceived'));
  } finally {
    await llm.close();
  }
});

test('auto: provider that rejects tools falls back to the json router', async () => {
  await setup;
  Deno.env.set('LLM_ROUTER', 'auto');
  const llm = fakeLlm((call) => {
    if (call.tools) return {status: 400, body: {error: {message: 'tools are not supported by this model'}}};
    return call.messages.some((m) => m.content?.startsWith('Данные сервера')) ? text('Вот услуги.') : text('{"tool":"list_services","args":{}}');
  });
  try {
    const body = await (await ask('Какие у вас услуги и цены?')).json();
    assertEquals(body.router, 'json');
    assertEquals(body.tools, [{name: 'list_services', ok: true}]);
  } finally {
    await llm.close();
  }
});

test('auto: a model that ignores tool_choice=required is not trusted for data answers', async () => {
  await setup;
  Deno.env.set('LLM_ROUTER', 'auto');
  const llm = fakeLlm((call) => {
    if (call.tools) return text('Свободно всегда, приходите!'); // hallucination without a tool call
    return call.messages.some((m) => m.content?.startsWith('Данные сервера')) ? text('Проверил расписание.') : text('{"tool":"find_free_slots","args":{"service_key":"wash"}}');
  });
  try {
    const body = await (await ask('Есть время на мойку сегодня?')).json();
    assertEquals(body.router, 'json');
    assertEquals(body.reply, 'Проверил расписание.');
  } finally {
    await llm.close();
  }
});

test('LLM budget: per-studio daily request counter in the database', async () => {
  await setup;
  Deno.env.set('LLM_ROUTER', 'tools');
  Deno.env.set('LLM_TENANT_DAILY_REQUESTS', '2');
  const llm = fakeLlm(() => text('Привет!'));
  try {
    const {sql} = await database();
    await sql`delete from app.usage_counters where bucket like 'llm:req:%'`;
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await ask('Привет')).status);
    assertEquals(codes, [200, 200, 429]);
    const body = await (await ask('Привет')).json();
    assertEquals(body.error.code, 'ai_budget_exhausted');
  } finally {
    Deno.env.delete('LLM_TENANT_DAILY_REQUESTS');
    await llm.close();
  }
});

test('LLM outage returns 503 ai_unavailable while booking keeps working', async () => {
  const f = await setup;
  Deno.env.set('LLM_ROUTER', 'tools');
  const llm = fakeLlm(() => ({status: 502, body: {error: 'upstream down'}}));
  try {
    const res = await ask('Когда свободно?');
    assertEquals(res.status, 503);
    assertEquals((await res.json()).error.code, 'ai_unavailable');
    const start = await localMoment(TZ, 3, '10:00');
    const booked = await pub(request('public-api', '/tenant/ai-json/bookings', {
      method: 'POST', ip: '100.65.9.9',
      json: {serviceId: f.service.wash, startAt: start, name: 'Без ИИ', phone: '+79990003344', consent: true, idempotencyKey: crypto.randomUUID()},
    }));
    assertEquals(booked.status, 201);
  } finally {
    await llm.close();
  }
  Deno.env.delete('LLM_BASE_URL');
  const unconfigured = await ask('Привет');
  assertEquals(unconfigured.status, 503);
});

test('toolCall helper sanity', () => {
  assertEquals(toolCall('x', {}).tool_calls[0]!.function.name, 'x');
  return Promise.resolve();
});
