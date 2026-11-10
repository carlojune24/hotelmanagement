import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';
import { closeDb, sql } from './db';

/**
 * Front desk: a "Stay extended" / "Stay shortened" folio line has no Void button. Voiding only the
 * charge left the booking's check-out date, total and room assignment changed, so the guest kept
 * the extra night unbilled. Undo a stay change with Modify stay instead.
 *
 * Needs an IN-HOUSE room whose stay was extended once (Modify stay → later check-out). Run:
 *   E2E_HOTEL_SLUG=mmhotel pnpm exec playwright test e2e/stay-change-void.spec.ts --headed
 *
 * Written, not yet run.
 */

test.afterAll(closeDb);

test('stay-change lines are tagged so they cannot be voided alone', async () => {
	const [row] = await sql<{ n: number }[]>`
		select count(*)::int as n from folio_charges
		where source is null and is_base_charge = false
			and (description like 'Stay extended —%' or description like 'Stay shortened —%')`;
	expect(row.n).toBe(0);
});

test('front desk shows no Void button on a stay extension', async ({ page }) => {
	await staffLogin(page);
	await page.goto(`/${SLUG}/management/front-desk`);

	const tile = page.locator('button', { hasText: /Checked in|Departing|Occupied/i }).first();
	test.skip((await tile.count()) === 0, 'No in-house room to try.');
	await tile.click();

	const line = page.locator('div.flex', { hasText: /^Stay extended —/ }).first();
	test.skip((await line.count()) === 0, 'This room has no stay extension.');
	await expect(line.getByRole('button', { name: 'Void' })).toHaveCount(0);
});
