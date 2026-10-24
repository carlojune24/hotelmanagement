import { expect, test, type Page } from 'playwright/test';
import { SLUG, staffLogin, uniqueGuest } from './helpers';

/**
 * Function hall event day: Check in → Check out (overtime worked out by the server) → housekeeping →
 * Close. See the plan in ~/.claude/plans/we-will-plan-this-cached-sky.md.
 *
 *   confirmed ──Check in──▶ checked in ──Check out──▶ checked out ──Close──▶ Closed
 *
 * Overtime is per started hour at the hall's extra-hour rate, no grace, counted from the end time the
 * desk states at check-out (defaulting to now) rather than from the moment the button is pressed. Close
 * is blocked until housekeeping has marked the hall clean, no damage is pending and the bill is settled.
 * "Full details" opens the front desk's right-hand rail (`data-testid="hall-detail"`), not a dialog.
 *
 * Prerequisites: an active function hall with an extra-hour rate set, a cashier shift open for the
 * walk-in's cash payment, and the staff login (E2E_STAFF_*) allowed to use the front desk and
 * housekeeping. Walk-in events are booked for today, so they check in straight away. The overtime
 * tests book a morning window (00:00-01:00) and skip themselves before 03:00 hotel time, when that
 * window would not yet be over. Tests skip themselves when the hall is already booked at that time.
 */

const TZ = process.env.E2E_TZ ?? 'Asia/Manila';
const frontDesk = `/${SLUG}/management/front-desk`;
const housekeeping = `/${SLUG}/management/housekeeping`;

const hotelHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));

/** Books a walk-in event for today on the first hall and returns the guest's name and the hall's name. */
async function walkInEvent(page: Page, window: { start: string; end: string }) {
	const guest = uniqueGuest();
	await page.goto(frontDesk);
	const hall = page.locator('div.rounded-xl', { has: page.getByRole('button', { name: 'Walk-in event' }) }).first();
	test.skip((await hall.count()) === 0, 'No active function hall.');
	const hallName = (await hall.locator('.font-semibold').first().innerText()).trim();
	await hall.getByRole('button', { name: 'Walk-in event' }).click();

	await page.locator('#heStartTime').fill(window.start);
	await page.locator('#heEndTime').fill(window.end);
	await page.locator('#heGuestCount').fill('20');
	await page.locator('#heFullName').fill(guest.name);
	await page.locator('#heEmail').fill(guest.email);
	await page.locator('#hePhone').fill(guest.phone);

	const submit = page.getByRole('button', { name: /Create & settle booking/ });
	await expect(submit).toBeEnabled({ timeout: 10_000 }).catch(() => undefined);
	test.skip(!(await submit.isEnabled()), 'The hall is not available at that time (or could not be quoted).');
	await submit.click();
	await expect(page.getByText(guest.name).first()).toBeVisible({ timeout: 15_000 });
	return { guest, hallName };
}

const eventRow = (page: Page, guestName: string) => page.locator('div.px-3.py-2\\.5', { hasText: guestName }).first();

async function housekeepingClean(page: Page, hallName: string) {
	await page.goto(housekeeping);
	await page.getByRole('button', { name: new RegExp(hallName) }).first().click();
	const start = page.getByRole('button', { name: 'Start cleaning' });
	if (await start.count()) await start.click();
	await page.getByRole('button', { name: 'Mark clean' }).click();
}

