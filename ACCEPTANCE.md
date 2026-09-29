# ACCEPTANCE — что проверено и что осталось

Состояние на 2026-09-29, ветка `claude/pwa-autoservice-implementation-0tl3eb`.
Здесь перечислены только проверки, которые **действительно запускались**. Всё, что
требует внешних сервисов (hosted Supabase, Cloudflare, провайдер LLM, push-сервисы
браузеров, реальные устройства), вынесено в раздел «Не проверено» — успех там не заявляется.

## 1. Исходные данные

- `IMPLEMENTATION-PLAN.md` в репозитории пустой (1 байт), доска Figma из среды
  разработки недоступна. Этапы 1–8 и решения восстановлены по тексту задачи:
  1 — каркас, Astryx + shadcn Drawer, схема `business.json`; 2 — схема Supabase, EXCLUDE,
  RLS, атомарные SQL-операции; 3 — конвейер `tenant:*`, две демо-студии, seed;
  4 — Edge Functions; 5 — клиентское приложение; 6 — кабинет владельца;
  7 — PWA по студиям; 8 — E2E и документация.
- Docker и Supabase CLI в среде недоступны. Всё выполнялось на PostgreSQL 16 с шимом
  Supabase (`supabase/tests/bootstrap/supabase-shim.sql`: роли `anon`/`authenticated`/
  `service_role`, `auth.uid()`, `auth.jwt()`, `auth.users`) и локальном сервере
  функций, который вызывает те же `handler.ts`, что деплоятся.

## 2. Выполненные проверки

| Проверка | Команда | Результат |
|---|---|---|
| Линт | `npm run lint` | 0 ошибок |
| Типы (app, node, service worker, Deno) | `npm run typecheck` | 0 ошибок |
| Unit (jsdom) | `npm run test` | 47 из 47 |
| SQL / интеграция на PostgreSQL | `npm run test:sql` | 57 из 57 |
| Edge Functions (Deno, реальная БД) | `npm run test:functions` | 31 из 31 |
| Браузер E2E (Playwright, Chromium, Pixel 7) | `npm run test:e2e` | 19 из 19 |
| Production-сборка | `npm run build` | успешно, 2 студии в `dist/` |
| Клонирование студии вручную | раздел 5 | успешно, замеры ниже |

Что стоит за E2E: `e2e/support/global-setup.ts` создаёт отдельную базу `cs_e2e`
(миграции + seed), запускает обработчики функций, собирает production-сборку с
`VITE_FUNCTIONS_URL` и раздаёт её `scripts/serve-dist.mjs` с теми же `_redirects`
и `_headers`, что уходят в Cloudflare Pages. Моков в браузерных тестах нет.
Chromium — предустановленный `/opt/pw-browsers/chromium` (сборка 1194), а не та,
что ожидает Playwright 1.63; путь задаётся `PW_CHROMIUM`.

Внешние сервисы в автотестах заменены **явно помеченными** локальными двойниками,
и это не выдаётся за интеграцию:

- LLM — фейковый OpenAI-совместимый сервер со сценарием ответов (`fakeLlm`);
- push-сервис — локальный HTTPS-сервер (`fakePushService`), который расшифровывает
  payload (aes128gcm, `http_ece`) и проверяет VAPID JWT (`jose`) — проверяются
  шифрование и подпись, но не доставка через FCM/APNs/Mozilla;
- Supabase Auth — JWT, подписанные тестовым HS256-секретом или локальным JWKS-ключом.

## 3. Инварианты 1–12

