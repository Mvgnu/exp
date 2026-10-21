import { expect, test } from '@playwright/test';

const catalog = 'http://127.0.0.1:4174';

test('narrows a scoped catalog, survives reload, and reveals the cited value', async ({
  page,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(catalog);
  await page.getByRole('button', { name: /Computer science curricula/ }).click();
  if (isMobile) await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByLabel('Institution', { exact: true }).selectOption('Northbridge University');
  await page.getByLabel('Numeric constraint').selectOption('credits');
  await page.getByLabel('Minimum value').fill('6');
  await page.getByRole('searchbox', { name: 'Search catalog' }).fill('Foundations');
  await expect(page.locator('.record-card')).toHaveCount(1);
  await expect(page.locator('.record-card')).toContainText('curriculum 2026');
  expect(new URL(page.url()).searchParams.get('min')).toBe('6');
  await page.reload();
  await expect(page.getByRole('searchbox')).toHaveValue('Foundations');
  await expect(page.locator('.record-card')).toHaveCount(1);
  await page.getByRole('link', { name: 'Foundations of Computing', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Foundations of Computing');
  const credits = page
    .locator('.fact-row')
    .filter({ has: page.getByRole('heading', { name: 'Credits', exact: true }) });
  await expect(credits).toContainText('6');
  await credits.locator('summary').click();
  await expect(credits.locator('blockquote')).toBeVisible();
  await expect(credits).toContainText('Synthetic fixture');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('keeps conflicting alternatives visible with both source passages', async ({ page }) => {
  await page.goto(catalog);
  await page.getByRole('button', { name: /Municipal procurement/ }).click();
  await page.getByRole('link', { name: 'Municipal cloud infrastructure', exact: true }).click();
  const disagreement = page
    .locator('.fact-row')
    .filter({ hasText: 'No single value has been selected.' });
  await expect(disagreement).toHaveCount(1);
  await expect(disagreement.locator('.alternatives')).not.toHaveText('');
  await disagreement.locator('summary').click();
  await expect(disagreement.locator('blockquote')).toHaveCount(2);
  const passages = await disagreement.locator('blockquote').allTextContents();
  expect(new Set(passages).size).toBe(2);
});

test('explains empty results and restores the published collection', async ({ page }) => {
  await page.goto(catalog);
  await page.getByRole('searchbox').fill('nothing-matches-this-query-4738');
  await expect(
    page.getByRole('heading', { name: 'No records fit these constraints.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear all filters' }).click();
  await expect(page.locator('.record-card')).toHaveCount(17);
  expect(new URL(page.url()).search).toBe('');
});

test('has usable static detail pages without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(catalog);
  await page.getByRole('link', { name: 'Applied Data Science', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Applied Data Science');
  await page.locator('.fact-row summary').first().click();
  await expect(page.locator('.fact-row blockquote').first()).toBeVisible();
  await context.close();
});
