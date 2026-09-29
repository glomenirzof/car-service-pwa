# SETUP — запуск, Supabase, публикация

Одна сборка фронтенда и один проект Supabase обслуживают все студии.
Клиенты открывают `/s/<slug>/`, владелец — `/s/<slug>/owner/`.
Отдельного Node-бэкенда нет: браузер → Edge Functions → SQL-функции в схеме `app`.

```
tenants/<slug>/business.json + images/   вход конвейера (тексты, цены, фото)
        │ tenant:publish                          │ npm run build
        ▼                                         ▼
Supabase Postgres (runtime-данные)        dist/ (общий JS/CSS + оболочки студий)
        ▲                                         │ Cloudflare Pages
Edge Functions: public-api, owner-api,            ▼
assistant, notify-dispatch  ◄──── fetch ──── браузер (PWA, service worker на студию)
```

Все переменные окружения с пояснениями перечислены в [`.env.example`](.env.example).

## 1. Требования

- Node.js ≥ 22.13 и npm (Deno ставится как npm-зависимость, `node_modules/.bin/deno`).
- Локальная БД — один из двух вариантов:
  - PostgreSQL 15+ (`pg_ctl` в PATH или `PG_BIN=/usr/lib/postgresql/16/bin`) — **так проверено**;
  - Supabase CLI + Docker (`supabase start`) — стандартный путь, в среде разработки этого проекта
    Docker был недоступен, поэтому **не проверялся** (см. ACCEPTANCE.md).
- `openssl` — для генерации секретов.

```bash
npm ci
```

## 2. Локальный запуск

### 2.1. Без Docker (проверено)

```bash
npm run db:local        # PostgreSQL на 127.0.0.1:54322, данные в .tmp/pg
npm run db:reset        # шим Supabase (роли, auth.uid()) + все миграции + seed (2 демо-студии)

# секреты локального сервера функций (файл в .gitignore)
cat > supabase/functions/.env <<EOF
SUPABASE_DB_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres
BOOKING_TOKEN_SECRET=$(openssl rand -hex 32)
AUTH_JWT_SECRET=$(openssl rand -hex 32)
AUTH_JWT_ISSUER=http://127.0.0.1:54321/auth/v1
CRON_SECRET=$(openssl rand -hex 16)
EOF
echo "VITE_FUNCTIONS_URL=http://127.0.0.1:54321/functions/v1" > .env.local

npm run functions:serve # терминал 1: те же обработчики, что деплоятся, на :54321
npm run dev             # терминал 2: http://127.0.0.1:5173/s/graphite/ и /s/rotorlab/
```

`functions:serve` — локальная замена `supabase functions serve`: маршрутизирует
`/functions/v1/<name>/…` на `supabase/functions/<name>/handler.ts`.

**Кабинет владельца локально.** Без сервера Supabase Auth вход по паролю недоступен,
поэтому для разработки есть скрипт, который создаёт владельца в локальной БД и
выпускает сессию, подписанную `AUTH_JWT_SECRET` (скрипт отказывается работать с
не-локальной БД):

```bash
set -a; . supabase/functions/.env; set +a
npx tsx scripts/dev-owner-session.ts --slug graphite
# выведет localStorage.setItem("sb-owner-graphite", "…") — вставьте в консоль
# браузера на http://127.0.0.1:5173/s/graphite/owner/ и обновите страницу
```

**Production-сборка локально** (service worker регистрируется только в ней):

```bash
npm run build           # tsc + vite build + оболочки/иконки/manifest всех студий в dist/
npm run preview         # http://127.0.0.1:4173/s/graphite/ с правилами _redirects/_headers
```

### 2.2. С Supabase CLI (стандартный путь, в этой среде не проверялся)

```bash
supabase start                      # Postgres :54322, API :54321, Studio :54323
supabase db reset                   # миграции + supabase/seed.sql
supabase functions serve --env-file supabase/functions/.env
```

В `supabase/functions/.env` тогда нужны только `BOOKING_TOKEN_SECRET` и `CRON_SECRET`
(`SUPABASE_URL`, `SUPABASE_DB_URL`, ключи CLI подставляет сам; JWT владельца проверяется
по JWKS локального Auth). В `.env.local`: `VITE_SUPABASE_URL=http://127.0.0.1:54321` и
`VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key из supabase status>`. Владельца создайте
через `npm run owner:invite` (раздел 6).

## 3. Проверки