| # | Требование | Как сделано | Чем проверено |
|---|---|---|---|
| 1 | Одна сборка, один Supabase, `tenant_id` везде; `/s/{slug}/` и `/s/{slug}/owner/`; новая студия не заменяет прежние | Общий JS/CSS, оболочки на студию рендерит `render-site.ts` по всем `tenants/*`; во всех таблицах `tenant_id` и составные FK `(tenant_id, id)` | SQL `pipeline`: «a second studio does not replace the first»; E2E `pwa.spec.ts` (обе студии); клон из раздела 5 (3 студии, записи прежних сохранены) |
| 2 | `business.json` + картинки — вход конвейера, БД — runtime; `tenant:new/validate/publish/verify` работают | `scripts/tenant/*`, схема `schemas/business.schema.json`, `app.publish_tenant` в одной транзакции | SQL `pipeline` (4 теста, CLI через `spawnSync`); ручной прогон раздела 5 |
| 3 | Услуга занимает конкретный подходящий ресурс непрерывно, включая многодневные и буфер; часы задают моменты приёма; исключения, часовой пояс, границы дат | `app.available_starts`, `app.free_resources_at`; занятость `[start, start+duration+buffer)` | SQL `scheduling` (6: два подходящих ресурса, многодневная занятость через ночь с буфером, блокировка владельца, исключения, граница дат при UTC+5, переход на летнее время в Berlin 2027-03-28) и `booking-basics` (5) |
| 4 | Запись и блокировка — одна `resource_occupancies` с EXCLUDE; create/reschedule/cancel атомарны; клиент не задаёт цену/tenant/длительность; идемпотентные повторы; неудачный перенос не теряет исходную | `EXCLUDE USING gist (tenant_id =, resource_id =, during &&)`; SQL-функции; журнал `app.request_ledger` | SQL `concurrency` (параллельные клиенты, 2 ресурса, конкурентные повторы), `reschedule-cancel` (6); Deno «booking body cannot set price, tenant or duration», «retry … same token»; E2E «two people pick the same last slot» |
| 5 | Запись без регистрации; доступ по крипто-токену, в БД только hash; тот же доступ при повторе; владелец через Supabase Auth, tenant по членству на сервере; нет публичной регистрации | Токен = HMAC(`BOOKING_TOKEN_SECRET`, slug + ключ идемпотентности), хранится SHA-256; `owner-api` проверяет JWT и выполняет SQL под ролью `authenticated` с claims | SQL `security`; Deno `owner_api` (6: чужой/поддельный/просроченный токен, 403 чужому владельцу, JWKS); E2E «client books without an account…», «an owner of one studio cannot open another studio cabinet»; unit `OwnerGate.test.tsx` (нет пути регистрации); `config.toml`: `enable_signup = false` |
| 6 | RLS, составные FK, строгие GRANT; anon не видит ПДн/платежи/токены; service-role и LLM-ключ только на сервере; приватный кэш чистится при logout и не попадает в SW | `090600_security.sql`: revoke all + default privileges, RLS на всех таблицах, anon — только `public_*`; SW не перехватывает API | SQL `security` (10); unit и E2E «logout clears private data…» (кэш запросов, чат, сессия, push-подписка владельца на устройстве); E2E «API responses are never cached»; поиск по `dist/` — нет имён серверных секретов |
| 7 | LLM через `LLM_BASE_URL/LLM_API_KEY/LLM_MODEL`; инструмент выполняется до ответа; модель не выбирает SQL и `tenant_id`; клиентские и владельческие инструменты разделены; ограниченный цикл; JSON-intent fallback; роутеры тестируются отдельно | `_shared/assistant/{llm,tools,router}.ts`; строгие Zod-аргументы; `tool_choice=required` для вопросов о данных | Deno `assistant_tools_router` (6, включая «owner stats via AI use the same period and timezone as the UI») и `assistant_json_router` (8: JSON-роутер, переключение `auto`, бюджет, отказ LLM) |
| 8 | Статистика в SQL; раздельно заезды, выполненные заказы, полученные оплаты; будущая стоимость не «выручка»; один период и часовой пояс в UI и AI | `app.owner_stats`, `app.local_period`; общий `resolvePeriod` для UI и AI; в UI «Ожидается (не выручка)» | SQL `money-stats` (4, включая исторические цены и идемпотентные оплаты); Deno «owner status, payment (idempotent) and stats» |
| 9 | На студию: метаданные, manifest id/start_url/scope, icon, maskable, apple-touch-icon, стартовые экраны; раздельные scope и кэши SW; глубокие ссылки → оболочка своей студии | Один `/sw.js`, scope `/s/<slug>/`, кэши `svc-<slug>-…`; `_redirects` с `:slug` | E2E `pwa.spec.ts` (11): deep links обеих студий, метаданные, manifest, изоляция кэшей, офлайн-deep-link, обновление SW |
| 10 | Web Push через VAPID, Cron, outbox с lease/dedupe, учёт переноса/отмены; ICS с честным состоянием UI; без push в обычной вкладке iPhone | `app.notification_jobs`, `claim_notification_jobs` (`FOR UPDATE SKIP LOCKED`); `notify-dispatch`; `090700_cron.sql` | SQL `outbox` (6); Deno `notify_dispatch` (3: шифрование+VAPID, 410 удаляет подписку, 5xx → повтор); unit `ReminderOptIn.test.tsx` (iPhone во вкладке Safari — без кнопки push, preview — без обещаний уведомлений); E2E: без VAPID экран записи предлагает файл календаря |
| 11 | Preview — только помеченные демо-данные, без реальных уведомлений; Live после проверки настроек; повторная публикация сохраняет записи и фото владельца | `is_demo`, задачи preview → `suppressed`; `app.tenant_readiness`, `app.activate_tenant` | SQL `publish-limits`, `outbox` «preview tenants never produce real notifications»; Deno «preview studio: jobs are suppressed»; раздел 5 (отказ Live без владельца, код 1) |
| 12 | Лимиты публичных запросов и бюджет LLM — общие атомарные счётчики в БД; без AI запись работает | `app.usage_hit`; `PUBLIC_LIMITS`, бюджеты `llm:*` | SQL «usage counters are atomic under concurrency»; Deno «rate limited per client…», «without a trusted client IP header…», «LLM budget…», «LLM outage returns 503…»; E2E «without an AI provider…» |

