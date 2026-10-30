import { expect, test, type Page } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';
import { sql } from './db';

/**
 * OTA (Agoda / Booking.com) bookings, prepaid at the OTA, end to end through the real UI:
 * the OTA mode of the front-desk walk-in drawer, the bookings list and detail, the city ledger staying
 * clear of them, the Finance → OTA payouts tab (with a short-paid booking), cancel / no-show at the OTA,
 * and check-in / check-out of an OTA guest. Money is read back from the dev database.
 *
 * It LEAVES its bookings behind on purpose (guest names start "DUMMY OTA", references "DUMMY-…"), so the
 * local hotel has OTA data to look at: one OTA booking still awaiting payout, one paid out, one cancelled.
 *
 *   E2E_HOTEL_SLUG=mmhotel pnpm exec playwright test e2e/ota-bookings.spec.ts
 *
 * Needs the hotel's front desk to have an open cashier shift is NOT required: OTA bookings take no cash.
 */

const RUN = Date.now().toString().slice(-6);
const ref = (k: string) => `DUMMY-${RUN}-${k}`;
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

interface Made {
	orderId: string;
	ref: string;
}
const made: Record<string, Made> = {};
/** Days from today that this run's stays start at. Earlier runs keep their bookings, so each run starts later. */
let B = 90;

async function openWalkIn(page: Page) {
	await page.goto(`/${SLUG}/management/front-desk`);
	await page.waitForLoadState('networkidle'); // the drawer's buttons do nothing before hydration
	await page.getByRole('button', { name: 'Walk-in', exact: true }).click();
	await expect(page.getByText('Walk-in booking')).toBeVisible();
}

/** Opens the drawer, searches `nights` nights from `startOffset` days out and adds the `row`th result. */
async function addRoom(page: Page, startOffset: number, nights: number, row = 0) {
	await openWalkIn(page);
	const sheet = page.locator('[data-slot="sheet-content"]');
	await sheet.locator('input[name="checkIn"]').fill(day(startOffset));
	await sheet.locator('input[name="checkOut"]').fill(day(startOffset + nights));
	await sheet.getByRole('button', { name: 'Check availability' }).click();
	const add = sheet.getByRole('button', { name: 'Add', exact: true });
	await expect(add.nth(row)).toBeVisible();
	await add.nth(row).click();
	await expect(sheet.getByRole('button', { name: 'OTA booking' })).toBeVisible();
	return sheet;
}

async function fillOta(
	sheet: ReturnType<Page['locator']>,
	f: { guest: string; ota: string; ref: string; gross: string; pct?: string; commission?: string }
) {
	await sheet.getByRole('button', { name: 'OTA booking' }).click();
	await sheet.locator('#wiFullName').fill(f.guest);
	await sheet.locator('#otaName').fill(f.ota);
	await sheet.locator('#otaRef').fill(f.ref);
	await sheet.locator('#otaGross').fill(f.gross);
	if (f.pct) await sheet.locator('#otaPct').fill(f.pct);
	if (f.commission) await sheet.locator('#otaCommission').fill(f.commission);
}

/** One full OTA booking through the drawer; returns where staff land. */
async function createOta(
	page: Page,
	key: string,
	o: { startOffset: number; nights?: number; row?: number; ota: string; gross: string; pct: string }
) {
	const sheet = await addRoom(page, o.startOffset, o.nights ?? 2, o.row ?? 0);
	await fillOta(sheet, { guest: `DUMMY OTA Guest ${key}`, ota: o.ota, ref: ref(key), gross: o.gross, pct: o.pct });
	await sheet.getByRole('button', { name: 'Create OTA booking' }).click();
	await expect(page).toHaveURL(/\/management\/transactions\/[0-9a-f-]{36}/);
	const orderId = page.url().match(/transactions\/([0-9a-f-]{36})/)![1]!;
	made[key] = { orderId, ref: ref(key) };
	return orderId;
}

const orderRow = async (orderId: string) =>
	(await sql`select ota_name, ota_reference, ota_gross_centavos::int g, ota_commission_centavos::int c, ota_net_centavos::int n, total_centavos::int total, status from orders where id = ${orderId}`)[0]!;
const receivableOf = async (orderId: string) =>
	(await sql`select status, original_amount_centavos::int orig, outstanding_centavos::int outstanding from receivables where order_id = ${orderId}`)[0];
const movementsFor = async (receivableId: string) =>
	await sql`select direction, category, amount_centavos::int amt, source_type, memo from cash_movements where source_id = ${receivableId} order by amount_centavos`;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
	const n = (await sql`select count(*)::int n from orders where ota_reference like 'DUMMY-%'`)[0]!.n as number;
	B = 90 + n * 8;
});

