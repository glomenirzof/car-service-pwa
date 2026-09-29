# CLAUDE

Project-specific guidance for AI coding agents.

## Project

Multi-tenant PWA for online booking at car services and detailing studios.
One shared JS/CSS build, one Supabase project; every studio lives at
`/s/<slug>/` (clients) and `/s/<slug>/owner/` (owner cabinet).

- `tenants/<slug>/business.json` + `images/` — pipeline input (the only place
  business names/texts live, plus `supabase/seed.sql`). Never hardcode a studio
  in `src/` (ESLint rule `no-restricted-syntax` enforces the demo names).
- `supabase/migrations/` — schema `app`: every tenant table has `tenant_id` and
  composite `(tenant_id, id)` FKs; bookings and blocks share
  `app.resource_occupancies` with an `EXCLUDE` constraint.
- `supabase/functions/` — Deno Edge Functions: `public-api`, `owner-api`,
  `assistant`, `notify-dispatch`; shared isomorphic code in `_shared/`.
- `scripts/tenant/` — `tenant:new|validate|assets|publish|verify`, seed generator.
- `src/client`, `src/owner` — the two apps; `src/sw/sw.ts` — service worker.

## Commands

    npm run db:local        # local PostgreSQL on :54322 when Docker/Supabase CLI is unavailable
    npm run test            # unit (jsdom)
    npm run test:sql        # SQL/integration tests on a real PostgreSQL (DATABASE_URL)
    npm run test:functions  # Deno tests for Edge Functions
    npm run test:e2e        # Playwright
    npm run lint && npm run typecheck && npm run build

## Rules

- The browser never sends tenant_id, price or duration; the server derives them.
- Booking mutations go through SQL functions in one transaction; never do
  read-then-write availability checks in TypeScript.
- Owner endpoints verify the Supabase JWT and run as role `authenticated` with
  claims set, so RLS applies; public endpoints run as `anon`.
- Booking tokens: only SHA-256 hashes are stored.
- Service worker must never cache API responses or owner data.

## Styling (overrides the generic Astryx note below)

This project DOES have a Tailwind v4 compiler, wired through the Astryx
Tailwind bridge (`@astryxdesign/core/tailwind-theme.css`) with the layer order
declared in `src/styles/globals.css`. shadcn components (currently only
`src/components/ui/drawer.tsx`, Base UI branch, no vaul) use bridge utility
names — `bg-popover`, `bg-surface`, `text-primary`, `text-secondary`,
`border-border`, `bg-accent-bg`, `text-on-accent` — never shadcn's
`--primary/--background` variables and never raw hex. There is no StyleX
compiler, so do not use `xstyle`. Accent color comes from business.json via
`defineTheme()` in `src/app/theme.ts`.

<!-- ASTRYX:START -->
Astryx v0.6.3 · 164 components
CLI: run every command as `npx astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in your app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — discover, don't guess. Before writing UI:
1. `astryx build "<idea>"` — START HERE: returns a kit (closest [page] + [block]s + [component]s). No args = full playbook.
2. `astryx template <name> [--skeleton]` — scaffold the [page]/[block]s it named, or study their layout. Templates are reference code.
3. `astryx component <Name>` — props + examples for every component you use.

RULES:
- No <div> — components do all layout/spacing, page frame included.
- Frame first: read `astryx docs layout` before writing any page or screen — page frame, region widths, breakpoint behavior.
- Dense data = rows (Table, List/Item), never Card-wrapped list items; Card is for standalone widgets. Status = StatusDot/Token; Badge = counts only.
- Custom styling: component props first; else style/className with tokens — var(--color-*|--spacing-*|--radius-*). No raw hex/px. (No StyleX/Tailwind compiler here — don't use xstyle/utility classes.)
- Tokens for every value (`astryx docs tokens`). Brand/accent belongs in the theme (`astryx theme list` / `theme add <slug>`, or `astryx theme template` for a custom one) — never override --color-* in :root.
- SELF-CHECK before you finish: re-read the file and replace any raw <div>/<span> layout, imported .css/@apply, or hardcoded value (#hex, 16px) with the component or a token (var(--color-*|--spacing-*|…)). If unsure a component/prop exists, run `astryx component <Name>` / `astryx search "<thing>"`; don't hand-roll CSS.

MORE CLI:
  search "<query>"   find any component / hook / doc / template / block
  component --list   164 components by category
  template --list    page + block recipes
  docs <topic>       browser-support, cli-integrations, color, elevation, getting-started, icons, illustrations, internationalization, layout, migration, motion, principles, shape, spacing, styling-libraries, styling, theme, tokens, typography, working-with-ai
  swizzle <Name>     eject component source for deep customization
  upgrade --apply    run after any Astryx or integration dependency bump
<!-- ASTRYX:END -->
