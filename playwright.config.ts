import {defineConfig} from '@playwright/test'

const BASE_URL = process.env.LNBITS_E2E_BASE_URL ?? 'http://127.0.0.1:5000'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results',
  timeout: 120_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  expect: {
    timeout: 30_000
  },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    headless: true,
    viewport: {
      width: 1280,
      height: 900
    },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off'
  }
})