test.describe('OTA bookings · end to end', () => {
	test.beforeEach(async ({ page }) => {
		await staffLogin(page);
	});

	test('the form: OTA mode drops payment, works out commission and net live, and validates', async ({ page }) => {
		const sheet = await addRoom(page, B + 40, 2);
		await sheet.getByRole('button', { name: 'OTA booking' }).click();

		await expect(sheet.getByText('You receive (net)')).toBeVisible();
		await expect(sheet.getByText('Our rate for these rooms')).toBeVisible();
		// No payment step in OTA mode, and email is optional.
		await expect(sheet.getByText('Payment method')).toHaveCount(0);
		await expect(sheet.locator('#wiEmail')).not.toHaveAttribute('required', '');
		const create = sheet.getByRole('button', { name: 'Create OTA booking' });
		await expect(create).toBeDisabled();

		await sheet.locator('#wiFullName').fill('DUMMY OTA Form Check');
		await sheet.locator('#otaName').fill('Agoda');
		await sheet.locator('#otaRef').fill(ref('FORM'));
		await sheet.locator('#otaGross').fill('10000');
		await sheet.locator('#otaPct').fill('15');
		await expect(sheet.locator('#otaCommission')).toHaveValue('1500.00');
		await expect(sheet.getByText('You receive (net)').locator('..')).toContainText('₱8500.00'); // the front-desk page's own peso() has no thousands separator
		await expect(create).toBeEnabled();

		// Typing the peso commission fills the % back.
		await sheet.locator('#otaCommission').fill('2000');
		await expect(sheet.locator('#otaPct')).toHaveValue('20.00');

		// A commission at or above the total is refused and blocks submit.
		await sheet.locator('#otaCommission').fill('10000');
		await expect(sheet.getByText('The commission must be less than the total.')).toBeVisible();
		await expect(create).toBeDisabled();

		// Switching back to Walk-in brings the payment step back.
		await sheet.getByRole('button', { name: 'Walk-in', exact: true }).click();
		await expect(sheet.getByRole('button', { name: /Create booking/ })).toBeVisible();
	});

	test('create Agoda A: no cash moves, the receivable carries the gross, the detail page says OTA', async ({ page }) => {
		const orderId = await createOta(page, 'A', { startOffset: B, ota: 'Agoda', gross: '10000', pct: '15' });
		await expect(page.getByText('Awaiting OTA payout').first()).toBeVisible();
		await expect(page.getByText('OTA', { exact: true }).first()).toBeVisible();

		expect(await orderRow(orderId)).toMatchObject({
			ota_name: 'agoda',
			ota_reference: ref('A'),
			g: 1_000_000,
			c: 150_000,
			n: 850_000,
			total: 1_000_000,
			status: 'confirmed'
		});
		const r = await receivableOf(orderId);
		expect(r).toMatchObject({ status: 'open', orig: 1_000_000, outstanding: 1_000_000 });
		const cash =
			await sql`select count(*)::int n from cash_movements where payment_id in (select id from payments where order_id = ${orderId})`;
		expect(cash[0]!.n).toBe(0);
	});

	test('create Agoda B (second room type) and Booking.com C', async ({ page }) => {
		await createOta(page, 'B', { startOffset: B, row: 1, ota: 'Agoda', gross: '6000', pct: '15' });
		await createOta(page, 'C', { startOffset: B + 2, ota: ' Booking.com ', gross: '8000', pct: '18' });
		expect((await orderRow(made.C!.orderId)).ota_name).toBe('booking.com'); // trimmed and lower-cased
	});

	test('the same OTA reference twice is refused with a plain message', async ({ page }) => {
		const sheet = await addRoom(page, B + 4, 2);
		await fillOta(sheet, { guest: 'DUMMY OTA Duplicate', ota: 'AGODA', ref: ref('A'), gross: '5000', pct: '10' });
		await sheet.getByRole('button', { name: 'Create OTA booking' }).click();
		await expect(page.getByText(/already booked here/)).toBeVisible(); // shown as a toast, outside the drawer
		await expect(page).not.toHaveURL(/\/transactions\//);
	});

	test('the bookings list: OTA source filter, OTA badge, awaiting-payout state', async ({ page }) => {
		await page.goto(`/${SLUG}/management/transactions?range=custom&from=2020-01-01&to=2099-12-31&source=ota`);
		await expect(page.getByRole('link', { name: 'OTA', exact: true })).toBeVisible();
		const rows = page.locator('tbody tr');
		await expect(rows.first()).toBeVisible();
		for (const badge of await page.locator('tbody tr td:nth-child(6)').allInnerTexts()) expect(badge.trim()).toBe('OTA');
		await expect(page.locator('tbody')).toContainText('Awaiting OTA payout');
		await expect(page.locator('tbody')).toContainText('DUMMY OTA Guest A');
		// Walk-in filter does not include them.
		await page.goto(`/${SLUG}/management/transactions?range=custom&from=2020-01-01&to=2099-12-31&source=walkin`);
		await expect(page.locator('tbody')).not.toContainText('DUMMY OTA Guest A');
	});

	test('the city ledger leaves OTA accounts out; the OTA payouts tab lists them by OTA', async ({ page }) => {
		await page.goto(`/${SLUG}/management/finance/receivables?show=all`);
		await expect(page.locator('body')).not.toContainText(ref('A'));
		await expect(page.locator('body')).not.toContainText('DUMMY OTA Guest A');

		await page.goto(`/${SLUG}/management/finance/ota`);
		await expect(page.getByRole('link', { name: 'OTA payouts' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'agoda' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'booking.com' })).toBeVisible();
		for (const k of ['A', 'B', 'C']) await expect(page.locator('body')).toContainText(`Ref ${ref(k)}`);
		await expect(page.getByRole('button', { name: 'Record payout' })).toBeDisabled();
	});

	test('cancel at the OTA: no refund screen, the room is released, the receivable closes', async ({ page }) => {
		const orderId = await createOta(page, 'D', { startOffset: B + 6, ota: 'Agoda', gross: '4000', pct: '15' });
		const bookingId = (await sql`select id from bookings where order_id = ${orderId}`)[0]!.id as string;
		await page.goto(`/${SLUG}/management/reservations/room/${bookingId}`);
		await page.waitForLoadState('networkidle');

		await expect(page.getByRole('button', { name: /^Cancel booking$/ })).toHaveCount(0);
		await expect(page.getByText(/nothing is refunded here/i)).toBeVisible();
		const cancel = page.getByRole('button', { name: 'Cancelled at OTA' });
		await cancel.click(); // the reason is required: nothing happens without it
		expect((await sql`select status from bookings where id = ${bookingId}`)[0]!.status).toBe('confirmed');

		await page.locator('#otaReason').fill('Guest cancelled on Agoda');
		await cancel.click();
		await expect(page.getByText('Cancelled. The room is released.')).toBeVisible();
		expect((await sql`select status from bookings where id = ${bookingId}`)[0]!.status).toBe('cancelled');
		expect(await receivableOf(orderId)).toMatchObject({ status: 'written_off', outstanding: 0 });
		expect((await orderRow(orderId)).status).toBe('cancelled');

		// It no longer waits for a payout.
		await page.goto(`/${SLUG}/management/finance/ota`);
		await expect(page.locator('body')).not.toContainText(`Ref ${ref('D')}`);
	});

	test('payout: tick two Agoda bookings, one short-paid, confirm; cash in net, commission closed', async ({ page }) => {
		await page.goto(`/${SLUG}/management/finance/ota`);
		await page.waitForLoadState('networkidle');
		const rowA = page.locator('tr', { hasText: `Ref ${ref('A')}` });
		const rowB = page.locator('tr', { hasText: `Ref ${ref('B')}` });
		await rowA.getByRole('checkbox').check();
		await rowB.getByRole('checkbox').check();
		// Prefilled with the expected net.
		await expect(rowA.locator('input[type="number"]')).toHaveValue('8500.00');
		await expect(rowB.locator('input[type="number"]')).toHaveValue('5100.00');

		await rowB.locator('input[type="number"]').fill('5000');
		await expect(rowB.getByText('Short ₱100.00')).toBeVisible();
		await rowA.locator('input[type="number"]').fill('9000000'); // more than is owed
		await expect(rowA.getByText(/Cannot be more than/)).toBeVisible();
		await expect(page.getByRole('button', { name: 'Record payout' })).toBeDisabled();
		await rowA.locator('input[type="number"]').fill('8500');

		await expect(page.getByRole('button', { name: 'Record payout' })).toBeDisabled(); // no statement reference yet
		await page.locator('#otaStatementRef').fill(`DUMMY-STMT-${RUN}`);
		await expect(page.getByText('Received ₱13,500.00')).toBeVisible();
		await expect(page.getByText('Commission ₱2,500.00')).toBeVisible();

		await page.getByRole('button', { name: 'Record payout' }).click();
		await expect(page.getByText(/Bank receives ₱13,500\.00; 2 booking/)).toBeVisible();
		await page.getByRole('button', { name: 'Confirm' }).click();
		await expect(page.getByText(/Payout recorded: ₱13,500\.00 received, ₱2,500\.00 commission/)).toBeVisible();

		// Both rows are gone; C is still waiting.
		await expect(page.locator('body')).not.toContainText(`Ref ${ref('A')}`);
		await expect(page.locator('body')).not.toContainText(`Ref ${ref('B')}`);
		await expect(page.locator('body')).toContainText(`Ref ${ref('C')}`);

		// Money: one cash-in per booking, room revenue, into the bank; commission written off, nothing else moved.
		for (const [k, net] of [['A', 850_000], ['B', 500_000]] as const) {
			const r = (await sql`select id from receivables where order_id = ${made[k]!.orderId}`)[0]!.id as string;
			const m = await movementsFor(r);
			expect(m).toHaveLength(1);
			expect(m[0]).toMatchObject({ direction: 'in', category: 'room_revenue', amt: net, source_type: 'receivable_settlement' });
			expect(m[0]!.memo).toContain(`DUMMY-STMT-${RUN}`);
			expect(await receivableOf(made[k]!.orderId)).toMatchObject({ status: 'written_off', outstanding: 0 });
		}
		// C is untouched.
		expect(await receivableOf(made.C!.orderId)).toMatchObject({ status: 'open', outstanding: 800_000 });
		// The ledger still balances: every journal entry's debits equal its credits.
		const unbalanced =
			await sql`select count(*)::int n from (select journal_entry_id from journal_lines group by journal_entry_id having sum(debit_centavos) <> sum(credit_centavos)) x`;
		expect(unbalanced[0]!.n).toBe(0);
	});

	test('check in and check out an OTA guest: the zero folio balance does not block check-out', async ({ page }) => {
		const orderId = await createOta(page, 'E', { startOffset: 0, nights: 1, row: 0, ota: 'Agoda', gross: '3000', pct: '15' });
		const bookingId = (await sql`select id from bookings where order_id = ${orderId}`)[0]!.id as string;
		await page.goto(`/${SLUG}/management/reservations/room/${bookingId}`);
		await page.waitForLoadState('networkidle');
		await page.screenshot({ path: 'test-results/ota-E-reservation.png', fullPage: true });

		// Pick the room to assign, then check in (the rate plan's security deposit is taken here).
		await page.locator('select').first().selectOption({ index: 1 });
		const checkIn = page.getByRole('button', { name: 'Check in', exact: true });
		await expect(checkIn).toBeVisible();
		await checkIn.click();
		await page.waitForTimeout(1500);
		await page.screenshot({ path: 'test-results/ota-E-after-checkin-click.png', fullPage: true });
		await expect
			.poll(async () => (await sql`select status from bookings where id = ${bookingId}`)[0]!.status, { timeout: 15_000 })
			.toBe('checked_in');

		// Check-out is on the front-desk room tile.
		const roomNumber = (await sql`select r.room_number from room_assignments ra join rooms r on r.id = ra.room_id join booking_rooms br on br.id = ra.booking_room_id where br.booking_id = ${bookingId}`)[0]!.room_number as string;
		await page.goto(`/${SLUG}/management/front-desk`);
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: new RegExp(`^Room ${roomNumber},`) }).click();
		await page.waitForTimeout(1500);
		await page.screenshot({ path: 'test-results/ota-E-room-open.png', fullPage: true });
		// The only thing blocking check-out is the rate plan's security deposit, not a folio balance.
		await expect(page.getByText(/Settle the ₱[\d.,]+ security deposit/)).toBeVisible();
		await expect(page.getByText(/outstanding balance/i)).toHaveCount(0);
		// The hotel's own rule: housekeeping must clear the room first, or an admin overrides it.
		const settle = page.getByRole('button', { name: 'Settle deposit', exact: true });
		if (await settle.isDisabled()) {
			await page.getByRole('button', { name: /Admin override/ }).click();
			await page.getByRole('button', { name: /Yes, skip the check and settle/ }).click();
		} else {
			await settle.click();
		}
		await expect(page.getByText(/Deposit refunded in full/)).toBeVisible();
		const checkOut = page.getByRole('button', { name: /^Check out( early)?$/ });
		await expect(checkOut).toBeVisible();
		await expect(checkOut).toBeEnabled();
		await checkOut.click();
		await expect
			.poll(async () => (await sql`select status from bookings where id = ${bookingId}`)[0]!.status, { timeout: 15_000 })
			.toBe('checked_out');
		// Still owed by the OTA, not by the guest.
		expect(await receivableOf(orderId)).toMatchObject({ status: 'open', outstanding: 300_000 });
	});
});