Требования к интерфейсу, проверенные в браузере: пошаговый bottom sheet, по которому
системная «Назад» идёт на шаг назад и затем закрывает его, фокус переходит на заголовок
шага (`e2e/ux.spec.ts`); ошибка сети с работающей кнопкой «Повторить» и пустое состояние
(там же); конфликт слота возвращает к выбору времени. Внешний вид кабинета и клиентского
приложения на ширине телефона просматривался по скриншотам headless Chromium.

## 4. Не проверено (внешние зависимости)

| Что | Почему | Как проверить после деплоя |
|---|---|---|
| Hosted Supabase: `db push`, деплой функций, автоматические секреты функций | нет доступа к проекту | SETUP.md §4, затем `tenant:verify --api …` |
| Вход владельца через Supabase Auth (пароль, magic link с PKCE), выключенная регистрация в Dashboard | нет GoTrue; локально — HS256-сессия из `dev-owner-session.ts` | вход приглашённым владельцем; попытка `signUp` должна вернуть ошибку |
| JWKS реального проекта | проверен только локальный JWKS-ключ в Deno-тесте | любой запрос кабинета после входа |
| Загрузка фото в Storage по подписанной ссылке | нет Storage; код вызывает `createSignedUploadUrl` | «Ещё → Фото» в кабинете |
| pg_cron + pg_net + Vault | расширений нет в локальном PostgreSQL (миграция их пропускает с NOTICE) | SETUP.md §4.5, `select * from cron.job_run_details` |
| Доставка push через FCM/APNs/Mozilla, push на iPhone в установленном приложении | нет браузерных push-сервисов и устройств | включить уведомления в Live-студии, создать запись |
| Реальный вызов LLM | нет ключа провайдера | задать `LLM_*`, спросить про свободное время; проверить оба режима `LLM_ROUTER` |
| Cloudflare Pages: сборка, `_redirects` с `:slug`, `_headers` | нет аккаунта; правила проверены локальным сервером, который их эмулирует | `tenant:verify -- <slug> --url https://…` (проверяет deep link и заголовок `sw.js`) |
| Какой заголовок с IP клиента передаёт шлюз Supabase | зависит от платформы | в логах функций не должно быть `rate limits: no client IP header`; настроить `CLIENT_IP_HEADERS` |
| Установка PWA и standalone-режим на реальных Android/iOS, экранная клавиатура | нет устройств | установить `/s/<slug>/`, проверить иконку, splash, запись с открытой клавиатурой |
| Supabase CLI локально (`supabase start`) | нет Docker | SETUP.md §2.2 |
| Соответствие макетам Figma | доска недоступна | сверка дизайнером |