```bash
npm run lint && npm run typecheck      # ESLint, tsc (app/node/sw), deno check функций
npm run test                           # unit (jsdom): компоненты, store, форматирование
npm run test:sql                       # 57 интеграционных тестов на реальном PostgreSQL
npm run test:functions                 # Deno-тесты Edge Functions (реальная БД + фейковые LLM/push)
npm run test:e2e                       # Playwright: сам поднимает БД cs_e2e, функции, prod-сборку
npm run test:all
```

`test:sql` и `test:e2e` используют `DATABASE_URL` (по умолчанию локальный :54322) и
создают собственные базы (`cs_t_*`, `cs_e2e`), рабочую базу не трогают.
Playwright ищет Chromium своей версии, иначе `/opt/pw-browsers/chromium`; путь можно
задать `PW_CHROMIUM=/path/to/chrome`.

## 4. Supabase (hosted)

### 4.1. Проект и схема

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push                      # применяет supabase/migrations/*
```

- Схема `app` **не** публикуется через Data API (в `config.toml` только `public`);
  все данные идут через Edge Functions. В Dashboard → API не добавляйте `app` в exposed schemas.
- Миграция `…090800_storage.sql` создаёт публичный бакет `tenant-media` (10 МБ, jpeg/png/webp)
  для фото, которые загружает владелец. Загрузка — только по подписанной ссылке от `owner-api`.
- Демо-seed в production не загружайте: студии публикуются конвейером (раздел 6).

### 4.2. Auth: вход только для приглашённых владельцев

Dashboard → Authentication:

- **Sign In / Providers → Email:** выключить «Allow new users to sign up» (публичной регистрации нет).
- **URL Configuration:** Site URL = `https://<ваш-домен>`; Redirect URLs = `https://<ваш-домен>/s/*/owner/**`
  (magic link возвращает владельца в кабинет его студии).
- Для писем с magic link подключите свой SMTP (встроенный отправитель Supabase сильно ограничен по частоте).

Функции проверяют JWT владельца сами: по умолчанию через JWKS проекта
(`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`, асимметричные ключи подписи).
Если в проекте ещё legacy HS256 — задайте секрет `AUTH_JWT_SECRET` (JWT Secret из настроек API).
Студия владельца определяется только членством в `app.tenant_members` на сервере.

### 4.3. Секреты Edge Functions

`SUPABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY` Supabase передаёт функциям
автоматически. Остальное:

```bash
supabase secrets set \
  BOOKING_TOKEN_SECRET=$(openssl rand -hex 32) \
  CRON_SECRET=<тот же, что в Vault, см. 4.5> \
  ALLOWED_ORIGINS=https://<ваш-домен> \
  VAPID_PUBLIC_KEY=<…> VAPID_PRIVATE_KEY=<…> VAPID_SUBJECT=mailto:ops@<ваш-домен> \
  LLM_BASE_URL=<https://…/v1> LLM_API_KEY=<…> LLM_MODEL=<…> LLM_ROUTER=auto
```

- VAPID-пару сгенерируйте один раз: `npx web-push generate-vapid-keys`. Публичный ключ
  также нужен фронтенду (`VITE_VAPID_PUBLIC_KEY`), приватный — только здесь.
- LLM — любой OpenAI-совместимый `/chat/completions`. Без `LLM_*` ассистент честно отвечает
  «недоступен», запись работает. Режим `LLM_ROUTER=auto` пробует нативные tool calls и при
  отказе провайдера переключается на JSON-интенты; `tools`/`json` фиксируют один режим.
- Бюджеты и лимиты (`LLM_*_DAILY_*`, `RL_*`) — в `.env.example`; счётчики атомарные в БД.
  Лимиты «на клиента» считаются по IP из `CLIENT_IP_HEADERS`. Какой заголовок выставляет
  шлюз Supabase, проверьте после деплоя (в логе функций не должно быть
  `rate limits: no client IP header`); оставьте в списке только заголовки, которые шлюз
  перезаписывает сам.
- **`BOOKING_TOKEN_SECRET` не меняйте без необходимости.** В БД хранятся только SHA-256 хэши
  токенов, поэтому уже выданные ссылки продолжат работать; но повтор незавершённого запроса
  (тот же ключ идемпотентности) после смены секрета получит другой токен, который не подойдёт.
  Меняйте в тихие часы.

### 4.4. Деплой функций

```bash
supabase functions deploy public-api owner-api assistant notify-dispatch
```

`verify_jwt = false` для всех четырёх задан в `supabase/config.toml` намеренно:
`public-api` публичный, `owner-api`/`assistant` сами проверяют токен и членство,
`notify-dispatch` защищён заголовком `x-cron-secret`.

