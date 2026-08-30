// Playwright test for giftcardswasm extension
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

// Helper: find the extension iframe
async function getExtFrame(page) {
  await page.waitForTimeout(5000);
  let extFrame = page.frames().find(f => f.url().includes('ext-frame'));
  if (!extFrame) {
    await page.waitForTimeout(5000);
    extFrame = page.frames().find(f => f.url().includes('ext-frame'));
  }
  return extFrame;
}

// Helper: dismiss any LNbits dialogs/backdrops that might overlay the iframe
async function dismissDialogs(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.q-dialog__backdrop, .q-dialog').forEach(el => el.remove());
  });
  await page.waitForTimeout(500);
}

// Helper: fill a Quasar q-input by its label text
async function fillQInput(frame, labelText, value) {
  // Quasar wraps inputs in .q-field with a label. Find the input inside.
  const field = await frame.$(`.q-field:has(.q-field__label:has-text("${labelText}")) input`);
  if (field) {
    await field.fill(value);
  } else {
    // Fallback: try textarea
    const textarea = await frame.$(`.q-field:has(.q-field__label:has-text("${labelText}")) textarea`);
    if (textarea) {
      await textarea.fill(value);
    }
  }
}

// Helper: select an option in a Quasar q-select by label
async function selectQOption(frame, labelText, optionText) {
  // Click the select to open the dropdown
  const select = await frame.$(`.q-field:has(.q-field__label:has-text("${labelText}"))`);
  if (select) {
    await select.click();
    await frame.waitForTimeout(500);
    // Click the option in the dropdown menu
    const option = await frame.$(`.q-menu .q-item:has-text("${optionText}")`);
    if (option) {
      await option.click();
      await frame.waitForTimeout(300);
    }
  }
}

// Helper: click a q-btn by its label text
async function clickQBtn(frame, labelText) {
  const btn = await frame.$(`.q-btn:has(.q-btn__content:has-text("${labelText}"))`);
  if (btn) {
    await btn.click();
  }
}

test('login and navigate to gift cards', async ({ page, request }) => {
  await loginAndGoto(page, BASE_URL + '/ext/giftcardswasm');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-giftcards-page.png'), fullPage: true });
});

test('create a gift card', async ({ page }) => {
  await loginAndGoto(page, BASE_URL + '/ext/giftcardswasm');

  const extFrame = await getExtFrame(page);
  expect(extFrame).toBeTruthy();
  await dismissDialogs(page);

  // Wait for the Vue app to mount and the create button to appear
  await extFrame.waitForSelector('.q-btn:has-text("Create Gift Card")', { timeout: 15000 });

  // Click the first "Create Gift Card" button (in the header, not the dialog submit)
  await extFrame.locator('.q-btn:has-text("Create Gift Card")').first().click();
  await page.waitForTimeout(1000);

  // Fill the create form
  await fillQInput(extFrame, 'Amount (sats)', '1000');
  await fillQInput(extFrame, 'Recipient Name', 'Alice');
  await fillQInput(extFrame, 'Your Name', 'Bob');
  await fillQInput(extFrame, 'Personal Message', 'Happy birthday! Enjoy some sats.');

  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-create-dialog.png'), fullPage: true });

  // Enable custom design: select "Custom design" in the Design Mode dropdown
  await selectQOption(extFrame, 'Design Mode', 'Custom design');
  await page.waitForTimeout(500);

  // Select the HappyBirthday template
  await selectQOption(extFrame, 'Template', 'Happy Birthday');
  await page.waitForTimeout(500);

  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-create-dialog-template.png'), fullPage: true });

  // Submit the form — click the submit button (inside the dialog, not the header)
  // The dialog submit button has type="submit" and label "Create Gift Card"
  const dialogSubmit = extFrame.locator('.q-dialog .q-btn.bg-primary:has-text("Create Gift Card")');
  await dialogSubmit.click();
  await page.waitForTimeout(5000);

  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-card-created.png'), fullPage: true });
});

test('view gift card list', async ({ page, request }) => {
  await loginAndGoto(page, BASE_URL + '/ext/giftcardswasm');
  await page.waitForTimeout(3000);

  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '05-card-list.png'), fullPage: true });
});

test('delete a gift card', async ({ page }) => {
  await loginAndGoto(page, BASE_URL + '/ext/giftcardswasm');

  const extFrame = await getExtFrame(page);
  if (!extFrame) return;
  await dismissDialogs(page);

  // Wait for the table to load
  await extFrame.waitForSelector('.q-table', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // Expand the first row to reveal action buttons
  const expandBtn = await extFrame.$('.q-table tbody tr .q-btn:has(.q-icon.text-expand_more), .q-table tbody tr .q-btn:has(.q-icon.expand_more)');
  if (!expandBtn) return;
  await expandBtn.click();
  await page.waitForTimeout(500);

  // Click the delete button (has aria-label="Delete gift card")
  const deleteBtn = await extFrame.$('button[aria-label="Delete gift card"]');
  if (!deleteBtn) return;
  await deleteBtn.click();
  await page.waitForTimeout(1000);

  // Screenshot the confirm dialog
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '09-delete-confirm.png'), fullPage: true });

  // Click "Delete Card" in the confirmation dialog
  await clickQBtn(extFrame, 'Delete Card');
  await page.waitForTimeout(3000);

  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '10-card-deleted.png'), fullPage: true });
});

test('view gift card detail with QR', async ({ page }) => {
  await loginAndGoto(page, BASE_URL + '/ext/giftcardswasm');

  const extFrame = await getExtFrame(page);
  if (!extFrame) return;
  await dismissDialogs(page);

  // Wait for the table to load
  await extFrame.waitForSelector('.q-table', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // Click the info button (aria-label="View Full Details") on the first row
  const viewBtn = await extFrame.$('button[aria-label="View Full Details"]');
  if (viewBtn) {
    await viewBtn.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '06-card-detail-qr.png'), fullPage: true });
  }
});

test('redeem page', async ({ page, request }) => {
  const token = await getAccessToken(request);
  const cardRes = await request.post(BASE_URL + '/api/v1/ext/giftcardswasm/cards', {
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: { amount: 500, recipientName: 'Charlie', senderName: 'Dave', message: 'Test redeem card' },
  });
  const card = await cardRes.json();
  const rawToken = card.rawToken || card.tokenHash;

  // Navigate to redeem page (public, no auth needed)
  await page.goto(BASE_URL + '/ext/giftcardswasm/redeem/' + rawToken);
  await page.waitForTimeout(5000);

  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '07-redeem-page.png'), fullPage: true });
});

test('claim page', async ({ page }) => {
  await page.goto(BASE_URL + '/ext/giftcardswasm/claim', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(5000);

  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '08-claim-page.png'), fullPage: true });
});
