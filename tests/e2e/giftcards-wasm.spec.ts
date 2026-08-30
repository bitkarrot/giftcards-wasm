import {test, expect, type Page} from '@playwright/test'

const BASE_URL = process.env.LNBITS_E2E_BASE_URL ?? 'http://127.0.0.1:5000'

// Login credentials — the existing superadmin account
const ADMIN_USER = 'superadmin'
const ADMIN_PASS = 'secret1234'

/**
 * Log in to LNbits via the UI and wait for the wallet page to load.
 */
async function login(page: Page) {
  await page.goto(`${BASE_URL}/`)
  await page.waitForSelector('input', {timeout: 30_000})

  // Fill username
  const userInput = page.locator('input[name="username"], input[type="text"]').first()
  await userInput.fill(ADMIN_USER)

  // Fill password
  const passInput = page.locator('input[type="password"]').first()
  await passInput.fill(ADMIN_PASS)

  // Click login button
  const loginBtn = page.locator('button[type="submit"], button:has-text("Login")').first()
  await loginBtn.click()

  // Wait for navigation away from login page
  await page.waitForURL(url => !url.toString().includes('/login'), {timeout: 30_000})
  await page.waitForTimeout(2_000)
}

/**
 * Navigate to the giftcards-wasm extension page.
 */
async function navigateToExtension(page: Page) {
  await page.goto(`${BASE_URL}/ext/giftcards_wasm`)
  await page.waitForTimeout(3_000)

  // Dismiss any open dialogs on the parent page (e.g. "what's new" prompts)
  const parentDialog = page.locator('.q-dialog .q-btn:has(.q-icon[class*="close"]), .q-dialog button[aria-label*="close" i]').first()
  const hasParentDialog = await parentDialog.isVisible().catch(() => false)
  if (hasParentDialog) {
    await parentDialog.click()
    await page.waitForTimeout(500)
  }

  // Dismiss any open dialogs inside the extension iframe
  const frame = extFrame(page)
  const closeBtn = frame.locator('.q-dialog .q-btn:has(.q-icon[class*="close"]), .q-dialog button[aria-label*="close" i]').first()
  const hasClose = await closeBtn.isVisible().catch(() => false)
  if (hasClose) {
    await closeBtn.click()
    await page.waitForTimeout(500)
  }

  // Also try pressing Escape to dismiss any remaining dialog
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
}

/**
 * Get the extension iframe's frame locator.
 */
function extFrame(page: Page) {
  return page.frameLocator('iframe').first()
}

