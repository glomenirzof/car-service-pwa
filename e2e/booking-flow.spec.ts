// Stage 8: the main path end to end on a phone viewport, against the real
// function handlers and PostgreSQL — service -> time -> contacts -> confirm ->
// booking page, then the same booking in the owner's cabinet.
import {expect, test, type Page} from '@playwright/test';
import {tenant} from './support/tenants.ts';
import {signInOwner} from './support/owner.ts';

const SLUG = 'graphite';
const studio = tenant(SLUG);
const sameDay = studio.services.find((s) => s.completion !== 'multi_day')!;

type Saved = {bookingId: string; startAt: string; token: string};

async function pickFirstSlot(page: Page) {
  const sheet = page.getByRole('dialog');
  const day = sheet.locator('[data-testid="slot-days"] button:not([disabled])').first();
  await expect(day).toBeVisible();
  await day.click();
  const slot = sheet.locator('[data-testid="slot-times"] button').first();
  await expect(slot).toBeVisible();
  await slot.click();
  await sheet.getByRole('button', {name: /^Далее · \d{2}:\d{2}$/}).click();
}

async function fillContacts(page: Page, name: string, phone: string) {
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Имя').fill(name);
  await sheet.getByLabel('Телефон').fill(phone);
  await sheet.getByLabel('Автомобиль').fill('Škoda Octavia');
  await sheet.getByRole('button', {name: 'Далее'}).click();
  await sheet.getByLabel(/Согласен на обработку/).check();
}

async function savedBookings(page: Page): Promise<Saved[]> {
  return page.evaluate((slug) => JSON.parse(localStorage.getItem(`bookings:${slug}`) ?? '[]'), SLUG);
}

function studioDate(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(iso));
}

test('client books without an account; the booking shows up in the owner cabinet', async ({page}) => {
  const customer = `E2E Клиент ${Date.now().toString(36)}`;

  await page.goto(`/s/${SLUG}/`);
  await page.getByRole('button', {name: 'Записаться'}).first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await sheet.getByText(sameDay.name, {exact: true}).click();

  await pickFirstSlot(page);
  await fillContacts(page, customer, '8 (999) 123-45-67');
  await expect(sheet.getByText(sameDay.name).first()).toBeVisible();
  await sheet.getByRole('button', {name: 'Записаться'}).click();

  const done = page.getByTestId('booking-done');
  await expect(done).toBeVisible();
  await expect(done).toContainText(sameDay.name);
  await expect(done).toContainText('Перенести или отменить запись онлайн можно до');
  // Honest reminder state: push is not configured on this stack, the calendar file is.
  await expect(sheet.getByRole('button', {name: /календар/i})).toBeVisible();

  await sheet.getByRole('button', {name: 'Открыть запись'}).click();
  await expect(page).toHaveURL(new RegExp(`/s/${SLUG}/bookings/[0-9a-f-]{36}$`));
  await expect(page.getByText('Запланирована')).toBeVisible();
  const [saved] = await savedBookings(page);
  expect(saved?.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  expect(page.url()).toContain(saved!.bookingId);

  // --- owner cabinet -------------------------------------------------------
  await signInOwner(page, SLUG);
  const day = studioDate(saved!.startAt, 'Europe/Moscow');
  await page.goto(`/s/${SLUG}/owner/?date=${day}`);
  const row = page.getByTestId('owner-booking-row').filter({hasText: customer});
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(sameDay.name);
  await row.click();

  await expect(page).toHaveURL(new RegExp(`/s/${SLUG}/owner/bookings/${saved!.bookingId}$`));
  await expect(page.getByText(customer)).toBeVisible();
  await expect(page.getByText('+7 999 123-45-67')).toBeVisible();
  await page.getByRole('button', {name: 'Приехал'}).click();
  await expect(page.getByText('Автомобиль на месте').first()).toBeVisible();

  // The client's own page reflects the studio's update.
  await page.goto(`/s/${SLUG}/bookings/${saved!.bookingId}`);
  await expect(page.getByText('Автомобиль на месте')).toBeVisible();
});

test('two people pick the same last slot: one gets it, the other is sent back to choose again', async ({browser}) => {
  // A service only one resource can do, so the slot really runs out.
  const single = studio.services.find((s) => studio.resources.filter((r) => r.capabilities.includes(s.capability)).length === 1);
  if (!single) throw new Error(`${SLUG} needs a service only one resource can do`);

  const [a, b] = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const pages = await Promise.all([a.newPage(), b.newPage()]);
    for (const [i, p] of pages.entries()) {
      await p.goto(`/s/${SLUG}/services`);
      await p.getByTestId(`service-row-${single.key}`).click();
      await pickFirstSlot(p);
      await fillContacts(p, `E2E Гонка ${i}`, `8 999 000-00-0${i}`);
    }
    const [first, second] = pages as [Page, Page];
    await first.getByRole('dialog').getByRole('button', {name: 'Записаться'}).click();
    await expect(first.getByTestId('booking-done')).toBeVisible();

    await second.getByRole('dialog').getByRole('button', {name: 'Записаться'}).click();
    const banner = second.getByRole('alert').filter({hasText: 'Это время только что заняли'});
    await expect(banner).toContainText('ничего не списали и не создали');
    await banner.getByRole('button', {name: 'Выбрать время'}).click();
    await expect(second.locator('[data-testid="slot-days"]')).toBeVisible();
    expect(await savedBookings(second)).toHaveLength(0);
  } finally {
    await a.close();
    await b.close();
  }
});

