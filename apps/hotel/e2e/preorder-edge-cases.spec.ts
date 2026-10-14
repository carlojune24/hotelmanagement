import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';

/**
 * The two billing hazards found while reviewing the pre-order flow. Both guards are now built
 * (`attachPreOrdersToCheck` refuses an occupied table when seating, and `confirmDiningPayment` attaches a
 * pre-order paid after seating). These are step-by-step scripts for you to finish against your own
 * tables, so they stay marked fixme and show as pending in the report rather than as a false pass.
 *
 * 1. Seating a party onto a table that still carries another party's open bill must be refused with a
 *    clear message, not silently put the pre-order on the previous party's bill.
 * 2. A pre-order paid *after* its party was seated must still land on that table's bill.
 */

test.describe('billing guards', () => {
	test('seating onto a table with an open bill is refused', async ({ page }) => {
		test.fixme(true, 'Guard is built. Fill in the table name from your floor plan, then remove this line.');
		await staffLogin(page);
		// 1. In Orders, place a dine-in order on table T (this opens a bill on T).
		// 2. Reserve table T for a guest with a pre-order and try "Mark seated".
		await page.goto(`/${SLUG}/management/dining/reservations`);
		await expect(page.getByText(/still has an open bill/i)).toBeVisible();
	});

	test('paying after being seated puts the pre-order on the table bill', async ({ page }) => {
		test.fixme(true, 'Attach is built. Needs a manual PayMongo payment; fill in the steps, then remove this line.');
		await staffLogin(page);
		// 1. Reserve + pre-order online but leave the PayMongo page unpaid.
		// 2. Staff: Mark seated. 3. Pay the order from the guest's tracking page.
		// 4. The Floor panel for that table now lists the order under "Orders on this table".
		await page.goto(`/${SLUG}/management/dining/floor`);
	});
});