### 4.5. Supabase Cron (напоминания и уведомления)

Миграция `…090700_cron.sql` включает `pg_cron`/`pg_net` и создаёт задания:
`notify-dispatch` (каждую минуту, только если есть готовые задачи в outbox) и
`app-housekeeping` (ночью). URL и секрет задания читают из Vault — выполните один раз
в SQL Editor:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<CRON_SECRET из 4.3>', 'cron_secret');
```

Миграция сама выполняет `create extension` для `pg_cron`/`pg_net`; если в вашем
проекте они недоступны, она пропускает расписание с NOTICE — тогда включите расширения
в Dashboard → Database → Extensions и выполните содержимое файла в SQL Editor
(`db push` уже применённую миграцию не перезапускает). Проверка: `select jobname, schedule from cron.job;` и
`select status, count(*) from app.notification_jobs group by 1;`.

## 5. Фронтенд: Cloudflare Pages

Вариант A — Git-интеграция: Framework preset **None**, Build command `npm run build`,
Output `dist`, переменные окружения сборки:

```
NODE_VERSION=22
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
VITE_VAPID_PUBLIC_KEY=<VAPID public key>
```

Вариант B — прямой деплой: `npm run build && npx wrangler pages deploy dist --project-name <name>`.

Сборка сама генерирует:

- `dist/s/<slug>/index.html` и `dist/s/<slug>/owner/index.html` — оболочки со своими
  title/описанием/manifest/иконками/стартовыми экранами iOS для каждой студии;
- `dist/t/<slug>/` — иконки (any + maskable), apple-touch-icon, 15 splash, webp-фото, manifest'ы;
- `dist/_redirects` — глубокие ссылки `/s/:slug/*` и `/s/:slug/owner/*` отдают оболочку своей студии;
- `dist/_headers` — CSP (`connect-src` берётся из тех же `VITE_*`), `Service-Worker-Allowed: /s/`.

Один `sw.js` регистрируется на каждую студию со scope `/s/<slug>/`; кэши называются
`svc-<slug>-…`, ответы API не кэшируются никогда.

После деплоя: `npm run tenant:verify -- <slug> --url https://<ваш-домен> --api https://<project-ref>.supabase.co/functions/v1`.

## 6. Публикация студии и владелец

Коротко (подробно — [CLONE-IN-6-MINUTES.md](CLONE-IN-6-MINUTES.md)):

```bash
npm run tenant:new -- <slug> --name "Название" --from graphite   # или из шаблона
# правите tenants/<slug>/business.json и images/
npm run tenant:validate -- <slug>
DATABASE_URL=<prod> npm run tenant:publish -- <slug>              # preview
git commit && деплой фронтенда                                    # статика студии
DATABASE_URL=<prod> SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  npm run owner:invite -- --tenant <slug> --email owner@example.com
DATABASE_URL=<prod> npm run tenant:publish -- <slug> --live       # после проверки
npm run tenant:verify -- <slug> --url … --api …
```

- **Preview:** только демо-данные с пометкой, уведомления не отправляются.
- **Live:** включается только если есть владелец, рабочие часы, телефон, адрес и хотя бы
  одна услуга с подходящим ресурсом; при включении демо-записи удаляются.
- Повторная публикация сохраняет записи, клиентов, оплаты, фото владельца, его исключения
  в графике и паузы услуг; цены существующих записей не меняются (исторический снимок).
- Новая студия никогда не заменяет прежние: сборка рендерит все папки `tenants/*`,
  публикация в БД меняет только свою студию.

`owner:invite` — единственный способ дать доступ к кабинету (Admin API, ключ только на сервере).
С `--password` создаёт пароль; без него владелец входит по magic link.

## 7. Эксплуатация

- Очередь уведомлений: `app.notification_jobs` (`pending/processing/sent/failed/cancelled/suppressed/skipped`),
  аренда задач с `lease_until`; «зависшие» задачи перехватываются по истечении аренды.
- Лимиты и бюджеты: `app.usage_counters` (корзины `pub:*`, `owner:*`, `llm:*`), чистятся housekeeping.
- Логи функций: Dashboard → Edge Functions → Logs. Туда попадают ошибки и отказы
  инструментов ассистента; тексты переписки и ответы LLM не логируются. Ошибка отправки
  push сохраняется в `app.notification_jobs.last_error`.
- iPhone: Web Push работает только у установленного на экран «Домой» приложения
  (iOS 16.4+); в обычной вкладке Safari интерфейс предлагает установить приложение или
  скачать .ics — push там не обещается.
