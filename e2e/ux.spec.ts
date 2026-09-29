// Interaction contracts that screenshots cannot prove: the system Back button
// walks the booking sheet step by step, and network screens have real
// loading / error (with retry) / empty states.
import {expect, test} from '@playwright/test';
import {FUNCTIONS_URL} from './support/env.ts';
import {tenant} from './support/tenants.ts';

const SLUG = 'rotorlab';
const studio = tenant(SLUG);
const service = studio.services.find((s) => s.completion !== 'multi_day')!;

test('system Back walks the booking sheet one step at a time, then closes it', async ({page}) => {
  await page.goto(`/s/${SLUG}/services`);
  await page.getByTestId(`service-row-${service.key}`).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('Шаг 2 из 4');
  await sheet.locator('[data-testid="slot-days"] button:not([disabled])').first().click();
  await sheet.locator('[data-testid="slot-times"] button').first().click();
  await sheet.getByRole('button', {name: /^Далее · /}).click();
  await expect(sheet.getByLabel('Имя')).toBeVisible();
  // Focus moves to the new step's title, so screen readers announce the step.
  await expect(sheet.locator(':focus')).toContainText('Шаг 3 из 4');

  await page.goBack();
  await expect(sheet).toContainText('Шаг 2 из 4');
  await expect(sheet.locator(':focus')).toContainText('Шаг 2 из 4');
  // The chosen time survives going back (it lives in the URL).
  await expect(sheet.getByRole('button', {name: /^Далее · \d{2}:\d{2}$/})).toBeEnabled();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/s/${SLUG}/services$`));
});

test('the sheet close button returns to the page the sheet was opened from', async ({page}) => {
  await page.goto(`/s/${SLUG}/`);
  await page.getByRole('button', {name: 'Записаться'}).first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByText(service.name, {exact: true}).click();
  await expect(sheet).toContainText('Шаг 2 из 4');
  await sheet.getByRole('button', {name: 'Закрыть'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/s/${SLUG}/$`));
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('network failure shows an error with a working retry; empty list has its own state', async ({page}) => {
  let fail = true;
  await page.route(`${FUNCTIONS_URL}/public-api/tenant/${SLUG}`, (route) => (fail ? route.abort('internetdisconnected') : route.continue()));
  await page.goto(`/s/${SLUG}/`);
  const error = page.locator('[data-state="error"]');
  await expect(error).toContainText('Студия недоступна');
  await expect(error).toContainText('Нет соединения');
  fail = false;
  await error.getByRole('button', {name: 'Повторить'}).click();
  await expect(page.getByRole('heading', {level: 1}).first()).toContainText(studio.name.split(' ')[0]!);

  await page.goto(`/s/${SLUG}/bookings`);
  await expect(page.locator('[data-state="empty"]')).toContainText('Здесь появятся ваши записи');
});