test.describe('giftcards-wasm extension', () => {
  test.beforeEach(async ({page}) => {
    // Dismiss LNbits disclaimer and what's-new prompts
    await page.addInitScript(
      "window.localStorage.setItem('lnbits.disclaimerShown', 'true')"
    )
    await login(page)
  })

  test('admin page loads and is not blank', async ({page}) => {
    await navigateToExtension(page)

    // Wait for the extension iframe to load and render content
    const frame = extFrame(page)

    // The body should not be empty — the Vue app should have mounted
    await expect(frame.locator('#q-app')).toBeVisible({timeout: 30_000})
    const bodyText = await frame.locator('body').innerText()
    expect(bodyText.length).toBeGreaterThan(0)

    await page.screenshot({path: 'test-results/admin-page.png', fullPage: true})
  })

  test('gift card table is visible with cards', async ({page}) => {
    await navigateToExtension(page)

    const frame = extFrame(page)

    // Look for the table
    await expect(frame.locator('table, .q-table').first()).toBeVisible({timeout: 30_000})

    // Check that table has rows (cards from the database)
    const rows = frame.locator('table tbody tr, .q-table .q-tr')
    const rowCount = await rows.count()
    expect(rowCount).toBeGreaterThan(0)

    await page.screenshot({path: 'test-results/card-table.png', fullPage: true})
  })

  test('create card dialog opens', async ({page}) => {
    await navigateToExtension(page)

    const frame = extFrame(page)

    // Wait for table to load
    await expect(frame.locator('table, .q-table').first()).toBeVisible({timeout: 30_000})

    // Find and click the create button
    const createBtn = frame.locator('button:has-text("Create"), button:has-text("New"), q-btn:has-text("Create")').first()
    await expect(createBtn).toBeVisible({timeout: 10_000})
    await createBtn.click()
    await page.waitForTimeout(1_000)

    // A dialog should appear
    const dialog = frame.locator('.q-dialog, [role="dialog"]').first()
    await expect(dialog).toBeVisible({timeout: 10_000})

    await page.screenshot({path: 'test-results/create-dialog.png', fullPage: true})
  })

  test('detail dialog shows template image', async ({page}) => {
    await navigateToExtension(page)

    const frame = extFrame(page)

    // Wait for table
    await expect(frame.locator('table, .q-table').first()).toBeVisible({timeout: 30_000})

    // Find an info/detail button in the table
    const infoBtn = frame.locator(
      'button[aria-label*="info" i], button[aria-label*="detail" i], ' +
      '.q-btn:has(.q-icon[text="info"]), .q-btn:has(.q-icon[class*="info"])'
    ).first()

    const hasInfoBtn = await infoBtn.isVisible().catch(() => false)
    if (!hasInfoBtn) {
      // Try finding any button in the table rows
      const rowBtn = frame.locator('table tbody tr button, .q-table .q-tr button').first()
      const hasRowBtn = await rowBtn.isVisible().catch(() => false)
      if (!hasRowBtn) {
        test.skip(true, 'No detail/info button found in table')
      }
      await rowBtn.click()
    } else {
      await infoBtn.click()
    }

    await page.waitForTimeout(2_000)

    // Check dialog is visible
    const dialog = frame.locator('.q-dialog, [role="dialog"]').first()
    await expect(dialog).toBeVisible({timeout: 10_000})

    // Check for card image — it should use /image/ path, not /img/
    const cardImg = frame.locator('.q-dialog img').first()
    const hasImg = await cardImg.isVisible().catch(() => false)
    if (hasImg) {
      const src = await cardImg.getAttribute('src')
      expect(src).toBeTruthy()
      // Must NOT use the wrong /img/ path
      expect(src).not.toMatch(/\/img\//)
    }

    await page.screenshot({path: 'test-results/detail-dialog.png', fullPage: true})
  })

  test('no email-related UI elements present', async ({page}) => {
    await navigateToExtension(page)

    const frame = extFrame(page)
    await expect(frame.locator('#q-app')).toBeVisible({timeout: 30_000})

    const bodyText = await frame.locator('body').innerText()

    // Verify all email-related text has been removed
    expect(bodyText).not.toContain('Send Email')
    expect(bodyText).not.toContain('Email Delivery')
    expect(bodyText).not.toContain('Delivery Status')
    expect(bodyText).not.toContain('Bulk Email')
    expect(bodyText).not.toContain('Recipient Email')

    await page.screenshot({path: 'test-results/no-email-ui.png', fullPage: true})
  })

  test('CSV export buttons are present', async ({page}) => {
    await navigateToExtension(page)

    const frame = extFrame(page)
    await expect(frame.locator('table, .q-table').first()).toBeVisible({timeout: 30_000})

    // Look for CSV/Export buttons
    const csvBtns = frame.locator('button:has-text("CSV"), button:has-text("Export"), button:has-text("Download")')
    const count = await csvBtns.count()
    expect(count).toBeGreaterThan(0)

    await page.screenshot({path: 'test-results/csv-buttons.png', fullPage: true})
  })

  test('CSV export shows dialog with CSV content', async ({page}) => {
    await navigateToExtension(page)

    const frame = extFrame(page)
    await expect(frame.locator('table, .q-table').first()).toBeVisible({timeout: 30_000})

    // Click "Download CSV (Filtered)" — exports all loaded cards
    const csvBtn = frame.locator('button:has-text("Download CSV (Filtered)")').first()
    await expect(csvBtn).toBeVisible({timeout: 10_000})
    await csvBtn.click()

    // A CSV export dialog should appear (not a file download — the sandbox
    // blocks downloads, so we show the CSV in a dialog with copy button)
    const dialog = frame.locator('.q-dialog').first()
    await expect(dialog).toBeVisible({timeout: 10_000})

    // The dialog should contain the CSV content in a textarea
    const textarea = frame.locator('.q-dialog textarea').first()
    await expect(textarea).toBeVisible({timeout: 10_000})
    const csvContent = await textarea.inputValue()
    expect(csvContent).toContain('card_id')
    // Should have at least one data row
    const lines = csvContent.trim().split('\n')
    expect(lines.length).toBeGreaterThan(1)

    // The "Copy to Clipboard" button should be present
    const copyBtn = frame.locator('.q-dialog button:has-text("Copy to Clipboard")').first()
    await expect(copyBtn).toBeVisible({timeout: 5_000})

    await page.screenshot({path: 'test-results/csv-export-dialog.png', fullPage: true})
  })

  test('redeem page loads with branded card canvas', async ({page}) => {
    // First get a redemption URL via the API
    const loginResp = await page.request.post(`${BASE_URL}/api/v1/auth`, {
      data: {username: ADMIN_USER, password: ADMIN_PASS},
    })
    const {access_token} = await loginResp.json()

    const cardsResp = await page.request.get(`${BASE_URL}/api/v1/ext/giftcards_wasm/cards`, {
      headers: {Authorization: `Bearer ${access_token}`},
    })
    const cardsData = await cardsResp.json()
    const cards = cardsData.data || []
    if (cards.length === 0) {
      test.skip(true, 'No gift cards found to test redeem page')
    }

    // Find a card with a redemption URL
    const card = cards.find((c: any) => c.redemptionUrl)
    if (!card) {
      test.skip(true, 'No card with redemption URL found')
    }

    let redeemUrl: string = card.redemptionUrl
    // Make it absolute if needed
    if (redeemUrl.startsWith('/')) {
      redeemUrl = `${BASE_URL}${redeemUrl}`
    }

    // Navigate to the redeem page
    await page.goto(redeemUrl)
    await page.waitForTimeout(5_000)

    // The redeem page should load inside an iframe
    const redeemFrame = extFrame(page)
    await expect(redeemFrame.locator('body')).not.toBeEmpty({timeout: 30_000})

    // Look for canvas (branded card or QR code)
    const canvas = redeemFrame.locator('canvas').first()
    await expect(canvas).toBeVisible({timeout: 30_000})

    await page.screenshot({path: 'test-results/redeem-page.png', fullPage: true})
  })

  test('no console errors on admin page', async ({page}) => {
    const consoleErrors: string[] = []

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    await navigateToExtension(page)

    const frame = extFrame(page)
    await expect(frame.locator('#q-app')).toBeVisible({timeout: 30_000})

    // Wait for any delayed errors
    await page.waitForTimeout(3_000)

    // Filter out CSP violations and network errors that are expected in the sandbox
    const realErrors = consoleErrors.filter(e =>
      !e.includes('Content Security Policy') &&
      !e.includes('Failed to load resource') &&
      !e.includes('net::ERR')
    )

    expect(realErrors).toEqual([])
  })

  test('dark mode toggle works', async ({page}) => {
    await navigateToExtension(page)

    const frame = extFrame(page)
    await expect(frame.locator('table, .q-table').first()).toBeVisible({timeout: 30_000})

    // Initially body should not have body--dark (light mode by default in headless)
    const bodyClass = await frame.locator('body').getAttribute('class')
    const initiallyDark = bodyClass?.includes('body--dark') ?? false

    // Find the dark mode toggle button (round, flat with dark_mode/light_mode icon)
    const darkToggle = frame.locator('button:has(.q-icon.text-dark_mode), button:has(.q-icon.text-light_mode), .q-btn--flat.q-btn--round').first()
    await expect(darkToggle).toBeVisible({timeout: 10_000})

    // Click to toggle
    await darkToggle.click()
    await page.waitForTimeout(1_000)

    // Body should now have body--dark class
    const bodyClassAfter = await frame.locator('body').getAttribute('class')
    expect(bodyClassAfter).toContain('body--dark')

    // Take screenshot showing dark mode
    await page.screenshot({path: 'test-results/dark-mode-on.png', fullPage: true})

    // Toggle back to light
    await darkToggle.click()
    await page.waitForTimeout(1_000)
    const bodyClassFinal = await frame.locator('body').getAttribute('class')
    expect(bodyClassFinal).not.toContain('body--dark')

    await page.screenshot({path: 'test-results/dark-mode-off.png', fullPage: true})
  })
})
