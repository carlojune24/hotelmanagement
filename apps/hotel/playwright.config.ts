import { defineConfig } from 'playwright/test';

/**
 * End-to-end specs for the dining pre-order flow. They are run by hand against your own dev server
 * and database, so there is deliberately no `webServer` block:
 *
 *   1. `pnpm dev`                                  (http://localhost:5175)
 *   2. `pnpm exec playwright test --headed`        (add E2E_MANUAL=1 to pause at PayMongo)
 *
 * Everything is configurable by environment variable:
 *   E2E_BASE_URL        default http://localhost:5175
 *   E2E_HOTEL_SLUG      default hotel1            (the seeded hotel)
 *   E2E_STAFF_EMAIL     default manager@example.com
 *   E2E_STAFF_PASSWORD  default manager12345
 *   E2E_MANUAL          1 = stop at the PayMongo hosted page so you can pay with a test method
 */
export default defineConfig({
	testDir: './e2e',
	// One at a time: the specs share one venue's tables, and the PayMongo pause needs a single browser.
	workers: 1,
	fullyParallel: false,
	retries: 0,
	timeout: 120_000,
	expect: { timeout: 10_000 },
	reporter: [['list'], ['html', { open: 'never' }]],
	use: {
		baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5175',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	}
});
