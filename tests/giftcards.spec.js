// Playwright test for giftcards-wasm extension
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5000';
const USERNAME = 'testuser';
const PASSWORD = 'testpass123';
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'screenshots');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function getAccessToken(request) {
  const res = await request.post(BASE_URL + '/api/v1/auth', {
    headers: { 'Content-Type': 'application/json' },
    data: { username: USERNAME, password: PASSWORD },
  });
  const data = await res.json();
  return data.access_token;
}

async function loginAndGoto(page, url) {
  // Login via page.request so cookies are shared with the page context
  const res = await page.request.post(BASE_URL + '/api/v1/auth', {
    headers: { 'Content-Type': 'application/json' },
    data: { username: USERNAME, password: PASSWORD },
  });
  const data = await res.json();
  const token = data.access_token;

  // Set the cookie that LNbits expects
  await page.context().addCookies([{
    name: 'cookie_access_token',
    value: token,
    domain: 'localhost',
    path: '/',
  }, {
    name: 'is_lnbits_user_authorized',
    value: 'true',
    domain: 'localhost',
    path: '/',
  }]);

  // Navigate to the base URL first to initialize the app
  await page.goto(BASE_URL + '/');
  await page.waitForTimeout(2000);

  // Now navigate to the target URL
  await page.goto(url);
  await page.waitForTimeout(5000);
  await page.waitForLoadState('networkidle');
}

test('login and navigate to gift cards', async ({ page, request }) => {
  await loginAndGoto(page, BASE_URL + '/ext/giftcards');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-giftcards-page.png'), fullPage: true });
});

test('create a gift card', async ({ page }) => {
  await loginAndGoto(page, BASE_URL + '/ext/giftcards');

  // Wait for the extension iframe to load
  await page.waitForTimeout(5000);
  let extFrame = page.frames().find(f => f.url().includes('ext-frame'));
  if (!extFrame) {
    await page.waitForTimeout(5000);
    extFrame = page.frames().find(f => f.url().includes('ext-frame'));
  }
  expect(extFrame).toBeTruthy();

  // Dismiss any LNbits dialogs/backdrops that might be overlaying
  await page.evaluate(() => {
    document.querySelectorAll('.q-dialog__backdrop, .q-dialog').forEach(el => el.remove());
    document.querySelectorAll('.q-dialog').forEach(el => el.remove());
  });
  await page.waitForTimeout(500);

  // Wait for the create button to be available
  await extFrame.waitForSelector('#btn-create', { timeout: 15000 });

  // Click create button
  await extFrame.click('#btn-create');
  await page.waitForTimeout(500);

  // Fill form
  await extFrame.fill('#create-amount', '1000');
  await extFrame.fill('#create-recipient-name', 'Alice');
  await extFrame.fill('#create-sender-name', 'Bob');
  await extFrame.fill('#create-message', 'Happy birthday! Enjoy some sats.');

  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-create-dialog.png'), fullPage: true });

  // Select bitcoin template
  await extFrame.click('.template-preview[data-template="bitcoin"]');
  await page.waitForTimeout(200);

  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-create-dialog-template.png'), fullPage: true });

  // Submit
  await extFrame.click('#btn-create-confirm');
  await page.waitForTimeout(5000);

  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-card-created.png'), fullPage: true });
});

test('view gift card list', async ({ page, request }) => {
  await loginAndGoto(page, BASE_URL + '/ext/giftcards');
  await page.waitForTimeout(3000);

  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '05-card-list.png'), fullPage: true });
});

test('delete a gift card', async ({ page }) => {
  await loginAndGoto(page, BASE_URL + '/ext/giftcards');
  await page.waitForTimeout(5000);

  const extFrame = page.frames().find(f => f.url().includes('ext-frame'));
  if (!extFrame) return;

  // Dismiss any LNbits dialogs/backdrops
  await page.evaluate(() => {
    document.querySelectorAll('.q-dialog__backdrop, .q-dialog').forEach(el => el.remove());
  });
  await page.waitForTimeout(500);

  // Click the first delete button
  const deleteBtn = await extFrame.$('button[data-action="delete"]').catch(() => null);
  if (!deleteBtn) return;

  await deleteBtn.click();
  await page.waitForTimeout(500);

  // Screenshot the confirm dialog
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '09-delete-confirm.png'), fullPage: true });

  // Click confirm
  await extFrame.click('#btn-confirm-ok');
  await page.waitForTimeout(3000);

  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '10-card-deleted.png'), fullPage: true });
});

test('view gift card detail with QR', async ({ page }) => {
  await loginAndGoto(page, BASE_URL + '/ext/giftcards');
  await page.waitForTimeout(5000);

  const extFrame = page.frames().find(f => f.url().includes('ext-frame'));
  if (!extFrame) return;

  // Dismiss any LNbits dialogs/backdrops
  await page.evaluate(() => {
    document.querySelectorAll('.q-dialog__backdrop, .q-dialog').forEach(el => el.remove());
  });
  await page.waitForTimeout(500);

  const viewBtn = await extFrame.$('button[data-action="view"]').catch(() => null);
  if (viewBtn) {
    await viewBtn.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '06-card-detail-qr.png'), fullPage: true });
  }
});

test('redeem page', async ({ page, request }) => {
  const token = await getAccessToken(request);
  const cardRes = await request.post(BASE_URL + '/api/v1/ext/giftcards/cards', {
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: { amount: 500, recipientName: 'Charlie', senderName: 'Dave', message: 'Test redeem card' },
  });
  const card = await cardRes.json();
  const rawToken = card.rawToken || card.tokenHash;

  // Navigate to redeem page (public, no auth needed)
  await page.goto(BASE_URL + '/ext/giftcards/redeem/' + rawToken);
  await page.waitForTimeout(5000);

  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '07-redeem-page.png'), fullPage: true });
});

test('claim page', async ({ page }) => {
  await page.goto(BASE_URL + '/ext/giftcards/claim');
  await page.waitForTimeout(5000);

  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '08-claim-page.png'), fullPage: true });
});
