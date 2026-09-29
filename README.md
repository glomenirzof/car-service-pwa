# car-service-pwa

PWA онлайн-записи для автосервисов и детейлинг-студий. Одна сборка и один проект
Supabase обслуживают любое число студий; новая студия — это `tenants/<slug>/business.json`
и картинки, прежние студии при этом не затрагиваются.

- Клиент: `/s/<slug>/` — услуги, свободное время, запись без регистрации в пошаговом
  bottom sheet, «Мои записи» с переносом и отменой по ссылке-токену, напоминания
  (Web Push или .ics), AI-помощник по услугам и времени.
- Владелец: `/s/<slug>/owner/` — вход через Supabase Auth по приглашению, расписание по
  постам, запись/блокировка/перенос, статусы и оплаты, статистика в часовом поясе студии,
  AI-помощник по данным кабинета, фото, исключения в графике, push о новых записях.

## Стек

React 19, TypeScript (strict), Vite 8, React Router, TanStack Query, Astryx +
shadcn Drawer (Base UI), Tailwind v4 через мост Astryx, vite-plugin-pwa (injectManifest,
Workbox), Supabase Postgres/Auth/Storage/Edge Functions (Deno), Cloudflare Pages.

## Структура

```
src/client, src/owner      два приложения (общие компоненты в src/components, src/shared)
src/sw/sw.ts               service worker (scope и кэши на студию)
supabase/migrations        схема app: RLS, EXCLUDE-занятость, атомарные SQL-операции, cron
supabase/functions         public-api, owner-api, assistant, notify-dispatch + _shared
scripts/tenant             tenant:new | validate | publish | verify, owner:invite, сборка оболочек
tenants/                   graphite, rotorlab — демо-студии; _template — шаблон
tests/sql, e2e             интеграционные тесты на PostgreSQL и Playwright
```

## Быстрый старт

```bash
npm ci
npm run db:local && npm run db:reset     # PostgreSQL :54322 + миграции + две демо-студии
# supabase/functions/.env и .env.local — см. SETUP.md §2.1
npm run functions:serve                  # терминал 1
npm run dev                              # терминал 2 → http://127.0.0.1:5173/s/graphite/
```

## Документы

- [SETUP.md](SETUP.md) — локальный запуск, Supabase (секреты, Auth, Cron), Cloudflare Pages.
- [CLONE-IN-6-MINUTES.md](CLONE-IN-6-MINUTES.md) — как запустить новую студию.
- [ACCEPTANCE.md](ACCEPTANCE.md) — что проверено, чем, и что зависит от внешних сервисов.
- [.env.example](.env.example) — все переменные, без секретов.
