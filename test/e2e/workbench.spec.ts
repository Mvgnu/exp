import { expect, test } from '@playwright/test';

test('follows an audit finding through exact source evidence and a deep-link reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?view=audit');
  await page.locator('.audit-row').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const quote = await page.locator('.evidence-card blockquote').first().innerText();
  expect(quote.length).toBeGreaterThan(3);
  await page.locator('.evidence-card summary').first().click();
  await page.getByRole('button', { name: 'Open source', exact: true }).first().click();
  await expect(page.locator('.segment-card mark').first()).toBeVisible();
  await page.reload();
  await expect(page.locator('.segment-card mark').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close detail' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('keeps published explorer filters and scopes after reload', async ({ page }) => {
  await page.goto('/?view=explore');
  await page.getByLabel('Project', { exact: true }).selectOption('project_curricula');
  await page.getByRole('searchbox', { name: 'Search current view' }).fill('Foundations');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('tbody')).toContainText('2025');
  await expect(page.locator('tbody')).toContainText('2026');
  await page.reload();
  await expect(page.getByLabel('Project', { exact: true })).toHaveValue('project_curricula');
  await expect(page.getByRole('searchbox')).toHaveValue('Foundations');
  await expect(page.locator('tbody tr')).toHaveCount(2);
});

test('shows exact schema changes while keeping demo mutations honest', async ({ page }) => {
  await page.goto('/?view=schemas&project=project_procurement');
  await page.getByLabel('Proposal status').selectOption('pending');
  await page.getByRole('button', { name: 'Review diff' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.field-diff')).not.toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Approve & replay' })).toBeDisabled();
  await page.getByRole('button', { name: 'Close detail' }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create project', exact: true })).toBeDisabled();
});

test('connects to the real API and creates persisted operator state', async ({
  page,
  request,
}, testInfo) => {
  const token = 'browser-test-operator-token-not-a-deployment-secret';
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect your data', exact: true }).click();
  await page.getByLabel('API URL', { exact: true }).fill('http://127.0.0.1:4311');
  await page.getByLabel('Operator token').fill(token);
  await page.getByRole('button', { name: 'Connect workspace', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'New project', exact: true }).first().click();
  const name = `Browser-created ${testInfo.project.name} ${Date.now()}`;
  await page.getByLabel('Project name', { exact: true }).fill(name);
  await page
    .getByLabel('Topic and scope', { exact: true })
    .fill('Public engineering test documents');
  await page
    .getByLabel('Questions to answer')
    .fill('Which explicitly documented constraints apply?');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const response = await request.get('http://127.0.0.1:4311/api/projects', {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(200);
  const projects: Array<{ name: string; mode: string }> = await response.json();
  expect(projects.find((project) => project.name === name)?.mode).toBe('live');
  const restoredSnapshot = page.waitForResponse(
    (response) =>
      response.url() === 'http://127.0.0.1:4311/api/snapshot' &&
      response.request().method() === 'GET',
  );
  await page.reload();
  expect((await restoredSnapshot).status()).toBe(200);
  await expect(page.getByLabel('Project', { exact: true })).toContainText(name);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});