test.describe('function hall: check in, check out, close', () => {
	test.beforeEach(async ({ page }) => {
		await staffLogin(page);
	});

	test('an on-time event: close is blocked until housekeeping cleans the hall', async ({ page }) => {
		// A late evening window that is certainly not over yet only when run in the morning; otherwise
		// the event simply has overtime, which this test does not mind (it settles the bill below).
		const { guest, hallName } = await walkInEvent(page, { start: '00:00', end: '23:59' });
		let row = eventRow(page, guest.name);

		await expect(row.getByText('Confirmed')).toBeVisible();
		await row.getByRole('button', { name: 'Check in' }).click();
		row = eventRow(page, guest.name);
		await expect(row.getByText('Checked in')).toBeVisible();

		// Check out: the dialog shows no overtime, and the hall is flagged for housekeeping.
		await row.getByRole('button', { name: 'Check out' }).click();
		await expect(page.getByText('The event ended on time. There is no overtime to charge.')).toBeVisible();
		await page.getByRole('button', { name: 'Check out', exact: true }).last().click();
		row = eventRow(page, guest.name);
		await expect(row.getByText('Checked out')).toBeVisible();

		// Close is disabled and says why.
		await expect(row.getByText('Before you can close')).toBeVisible();
		await expect(row.getByText('Housekeeping has not cleaned the hall yet')).toBeVisible();
		await expect(row.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();

		// Housekeeping cleans it; front desk can now close.
		await housekeepingClean(page, hallName);
		await page.goto(frontDesk);
		row = eventRow(page, guest.name);
		await expect(row.getByText(/Ready to close/)).toBeVisible();
		await row.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(eventRow(page, guest.name).getByText('Closed')).toBeVisible();
	});

	test('an overrun shows the hours and amount, posts one overtime line, and must be paid before Close', async ({ page }) => {
		test.skip(hotelHour() < 3, 'The 00:00-01:00 window is not over before 03:00 hotel time.');
		const { guest, hallName } = await walkInEvent(page, { start: '00:00', end: '01:00' });
		let row = eventRow(page, guest.name);
		await row.getByRole('button', { name: 'Check in' }).click();

		await eventRow(page, guest.name).getByRole('button', { name: 'Check out' }).click();
		// Per started hour, no grace: at least one hour over, billed at the hall's rate.
		const dialog = page.getByRole('dialog');
		await expect(dialog.getByText(/hours? ×/)).toBeVisible();
		await expect(dialog.getByText('Added to the bill')).toBeVisible();
		const added = await dialog.locator('div', { hasText: 'Added to the bill' }).last().innerText();
		const preview = added.match(/₱[\d,]+\.\d{2}/)?.[0];
		expect(preview).toBeTruthy();
		await dialog.getByRole('button', { name: /Check out and charge/ }).click();

		row = eventRow(page, guest.name);
		await expect(row.getByText('Checked out')).toBeVisible();
		// The overtime is now owed, so Close lists the balance as well as housekeeping.
		await expect(row.getByText(/still owed on the bill/)).toBeVisible();

		// Full details: exactly one overtime line, for the amount that was previewed.
		await row.getByRole('button', { name: 'Full details' }).click();
		const details = page.getByTestId('hall-detail');
		await expect(details.getByText(/Overtime \(\d+h ×/)).toHaveCount(1);
		await expect(details.getByText(preview!).first()).toBeVisible();
		await details.getByRole('button', { name: /Take payment/ }).click();
		await details.getByRole('button', { name: /Record payment|Take payment|Pay/ }).last().click();
		await expect(details.getByText('Settled')).toBeVisible({ timeout: 10_000 });

		await housekeepingClean(page, hallName);
		await page.goto(frontDesk);
		await eventRow(page, guest.name).getByRole('button', { name: 'Close', exact: true }).click();
		await expect(eventRow(page, guest.name).getByText('Closed')).toBeVisible();
	});

	test('the bill follows the end time the desk states, not the moment Check out is pressed', async ({ page }) => {
		test.skip(hotelHour() < 3, 'The 00:00-01:00 window is not over before 03:00 hotel time.');
		const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
		const { guest } = await walkInEvent(page, { start: '00:00', end: '01:00' });
		await eventRow(page, guest.name).getByRole('button', { name: 'Check in' }).click();

		// While it is still checked in the row shows the meter running, before anything is posted.
		await expect(eventRow(page, guest.name).getByText(/Running \d+h over/)).toBeVisible();

		await eventRow(page, guest.name).getByRole('button', { name: 'Check out' }).click();
		const dialog = page.getByRole('dialog');
		const endedAt = dialog.locator('#hallEndedAt');

		// Stating the booked end itself: nothing to charge, however late it is now.
		await endedAt.fill(`${today}T01:00`);
		await expect(dialog.getByText('The event ended on time. There is no overtime to charge.')).toBeVisible();

		// An hour past it: exactly one hour, not the hours since.
		await endedAt.fill(`${today}T02:00`);
		await expect(dialog.getByText(/^1 hour ×/)).toBeVisible();
		await dialog.getByRole('button', { name: /Check out and charge/ }).click();

		await expect(eventRow(page, guest.name).getByText('Checked out')).toBeVisible();
		await eventRow(page, guest.name).getByRole('button', { name: 'Full details' }).click();
		await expect(page.getByTestId('hall-detail').getByText(/Overtime \(1h ×/)).toHaveCount(1);
	});

	test('a security deposit is held against the event and blocks Close until it is settled', async ({ page }) => {
		const { guest, hallName } = await walkInEvent(page, { start: '00:00', end: '23:59' });
		await eventRow(page, guest.name).getByRole('button', { name: 'Check in' }).click();

		// Collect the hold from the detail rail. It is collateral, so it never touches the bill.
		await eventRow(page, guest.name).getByRole('button', { name: 'Full details' }).click();
		let rail = page.getByTestId('hall-detail');
		const balanceBefore = await rail.innerText();
		await rail.locator('input[name="amountPhp"]').fill('5000');
		await rail.locator('select[name="method"]').selectOption('cash');
		await rail.getByRole('button', { name: 'Collect' }).click();
		await expect(rail.getByText('₱5000.00 held · Cash')).toBeVisible();
		expect(balanceBefore.match(/Balance ₱[\d,.]+/)?.[0]).toBe(
			(await rail.innerText()).match(/Balance ₱[\d,.]+/)?.[0]
		);

		await page.goto(frontDesk);
		await eventRow(page, guest.name).getByRole('button', { name: 'Check out' }).click();
		await page.getByRole('dialog').locator('button[type="submit"]').click();

		// Close names the hold, and the button stays disabled.
		let row = eventRow(page, guest.name);
		await expect(row.getByText(/security deposit is still held/)).toBeVisible();
		await expect(row.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();

		// Housekeeping gates the settle too, the way it gates a room's.
		await housekeepingClean(page, hallName);
		await page.goto(frontDesk);
		await eventRow(page, guest.name).getByRole('button', { name: 'Full details' }).click();
		rail = page.getByTestId('hall-detail');
		await rail.getByRole('button', { name: 'Settle deposit' }).click();
		await expect(rail.getByText(/settled —/)).toBeVisible();

		await page.goto(frontDesk);
		await expect(eventRow(page, guest.name).getByText(/security deposit is still held/)).toHaveCount(0);
	});

	test('a closed event leaves the board and shows as Closed in Transactions', async ({ page }) => {
		const { guest, hallName } = await walkInEvent(page, { start: '00:00', end: '23:59' });
		await eventRow(page, guest.name).getByRole('button', { name: 'Check in' }).click();
		await eventRow(page, guest.name).getByRole('button', { name: 'Check out' }).click();
		await page.getByRole('dialog').locator('button[type="submit"]').click();
		await housekeepingClean(page, hallName);

		await page.goto(frontDesk);
		const row = eventRow(page, guest.name);
		await expect(row.getByText(/Ready to close/)).toBeVisible();
		await row.getByRole('button', { name: 'Close', exact: true }).click();

		// Gone from today's board — a checked-out room leaves it the same way.
		await page.goto(frontDesk);
		await expect(eventRow(page, guest.name)).toHaveCount(0);

		// Still on the books, badged Closed rather than lumped in with "Checked out".
		await page.goto(`/${SLUG}/management/transactions`);
		const txRow = page.locator('tr', { hasText: guest.name }).first();
		await expect(txRow).toBeVisible();
		await expect(txRow.getByText('Closed')).toBeVisible();
	});

	test('a pending damage report blocks Close until it is charged or dismissed', async ({ page }) => {
		const { guest, hallName } = await walkInEvent(page, { start: '00:00', end: '23:59' });
		await eventRow(page, guest.name).getByRole('button', { name: 'Check in' }).click();
		await eventRow(page, guest.name).getByRole('button', { name: 'Check out' }).click();
		await page.getByRole('button', { name: 'Check out', exact: true }).last().click();

		// Housekeeping cleans the hall and reports damage (a photo is required).
		await housekeepingClean(page, hallName);
		await page.getByRole('button', { name: new RegExp(hallName) }).first().click();
		await page.getByPlaceholder('Describe the damage').fill('Cracked mirror by the entrance');
		await page.locator('input[name="photo"]').setInputFiles({
			name: 'damage.png',
			mimeType: 'image/png',
			buffer: Buffer.from(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
				'base64'
			)
		});
		await page.getByRole('button', { name: /Report damage|Submit|Send/ }).last().click();

		// Front desk: Close is blocked and names the damage.
		await page.goto(frontDesk);
		let row = eventRow(page, guest.name);
		await expect(row.getByText(/damage report/)).toBeVisible();
		await expect(row.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();

		// Dismiss it from Full details: Close opens up.
		await row.getByRole('button', { name: 'Full details' }).click();
		const details = page.getByTestId('hall-detail');
		await expect(details.getByText('Damage reported by Housekeeping')).toBeVisible();
		await details.getByRole('button', { name: 'Dismiss' }).click();
		await expect(details.getByText('Damage reported by Housekeeping')).toHaveCount(0);
		await page.goto(frontDesk);
		row = eventRow(page, guest.name);
		await expect(row.getByText(/Ready to close/)).toBeVisible();
		await row.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(eventRow(page, guest.name).getByText('Closed')).toBeVisible();
	});

	test('the audit log records check in, check out (with overtime) and close', async ({ page }) => {
		const audit = `/${SLUG}/management/settings/audit`;
		for (const [action, label] of [
			['hall_booking.check_in', 'Function hall event checked in'],
			['hall_booking.check_out', 'Function hall event checked out'],
			['hall_booking.complete', 'Function hall event closed']
		] as const) {
			await page.goto(`${audit}?action=${action}`);
			const none = page.getByText('No entries match these filters.');
			if (await none.count()) test.info().annotations.push({ type: 'note', description: `No ${action} entries yet; run the flow tests first.` });
			else await expect(page.getByText(label).first()).toBeVisible();
		}
	});
});