## 5. Клонирование: ручной прогон

Изолированная копия `tenants/` (`TENANTS_DIR`) и отдельная БД `cs_clone` с засеянными
двумя студиями:

| Шаг | Время |
|---|---|
| `tenant:new volna --from graphite --accent #4EC3F2 --timezone Europe/Kaliningrad` | 1 с |
| правка `business.json` (название, телефон, адрес) + замена `hero.jpg` | скриптом |
| `tenant:validate volna` | 1 с |
| `tenant:publish volna` (preview, версия 1, 7 услуг) | < 1 с |
| `vite build` + `render-site` для трёх студий | 22 с |
| `tenant:verify --dist` для всех трёх студий | 2 с |
| `tenant:publish volna --live` без владельца | отказ «не назначен владелец», код 1 |
| владелец через `dev-owner-session.ts`, затем `--live` | Live включён |

После прогона: `graphite` и `rotorlab` сохранили свои 7 демо-записей, у `volna` статус
`live`. Проверка найденного в процессе: у клона осталось описание исходной студии —
`tenant:validate` теперь об этом предупреждает.

## 6. Решения при несовместимостях версий

Версии: React 19.3, Vite 8.3 (Rolldown), React Router 8.4, TanStack Query 5.104,
TypeScript 6.0, Astryx 0.6.3 (закреплена точно, т. к. 0.x), Base UI 1.8, Tailwind 4.3,
vite-plugin-pwa 1.3 / Workbox 7.4, Vitest 5, Playwright 1.63, Deno 2.9. Всё зафиксировано
в `package-lock.json`.

- **TypeScript 6** объявил `baseUrl` устаревшим — удалён, `paths` работают без него.
- **shadcn Drawer** — одна ветка: Base UI (`@base-ui/react/drawer`, стиль `base-nova`),
  без vaul и без смешения их props; клавиатура — `VirtualKeyboardProvider` и
  `--drawer-keyboard-inset`, плюс `interactive-widget=resizes-content` во viewport.
- **Astryx + Tailwind**: подключены `astryx.css` и официальный Tailwind-мост, порядок
  слоёв `reset, theme, base, astryx-base, astryx-theme, components, utilities`.
  Акцент студии задаётся в рантайме через документированный `defineTheme()` (цвет берётся
  из `business.json`, а не из сборки); в dev это даёт предупреждение Astryx о runtime-теме —
  осознанно, иначе одна сборка не обслужит много студий.
- **React Hooks lint v7** (правила чистоты рендера): `Date.now()` вынесен в хук `useNow`,
  состояние выбора слота выводится из данных без `setState` в эффекте.
- **Vite 8**: многостраничный вход через `build.rolldownOptions.input`; `sourcemap` по
  умолчанию выключен (`BUILD_SOURCEMAP=1` — hidden-карты для трекера ошибок).
- **Доступ функций к данным**: схема `app` не открыта в Data API; функции подключаются к
  Postgres напрямую (`SUPABASE_DB_URL`) и выполняют каждую операцию под `set local role`
  (`anon`/`authenticated`) с `request.jwt.claims`, чтобы RLS и GRANT действовали так же, как
  для PostgREST.
