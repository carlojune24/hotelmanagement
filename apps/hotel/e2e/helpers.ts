import { expect, type Page } from 'playwright/test';

export const SLUG = process.env.E2E_HOTEL_SLUG ?? 'hotel1';
export const STAFF_EMAIL = process.env.E2E_STAFF_EMAIL ?? 'manager@example.com';
export const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'manager12345';
export const MANUAL = process.env.E2E_MANUAL === '1';

/** A date `days` from today as YYYY-MM-DD (the server re-checks it against the venue's hours). */
export function futureDate(days: number): string {
	return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

let seq = 0;
/** A guest nobody else is using, so reruns and the per-phone order brake never collide. */
export function uniqueGuest() {
	const n = `${Date.now().toString().slice(-7)}${++seq}`;
	return { name: `E2E Guest ${n}`, phone: `0917${n.padStart(7, '0').slice(-7)}`, email: `e2e-${n}@example.test` };
}

export async function staffLogin(page: Page) {
	await page.goto(`/${SLUG}/management/login`);
	await page.locator('input[name="email"]').fill(STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	// The login page itself is under /management/, so wait until the visit has left it.
	await expect(page).not.toHaveURL(/\/management\/login/);
}

/**
 * Reserves a table as a guest and returns where the site sent them. The venue must take online
 * reservations, and online orders too if you expect the straight-to-menu redirect.
 * `withOrder` (default true) ticks "Reserve and pre-order"; pass false for the table-only choice.
 */
export async function reserveAsGuest(page: Page, opts: { daysAhead?: number; party?: number; withOrder?: boolean } = {}) {
	const guest = uniqueGuest();
	await page.goto(`/${SLUG}/dining/reserve?date=${futureDate(opts.daysAhead ?? 4)}&party=${opts.party ?? 2}`);
	await page.locator('label.dining-slot').first().click();
	await page.locator('#rvName').fill(guest.name);
	await page.locator('#rvPhone').fill(guest.phone);
	await page.locator('#rvEmail').fill(guest.email);
	const preorder = page.locator('input[name="preorder"][value="1"]');
	if (opts.withOrder !== false && (await preorder.count())) await preorder.check();
	await page.getByRole('button', { name: /Reserve my table|Reserve and choose dishes/ }).click();
	await page.waitForURL(/\/dining\/(order\?|reserve\/TB-)/);
	return guest;
}

/** Picks the first available dish (answering a required add-on question if it asks one). */
export async function addFirstDish(page: Page) {
	await page.locator('button.order-row:not([disabled])').first().click();
	const addToOrder = page.getByRole('button', { name: 'Add to order' });
	if (await addToOrder.isVisible().catch(() => false)) {
		const firstChoice = page.locator('.order-dish [role="checkbox"], .order-dish input[type="radio"], .order-dish input[type="checkbox"]').first();
		if (await firstChoice.count()) await firstChoice.click({ force: true });
		await addToOrder.click();
	}
	await expect(page.locator('.order-line').first()).toBeVisible();
}

export async function fillGuestDetails(page: Page, guest: { name: string; phone: string; email: string }) {
	await page.locator('#orName').fill(guest.name);
	await page.locator('#orPhone').fill(guest.phone);
	await page.locator('#orEmail').fill(guest.email);
}

/**
 * The PayMongo hosted page cannot be scripted. With E2E_MANUAL=1 the browser stops here: pay with a
 * test GCash/card, wait for the redirect back, then press Resume in the Playwright inspector.
 */
export async function payOnPaymongo(page: Page) {
	await page.waitForURL(/paymongo|pay\.test|checkout/i, { timeout: 30_000 }).catch(() => undefined);
	if (MANUAL) {
		await page.pause();
	}
}

/** The order code and access token from a tracking-page URL. */
export function orderFromUrl(url: string) {
	const u = new URL(url);
	return { code: u.pathname.split('/').pop()!, token: u.searchParams.get('t')! };
}