test('an owner of one studio cannot open another studio cabinet', async ({page}) => {
  await signInOwner(page, SLUG, 'only-graphite@e2e.test');
  await page.goto('/s/rotorlab/owner/');
  // The session is stored per studio, so the other cabinet starts at its login.
  await expect(page.getByRole('heading', {name: 'Кабинет'})).toBeVisible();
  // Even with the same token copied over, the server refuses: no membership.
  await page.evaluate(() => localStorage.setItem('sb-owner-rotorlab', localStorage.getItem('sb-owner-graphite')!));
  await page.reload();
  await expect(page.getByText('Нет доступа к этой студии')).toBeVisible();
});

test('logout clears private data; no owner data ever lands in worker caches', async ({page}) => {
  await signInOwner(page, SLUG);
  await page.goto(`/s/${SLUG}/owner/`);
  await expect(page.getByTestId('schedule-date')).toBeVisible();
  await page.goto(`/s/${SLUG}/owner/stats`);
  await expect(page.getByTestId('kpi-visits')).toBeVisible();
  await page.goto(`/s/${SLUG}/owner/more`);
  await page.getByRole('button', {name: 'Выйти'}).click();
  await expect(page.getByRole('heading', {name: 'Кабинет'})).toBeVisible();

  const leftovers = await page.evaluate(async (slug) => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) urls.push(r.url);
    return {session: localStorage.getItem(`sb-owner-${slug}`), chat: sessionStorage.getItem(`owner-chat:${slug}`), urls};
  }, SLUG);
  expect(leftovers.session).toBeNull();
  expect(leftovers.chat).toBeNull();
  expect(leftovers.urls.filter((u) => u.includes('/functions/v1/'))).toEqual([]);
});

test('without an AI provider the assistant says so and booking still works', async ({page}) => {
  await page.goto(`/s/${SLUG}/assistant`);
  const input = page.getByRole('textbox').last();
  await input.fill('Когда завтра свободно на мойку?');
  await input.press('Enter');
  await expect(page.getByText(/это работает всегда/)).toBeVisible();
  await page.getByRole('button', {name: 'Открыть каталог'}).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByText(sameDay.name, {exact: true}).click();
  await expect(sheet.locator('[data-testid="slot-days"]')).toBeVisible();
});