- **LLM**: провайдер-нейтральный OpenAI-совместимый `/chat/completions` — прямо следует
  из требования настраивать `LLM_BASE_URL/LLM_API_KEY/LLM_MODEL`.
- **Картинки**: фото и иконки из `business.json` — статика сборки (webp 800/1600,
  генерация иконок и splash); фото, загруженные владельцем, — Supabase Storage
  и не перезаписываются публикацией конфига.
- **Размер бандла**: Zod убран из браузера (конфиг студии валидируется вручную), чат
  грузится лениво. Начальный JS клиента ≈ 310 КБ gzip; следующий шаг — облегчить
  тему Astryx и кабинет (supabase-js целиком нужен только владельцу).
- **Deno**: `--unsafely-ignore-certificate-errors` ломает загрузку npm-пакетов, поэтому
  `test:functions` сначала делает `deno cache`, затем запускает тесты с этим флагом только
  для локального фейкового push-сервера.

## 7. Запуск для не-разработчика (`npm run demo`, `cloud:*`)

Проверено в этой среде (Linux):

- `npm run demo` с нуля и повторно: встроенный PostgreSQL 17 с локалью `builtin C.UTF-8`
  (`lower('ИВАН Ёж')` → `иван ёж`, поиск по кириллице без учёта регистра работает),
  миграции и seed, функции, сайт. Через браузер: запись клиента → запись в кабинете, вход по
  `/__demo/owner/<slug>`, поиск. Остановка по сигналу гасит базу, Deno и Vite, порты свободны.
- `cloud:prepare` на локальной базе с фиктивным адресом Supabase: понятные сообщения о
  незаполненных и неверных строках `settings.env`; ключи создаются один раз и при повторе
  сохраняются; миграции и публикация студий проходят; Vault, cron и проверки Auth локально
  недоступны и выдаются как предупреждения. VAPID-ключи принимает библиотека `web-push`
  (плюс unit-тест пары ключей).
- `cloud:site`: сборка с ключами из `settings.env` (адрес Supabase попадает и в бандл, и в CSP);
  без входа в Cloudflare — подсказка выполнить `cloud:login`.
- `cloud:functions` без входа в Supabase: подсказка про `cloud:login`, временный файл с секретами
  удаляется и при ошибке.
- `cloud:owner` и `cloud:live`: вопросы (в том числе при вставке всех ответов разом), отказ `live`
  без владельца, успешное включение и повтор. Флаги CLI проверены по `--help`
  (Supabase CLI 2.118.0: `secrets set --env-file`, `functions deploy --use-api`;
  wrangler 4.143.0: `pages project create --production-branch`, `pages deploy --branch --commit-dirty`).

Не проверено: всё, что требует настоящих аккаунтов (вход CLI, `secrets set`, деплой функций и сайта,
Vault и cron на hosted Supabase, Admin API для владельца), а также запуск на macOS и Windows.
Для Windows учтено: npm/npx запускаются через Node без оболочки (пробелы и кириллица в пути),
проверка «скрипт запущен напрямую» через `pathToFileURL`, вопросы вместо флагов после `--`
(PowerShell их теряет), в инструкции — `cmd` вместо PowerShell.

## 8. Известные ограничения

- Один service worker на студию обслуживает и клиентское приложение, и кабинет, поэтому
  у них общая браузерная push-подписка; на сервере это разные строки (`audience` =
  `client`/`owner`). При выходе из кабинета строка владельца для этого устройства
  удаляется (unit `OwnerGate.test.tsx`), а в «Ещё» есть «Отключить на этом устройстве».
  Если выход был без сети, строка остаётся до следующего выхода с сетью на этом
  устройстве или до ответа push-сервиса 404/410.
- Лимиты «на клиента» опираются на заголовок с IP от прокси; без него они пропускаются
  (остаются лимиты на студию и бюджеты LLM) — см. раздел 4.
- `dev-owner-session.ts` — только для локальной БД (проверяет хост) и E2E; в production
  владельцев создаёт `owner:invite`.
