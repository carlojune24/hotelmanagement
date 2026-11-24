import { expect, test, type Page } from 'playwright/test';
import { SLUG, staffLogin, uniqueGuest } from './helpers';
import { sql } from './db';
import { computeScPwdDiscount, computeScPwdShare, roomChargeOptions } from '../src/lib/sc-pwd-discount';

/**
 * Per-head Senior Citizen / PWD discount at the front desk (commit dffb5e5): room nights are discounted by
 * claimants ÷ guests (VAT removed, then % off); the claimant's own charges count in full; a promo and SC/PWD
 * never stack (the lower price wins); a claim can be reversed and re-applied; invoices print a summary.
 *
 *   E2E_HOTEL_SLUG=mmhotel pnpm exec playwright test e2e/sc-pwd-per-head.spec.ts
 *
 * Every expected peso below is worked out here from the booking's own stored subtotal / fees / VAT with the
 * written rule (RA 9994), never read back from the code under test.
 *
 * Side effects on the dev database (all test data): walk-in bookings for far-future dates paid by GCash
 * (each issues an Official Receipt), two invoices issued on print, two promo codes (deactivated at the end),
 * and PayMongo paused while the promo bookings are made (un-paused at the end). Guest names start "Sc Pwd".
 */

const RUN = Date.now().toString().slice(-6);
const TAG = RUN.replace(/\d/g, (d) => 'abcdefghij'[Number(d)]!); // guest names may not contain digits
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------------------------------------------------
// The rule, written out independently of the app.
// ---------------------------------------------------------------------------------------------------------

interface Money {
	subtotal: number;
	fees: number;
	vat: number;
}

/** A qualifying share of the room nights (VAT-inclusive), plus any claimant-own charges counted in full. */
function expectedDiscount(b: Money, n: number, guests: number, bps: number, ownCharges: { amount: number; tax: number }[] = []) {
	const net = b.subtotal + b.fees;
	const roomVat = net > 0 ? Math.round((b.vat * b.subtotal) / net) : 0;
	const roomAmount = b.subtotal + roomVat;
	const roomShare = Math.round((roomAmount * n) / guests);
	const roomShareVat = Math.round((roomVat * n) / guests);
	const share = roomShare + ownCharges.reduce((s, c) => s + c.amount, 0);
	const vatRemoved = roomShareVat + ownCharges.reduce((s, c) => s + c.tax, 0);
	const base = share - vatRemoved;
	const discount = Math.round((base * bps) / 10000);
	return { share, vatRemoved, base, discount, reduction: vatRemoved + discount };
}

// ---------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------

const senior = (name: string, id: string) => ({ type: 'senior_citizen', name, idNumber: id });
const pwd = (name: string, id: string) => ({ type: 'pwd', name, idNumber: id });

/** Posts a form action straight at the server, the way the page would, to prove the SERVER enforces the rules. */
async function act(page: Page, route: string, fields: Record<string, string | string[]>) {
	const body = new URLSearchParams();
	for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
	const res = await page.context().request.post(`/${SLUG}/management/${route}`, {
		data: body.toString(),
		headers: { 'content-type': 'application/x-www-form-urlencoded', origin: new URL(page.url()).origin, 'x-sveltekit-action': 'true' }
	});
	const text = await res.text();
	return { ok: text.includes('"type":"success"'), text };
}

function applyForm(bookingId: string, claimants: object[], guests: number, charges: string[]) {
	return {
		bookingId,
		scPwdClaimants: JSON.stringify(claimants),
		scPwdGuests: String(guests),
		scPwdChargesSent: '1',
		scPwdCharge: charges
	};
}

async function money(bookingId: string): Promise<Money & { occupancy: number }> {
	const [b] = await sql`select subtotal_centavos s, fees_centavos f, vat_centavos v, occupancy from bookings where id = ${bookingId}`;
	return { subtotal: Number(b!.s), fees: Number(b!.f), vat: Number(b!.v), occupancy: Number(b!.occupancy) };
}

const bps = async () => Number((await sql`select sc_pwd_discount_bps b from bir_settings limit 1`)[0]?.b ?? 2000);

async function claim(bookingId: string) {
	return (await sql`select * from sc_pwd_discounts where booking_id = ${bookingId} and reversed_at is null`)[0];
}

/** What the folio says the guest owes: live charges minus live payments (negative = the hotel owes the guest). */
async function balance(bookingId: string): Promise<number> {
	const [r] = await sql`
		select
			(select coalesce(sum(c.total_centavos), 0) from folio_charges c join folios f on f.id = c.folio_id
				where f.booking_id = ${bookingId} and c.voided_at is null)
			- (select coalesce(sum(p.amount_centavos), 0) from payments p join bookings b on b.order_id = p.order_id
				where b.id = ${bookingId} and p.status = 'paid' and p.voided_at is null) as bal`;
	return Number(r!.bal);
}

const orderOf = async (bookingId: string) => (await sql`select order_id from bookings where id = ${bookingId}`)[0]!.order_id as string;

/** A walk-in room booking, paid in full by GCash, with no discount. Returns the booking and order. */
async function walkIn(page: Page, nights: number | { checkIn: string; checkOut: string }, label: string, extra?: { name: string; qty: number; price: number }) {
	await page.goto(`/${SLUG}/management/front-desk`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'Walk-in', exact: true }).click();
	const sheet = page.locator('[data-slot="sheet-content"]');
	await expect(sheet.getByText('Walk-in booking')).toBeVisible();
	const range = typeof nights === 'number' ? { checkIn: day(nights), checkOut: day(nights + 1) } : nights;
	await sheet.locator('input[name="checkIn"]').fill(range.checkIn);
	await sheet.locator('input[name="checkOut"]').fill(range.checkOut);
	await sheet.getByRole('button', { name: 'Check availability' }).click();
	const add = sheet.getByRole('button', { name: 'Add', exact: true });
	await expect(add.first()).toBeVisible();
	await add.first().click();
	await expect(sheet.getByRole('button', { name: 'OTA booking' })).toBeVisible();
	await fillWalkInGuest(sheet, `Sc Pwd ${label} ${TAG}`);
	if (extra) {
		await sheet.locator('#wiExtraName').fill(extra.name);
		await sheet.locator('#wiExtraQty').fill(String(extra.qty));
		await sheet.locator('#wiExtraPrice').fill(String(extra.price));
		await sheet.getByRole('button', { name: 'Add', exact: true }).last().click();
		await expect(sheet.getByText(extra.name)).toBeVisible();
	}
	await payTotalDue(sheet);
	await sheet.getByRole('button', { name: 'Create booking & record payment' }).click();
	await page.waitForURL(/\/management\/transactions\//);
	const orderId = page.url().match(/transactions\/([0-9a-f-]{36})/)![1]!;
	const [b] = await sql`select id from bookings where order_id = ${orderId} limit 1`;
	return { orderId, bookingId: b!.id as string };
}

async function fillWalkInGuest(sheet: ReturnType<Page['locator']>, name: string) {
	const guest = uniqueGuest();
	await sheet.locator('#wiFullName').fill(name);
	await sheet.locator('#wiEmail').fill(guest.email);
	await sheet.locator('#wiPhone').fill(guest.phone);
	await sheet.locator('select[name="method"]').selectOption('gcash');
	await sheet.locator('input[name="referenceNo"]').fill(`E2E-SCPWD-${RUN}`);
}

async function payTotalDue(sheet: ReturnType<Page['locator']>): Promise<number> {
	// The "Price summary" only exists once there are extras or a discount; a plain walk-in shows its total in the cart.
	const summary = sheet.getByLabel('Price summary').getByText('Total due now').locator('xpath=following-sibling::dd');
	const dueText = (await summary.count())
		? await summary.innerText()
		: ((await sheet.innerText()).match(/Total\s*\n\s*₱([\d,]+\.\d{2})/)?.[1] ?? '');
	expect(dueText, 'could not read what the walk-in costs').not.toBe('');
	const due = Math.round(parseFloat(dueText.replace(/[^\d.]/g, '')) * 100);
	await sheet.locator('input[name="tendered"]').fill((due / 100).toFixed(2));
	return due;
}

async function setPaused(page: Page, paused: boolean) {
	await staffLogin(page);
	await page.goto(`/${SLUG}/management/settings/payments-email`, { waitUntil: 'networkidle' });
	const toggle = page.getByRole('button', { name: paused ? 'Pause online payments' : 'Resume online payments' });
	if (await toggle.count()) await toggle.click();
	await expect(page.getByRole('button', { name: paused ? 'Resume online payments' : 'Pause online payments' })).toBeVisible();
}

// ---------------------------------------------------------------------------------------------------------
// The rule itself, with VAT on. No browser: the dev hotel is not VAT-registered (VAT is 0 on every booking
// there), so the VAT-removal half of the rule can only be proved here.
// ---------------------------------------------------------------------------------------------------------

test.describe('the discount rule (pure math, VAT on)', () => {
	// A tiny seeded generator so a failure can be reproduced.
	const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

	test('BIR worked example: ₱3,360 room (₱3,000 + 12% VAT), 1 of 3 guests is a Senior', () => {
		const r = computeScPwdShare({ lines: [{ key: 'room', label: 'Room', amountCentavos: 336_000, vatCentavos: 36_000, perHead: true }], claimants: 1, guests: 3, discountBps: 2000 });
		expect(r.shareCentavos).toBe(112_000); // a third of the room
		expect(r.vatRemovedCentavos).toBe(12_000); // the VAT inside that third
		expect(r.baseAmountCentavos).toBe(100_000); // the VAT-exempt sale
		expect(r.discountCentavos).toBe(20_000); // 20% of ₱1,000
		expect(r.totalReductionCentavos).toBe(32_000);
		expect(336_000 - r.totalReductionCentavos).toBe(304_000); // the guests pay ₱3,040 for the room
	});

	test('a whole-room claim gives the same centavos as the earlier whole-room rule', () => {
		const next = rng(7);
		for (let i = 0; i < 500; i++) {
			const subtotal = 10_000 + Math.floor(next() * 3_000_000);
			const vat = next() < 0.3 ? 0 : Math.round(subtotal * 0.12);
			const bps = [0, 1000, 2000, 5000][Math.floor(next() * 4)]!;
			const guests = 1 + Math.floor(next() * 6);
			const old = computeScPwdDiscount({ subtotalCentavos: subtotal, feesCentavos: 0, vatCentavos: vat, discountBps: bps });
			const now = computeScPwdShare({ lines: [{ key: 'room', label: 'Room', amountCentavos: subtotal + vat, vatCentavos: vat, perHead: true }], claimants: guests, guests, discountBps: bps });
			expect(now.baseAmountCentavos, `case ${i}`).toBe(old.baseAmountCentavos);
			expect(now.vatRemovedCentavos, `case ${i}`).toBe(old.vatRemovedCentavos);
			expect(now.discountCentavos, `case ${i}`).toBe(old.discountCentavos);
			expect(now.totalReductionCentavos, `case ${i}`).toBe(old.totalReductionCentavos);
		}
	});

	test('invariants hold for thousands of random bookings', () => {
		const next = rng(42);
		for (let i = 0; i < 3000; i++) {
			const room = 10_000 + Math.floor(next() * 3_000_000);
			const vat = next() < 0.3 ? 0 : Math.round(room * 0.12);
			const own = next() < 0.5 ? { key: 'charge:x', label: 'Breakfast', amountCentavos: 10_000 + Math.floor(next() * 90_000), vatCentavos: 0, perHead: false } : null;
			const lines = [{ key: 'room', label: 'Room', amountCentavos: room + vat, vatCentavos: vat, perHead: true }, ...(own ? [own] : [])];
			const bps = [0, 500, 1000, 2000, 5000, 10000][Math.floor(next() * 6)]!;
			const guests = 1 + Math.floor(next() * 8);
			const n = Math.floor(next() * (guests + 1));
			const r = computeScPwdShare({ lines, claimants: n, guests, discountBps: bps });
			const ctx = `case ${i}: ${JSON.stringify({ room, vat, own: !!own, bps, guests, n })}`;
			expect(r.baseAmountCentavos + r.vatRemovedCentavos, ctx).toBe(r.shareCentavos); // base + VAT = the share, exactly
			expect(r.discountCentavos, ctx).toBe(Math.round((r.baseAmountCentavos * bps) / 10000));
			expect(r.totalReductionCentavos, ctx).toBe(r.vatRemovedCentavos + r.discountCentavos);
			expect(r.totalReductionCentavos, ctx).toBeGreaterThanOrEqual(0);
			expect(r.totalReductionCentavos, ctx).toBeLessThanOrEqual(r.shareCentavos); // never takes off more than the share
			if (n === 0) expect(r.totalReductionCentavos, ctx).toBe(0); // no Senior/PWD guest, no discount
			if (bps === 0) expect(r.discountCentavos, ctx).toBe(0); // 0% still removes the VAT, nothing more
			// One more Senior/PWD guest never lowers the saving.
			if (n < guests) expect(computeScPwdShare({ lines, claimants: n + 1, guests, discountBps: bps }).totalReductionCentavos, ctx).toBeGreaterThanOrEqual(r.totalReductionCentavos);
		}
	});

	test('guests and claimants are clamped, never trusted: more claimants than guests = the whole room', () => {
		const line = [{ key: 'room', label: 'Room', amountCentavos: 224_000, vatCentavos: 24_000, perHead: true }];
		const all = computeScPwdShare({ lines: line, claimants: 4, guests: 4, discountBps: 2000 });
		expect(computeScPwdShare({ lines: line, claimants: 9, guests: 4, discountBps: 2000 })).toEqual(all);
		expect(computeScPwdShare({ lines: line, claimants: -3, guests: 4, discountBps: 2000 }).totalReductionCentavos).toBe(0);
		expect(computeScPwdShare({ lines: line, claimants: 1, guests: 0, discountBps: 2000 }).shareCentavos).toBe(224_000); // 0 guests counts as 1
	});

	test('the room is split by head but the claimants\' own extra bed counts in full', () => {
		const room = { key: 'room', label: 'Room', amountCentavos: 224_000, vatCentavos: 24_000, perHead: true };
		const bed = { key: 'extra_bed', label: 'Extra bed', amountCentavos: 56_000, vatCentavos: 6_000, perHead: false };
		const r = computeScPwdShare({ lines: [room, bed], claimants: 1, guests: 4, discountBps: 2000 });
		expect(r.lines.find((l) => l.key === 'room')!.shareCentavos).toBe(56_000); // a quarter of the room
		expect(r.lines.find((l) => l.key === 'extra_bed')!.shareCentavos).toBe(56_000); // all of the bed
		expect(r.vatRemovedCentavos).toBe(6_000 + 6_000);
	});

	test('splitting a booking into room nights and extra bed keeps every centavo of VAT', () => {
		const next = rng(99);
		for (let i = 0; i < 1000; i++) {
			const subtotal = 50_000 + Math.floor(next() * 2_000_000);
			const fees = Math.floor(next() * 100_000);
			const vat = Math.round((subtotal + fees) * 0.12);
			const bed = Math.floor(next() * 150_000);
			const o = roomChargeOptions({ subtotalCentavos: subtotal, feesCentavos: fees, vatCentavos: vat, extraBedCentavos: bed });
			const room = o.find((x) => x.key === 'room')!;
			const bedOpt = o.find((x) => x.key === 'extra_bed');
			const ctx = `case ${i}: ${JSON.stringify({ subtotal, fees, vat, bed })}`;
			expect(room.perHead, ctx).toBe(true);
			expect(room.defaultOn, ctx).toBe(true); // ticked by default
			if (bed > 0 && fees > 0) {
				expect(bedOpt, ctx).toBeDefined();
				expect(bedOpt!.perHead, ctx).toBe(false);
				expect(bedOpt!.defaultOn, ctx).toBe(false); // never ticked by default
				// A bed priced above the booking's fees is capped at the fees: it can't exceed what was charged.
				expect(bedOpt!.amountCentavos - bedOpt!.vatCentavos, ctx).toBe(Math.min(bed, fees));
				expect(Math.abs(room.vatCentavos + bedOpt!.vatCentavos - Math.round((vat * (subtotal + Math.min(bed, fees))) / (subtotal + fees))), ctx).toBeLessThanOrEqual(1);
			} else {
				expect(bedOpt, ctx).toBeUndefined();
			}
			expect(room.amountCentavos - room.vatCentavos, ctx).toBe(subtotal); // the room's VAT-exclusive price is exactly its subtotal
		}
	});
});

// ---------------------------------------------------------------------------------------------------------

test.describe.serial('SC/PWD per head', () => {
	test.setTimeout(240_000);
	let B1 = '';
	let B2 = '';
	let B3 = '';
	let rate = 2000;
	const promoCodes: string[] = [];

	test.beforeAll(async ({ browser }) => {
		const page = await browser.newPage();
		await staffLogin(page);
		({ bookingId: B1 } = await walkIn(page, 140, 'One'));
		({ bookingId: B2 } = await walkIn(page, 142, 'Two', { name: 'Extra breakfast', qty: 2, price: 350 }));
		({ bookingId: B3 } = await walkIn(page, 144, 'Three'));
		rate = await bps();
		await page.close();
	});

	test.afterAll(async ({ browser }) => {
		const page = await browser.newPage();
		await setPaused(page, false).catch(() => undefined);
		// Switch the test promo codes off so they can't be used by anyone.
		const id = (c: string) => sql`select id from promo_codes where code = ${c}`;
		for (const code of promoCodes) {
			const [p] = await id(code);
			if (p) await act(page, 'settings/rates?/updatePromoCode', { id: p.id as string, code, discountType: 'percentage', discountPct: '1', isActive: '' }).catch(() => undefined);
		}
		await page.close();
	});

	test.beforeEach(async ({ page }) => {
		await staffLogin(page);
	});

	// -------------------------------------------------------------------------------------------------
	test('the server refuses bad input and changes nothing', async ({ page }) => {
		const room = ['room'];
		const bad: [string, ReturnType<typeof applyForm>, RegExp][] = [
			['no Senior/PWD guest', applyForm(B1, [], 2, room), /at least one Senior Citizen\/PWD guest/],
			['a guest with no name', applyForm(B1, [senior('', 'OSCA-1')], 2, room), /Enter each Senior\/PWD guest's name/],
			['a guest with no ID number', applyForm(B1, [senior('Lola Ana', '')], 2, room), /Enter the OSCA\/PWD ID number for Lola Ana/],
			['more Senior/PWD guests than guests in the room', applyForm(B1, [senior('A One', '1'), pwd('B Two', '2')], 1, room), /can't be fewer than the Senior\/PWD guests \(2\)/],
			['no charge ticked', applyForm(B1, [senior('Lola Ana', 'OSCA-1')], 2, []), /Tick at least one charge/],
			['a charge key that does not exist', applyForm(B1, [senior('Lola Ana', 'OSCA-1')], 2, ['charge:00000000-0000-0000-0000-000000000000']), /Tick at least one charge/]
		];
		for (const [label, form, message] of bad) {
			const r = await act(page, 'front-desk?/flagScPwd', form);
			expect(r.ok, `${label} must be refused`).toBe(false);
			expect(r.text, label).toMatch(message);
		}
		const noBooking = await act(page, 'front-desk?/flagScPwd', { scPwdClaimants: '[]' });
		expect(noBooking.ok).toBe(false);

		// Nothing was written: no claim, no discount line, the folio is exactly as the walk-in left it.
		expect(await claim(B1)).toBeUndefined();
		const [{ n }] = await sql`select count(*)::int n from folio_charges c join folios f on f.id = c.folio_id where f.booking_id = ${B1} and c.source = 'sc_pwd'`;
		expect(n).toBe(0);
		expect(await balance(B1)).toBe(0);
	});

	// -------------------------------------------------------------------------------------------------
	test('1 of 3 guests: only that share of the room nights is VAT-exempt and discounted, to the centavo', async ({ page }) => {
		const m = await money(B1);
		const paidBefore = await balance(B1); // 0: paid in full at the walk-in
		const r = await act(page, 'front-desk?/flagScPwd', applyForm(B1, [senior('Lola Ana', 'OSCA-1001')], 3, ['room']));
		expect(r.ok, r.text).toBe(true);

		const e = expectedDiscount(m, 1, 3, rate);
		expect(e.reduction).toBeGreaterThan(0);
		const c = (await claim(B1))!;
		expect(Number(c.vat_removed_centavos)).toBe(e.vatRemoved);
		expect(Number(c.discount_centavos)).toBe(e.discount);
		expect(Number(c.base_amount_centavos)).toBe(e.base);
		expect(Number(c.guest_count)).toBe(3);
		expect(c.discount_bps).toBe(rate);
		expect(c.claimant_type).toBe('senior_citizen');
		expect((c.claimants as { name: string }[]).map((x) => x.name)).toEqual(['Lola Ana']);

		// The ONE negative folio line equals the whole reduction, and says who and how many.
		const [line] = await sql`select total_centavos t, source, description, voided_at from folio_charges where id = ${c.folio_charge_id as string}`;
		expect(Number(line!.t)).toBe(-e.reduction);
		expect(line!.source).toBe('sc_pwd');
		expect(line!.voided_at).toBeNull();
		expect(line!.description).toMatch(new RegExp(`${rate / 100}%, 1 of 3 guests`));
		expect(line!.description).toContain('Lola Ana');
		expect(line!.description).toContain('OSCA-1001');

		// The guest had paid in full, so the discount leaves a credit the hotel owes back, exactly the reduction.
		expect(await balance(B1)).toBe(paidBefore - e.reduction);

		const [a] = await sql`select count(*)::int n from audit_log where entity_id = ${B1} and action = 'sc_pwd.apply'`;
		expect(a!.n).toBe(1);
	});

	test('a second discount on the same booking is refused', async ({ page }) => {
		const r = await act(page, 'front-desk?/flagScPwd', applyForm(B1, [pwd('Mang Jose', 'PWD-77')], 3, ['room']));
		expect(r.ok).toBe(false);
		expect(r.text).toMatch(/already applied/);
		const [{ n }] = await sql`select count(*)::int n from sc_pwd_discounts where booking_id = ${B1} and reversed_at is null`;
		expect(n).toBe(1);
	});

	// -------------------------------------------------------------------------------------------------
	test('2 of 3 guests (Senior + PWD) with their own extra breakfast counted in full', async ({ page }) => {
		const m = await money(B2);
		const [x] = await sql`select c.id, c.total_centavos t, c.tax_centavos tax from folio_charges c join folios f on f.id = c.folio_id
			where f.booking_id = ${B2} and c.description = 'Extra breakfast' and c.voided_at is null`;
		expect(Number(x!.t)).toBe(70_000);
		const own = { amount: Number(x!.t), tax: Number(x!.tax) };

		const r = await act(page, 'front-desk?/flagScPwd', applyForm(B2, [senior('Lola Ana', 'OSCA-2002'), pwd('Mang Jose', 'PWD-3003')], 3, ['room', `charge:${x!.id}`]));
		expect(r.ok, r.text).toBe(true);

		const e = expectedDiscount(m, 2, 3, rate, [own]);
		const c = (await claim(B2))!;
		expect(Number(c.vat_removed_centavos)).toBe(e.vatRemoved);
		expect(Number(c.discount_centavos)).toBe(e.discount);
		expect(Number(c.base_amount_centavos)).toBe(e.base);
		expect((c.claimants as { type: string }[]).map((k) => k.type)).toEqual(['senior_citizen', 'pwd']);
		const lines = c.lines as { key: string; perHead: boolean; shareCentavos: number }[];
		expect(lines.map((l) => l.key)).toEqual(['room', `charge:${x!.id}`]);
		expect(lines[1]!.perHead).toBe(false);
		expect(lines[1]!.shareCentavos).toBe(own.amount); // the extra is theirs in full, not split by head
		const [line] = await sql`select total_centavos t from folio_charges where id = ${c.folio_charge_id as string}`;
		expect(Number(line!.t)).toBe(-e.reduction);
		// A 2-of-3 share is genuinely larger than a 1-of-3 share of the same room: the head count matters.
		expect(expectedDiscount(m, 2, 3, rate).reduction).toBeGreaterThan(expectedDiscount(m, 1, 3, rate).reduction);
	});

	// -------------------------------------------------------------------------------------------------
	test('reversing puts the bill back exactly, and the discount can be applied again', async ({ page }) => {
		const m = await money(B3);
		const e = expectedDiscount(m, 1, 2, rate);
		expect((await act(page, 'front-desk?/flagScPwd', applyForm(B3, [senior('Lola Ana', 'OSCA-4004')], 2, ['room']))).ok).toBe(true);
		expect(await balance(B3)).toBe(-e.reduction);
		const first = (await claim(B3))!;

		const rev = await act(page, 'front-desk?/reverseScPwd', { bookingId: B3, reason: 'Wrong ID typed' });
		expect(rev.ok, rev.text).toBe(true);
		expect(await claim(B3)).toBeUndefined();
		const [old] = await sql`select reversed_at, reversed_reason from sc_pwd_discounts where id = ${first.id as string}`;
		expect(old!.reversed_at).not.toBeNull();
		expect(old!.reversed_reason).toBe('Wrong ID typed');
		const [voided] = await sql`select voided_at from folio_charges where id = ${first.folio_charge_id as string}`;
		expect(voided!.voided_at).not.toBeNull();
		expect(await balance(B3)).toBe(0); // back to paid-in-full, nothing owed either way
		const [a] = await sql`select count(*)::int n from audit_log where entity_id = ${B3} and action = 'sc_pwd.reverse'`;
		expect(a!.n).toBe(1);

		const again = await act(page, 'front-desk?/reverseScPwd', { bookingId: B3 });
		expect(again.ok).toBe(false);
		expect(again.text).toMatch(/No active Senior Citizen\/PWD discount/);

		// Re-apply with the corrected ID: a fresh claim, same money.
		expect((await act(page, 'front-desk?/flagScPwd', applyForm(B3, [senior('Lola Ana', 'OSCA-4005')], 2, ['room']))).ok).toBe(true);
		expect((await claim(B3))!.id_number).toBe('OSCA-4005');
		expect(await balance(B3)).toBe(-e.reduction);
	});

	// -------------------------------------------------------------------------------------------------
	test('only a confirmed or checked-in booking can carry the discount', async ({ page }) => {
		// An online booking nobody has paid yet is still "pending payment".
		await page.goto(`/${SLUG}?checkIn=${day(150)}&checkOut=${day(151)}&adults=2&children=0`, { waitUntil: 'networkidle' });
		const reserve = page.getByRole('button', { name: /^Reserve$/ }).first();
		test.skip((await reserve.count()) === 0, 'No rate can be reserved for these dates.');
		await reserve.click();
		const g = uniqueGuest();
		await page.locator('#fullName').fill(g.name);
		await page.locator('#email').fill(g.email);
		await page.locator('#phone').fill(g.phone);
		await page.getByRole('button', { name: /Continue to review/i }).click();
		await expect(page).toHaveURL(/\/review\//);
		const orderId = new URL(page.url()).pathname.split('/').pop()!;
		const [b] = await sql`select id, status from bookings where order_id = ${orderId}`;
		expect(b!.status).toBe('pending_payment');

		// (staff are already signed in by beforeEach; the guest pages work in the same session)
		const r = await act(page, 'front-desk?/flagScPwd', applyForm(b!.id as string, [senior('Lola Ana', 'OSCA-5005')], 2, ['room']));
		expect(r.ok).toBe(false);
		expect(r.text).toMatch(/Only a confirmed or checked-in booking/);
		expect(await claim(b!.id as string)).toBeUndefined();
	});

	// -------------------------------------------------------------------------------------------------
	test('a promo and SC/PWD never stack: the lower price wins, both ways', async ({ page, browser }) => {
		const staff = await browser.newPage();
		await setPaused(staff, true); // so an online booking confirms without PayMongo
		const mk = async (code: string, pct: string) => {
			const r = await act(staff, 'settings/rates?/createPromoCode', { code, discountType: 'percentage', discountPct: pct, description: 'E2E sc/pwd' });
			expect(r.ok, r.text).toBe(true);
			promoCodes.push(code);
		};
		const small = `SCPWDSMALL${RUN}`;
		const big = `SCPWDBIG${RUN}`;
		await mk(small, '1'); // 1% off: far less than the SC/PWD saving
		await mk(big, '60'); // 60% off: more than the SC/PWD saving
		await staff.close();

		const book = async (code: string, off: number) => {
			await page.goto(`/${SLUG}?checkIn=${day(off)}&checkOut=${day(off + 1)}&adults=2&children=0`, { waitUntil: 'networkidle' });
			await page.getByRole('button', { name: /^Reserve$/ }).first().click();
			await page.getByLabel('Promo code').first().fill(code);
			const g = uniqueGuest();
			await page.locator('#fullName').fill(g.name);
			await page.locator('#email').fill(g.email);
			await page.locator('#phone').fill(g.phone);
			await page.getByRole('button', { name: /Continue to review/i }).click();
			await expect(page).toHaveURL(/\/review\//);
			await page.getByRole('button', { name: /Confirm booking — pay .* at the hotel/ }).click();
			await expect(page).toHaveURL(/\/confirmation\//);
			const orderId = new URL(page.url()).pathname.split('/').pop()!;
			const [b] = await sql`select id, discount_centavos d, status from bookings where order_id = ${orderId}`;
			expect(b!.status).toBe('confirmed');
			expect(Number(b!.d)).toBeGreaterThan(0); // the promo really applied
			return { id: b!.id as string, promo: Number(b!.d) };
		};
		const lowPromo = await book(small, 152);
		const highPromo = await book(big, 154);

		// Small promo: SC/PWD is the lower price, so it replaces the promo (the promo is added back on its own line).
		const mSmall = await money(lowPromo.id);
		const eSmall = expectedDiscount(mSmall, 1, 2, rate);
		expect(eSmall.reduction).toBeGreaterThan(lowPromo.promo);
		// An unpaid online booking has no folio until something is posted to it, so the starting bill is its own total.
		const before = Number((await sql`select total_centavos t from bookings where id = ${lowPromo.id}`)[0]!.t);
		const ok = await act(page, 'front-desk?/flagScPwd', applyForm(lowPromo.id, [senior('Lola Ana', 'OSCA-6006')], 2, ['room']));
		expect(ok.ok, ok.text).toBe(true);
		const c = (await claim(lowPromo.id))!;
		expect(c.promo_dropped_charge_id).not.toBeNull();
		const [back] = await sql`select total_centavos t, source from folio_charges where id = ${c.promo_dropped_charge_id as string}`;
		expect(Number(back!.t)).toBe(lowPromo.promo); // the promo given back
		expect(back!.source).toBe('sc_pwd');
		expect(await balance(lowPromo.id)).toBe(before + lowPromo.promo - eSmall.reduction); // net: only the difference
		// Reversing removes BOTH lines, so the promo price is back.
		expect((await act(page, 'front-desk?/reverseScPwd', { bookingId: lowPromo.id })).ok).toBe(true);
		expect(await balance(lowPromo.id)).toBe(before);
		const [pv] = await sql`select voided_at from folio_charges where id = ${c.promo_dropped_charge_id as string}`;
		expect(pv!.voided_at).not.toBeNull();

		// Big promo: the promo is already the lower price, so SC/PWD is refused and the folio is untouched.
		const eBig = expectedDiscount(await money(highPromo.id), 1, 2, rate);
		expect(eBig.reduction).toBeLessThanOrEqual(highPromo.promo);
		const bigTotal = Number((await sql`select total_centavos t from bookings where id = ${highPromo.id}`)[0]!.t);
		const no = await act(page, 'front-desk?/flagScPwd', applyForm(highPromo.id, [senior('Lola Ana', 'OSCA-7007')], 2, ['room']));
		expect(no.ok).toBe(false);
		expect(no.text).toMatch(/promo already gives a lower price/);
		expect(await claim(highPromo.id)).toBeUndefined();
		// Nothing was posted: no discount lines, and the bill is still the promo price. (The refused request reloads
		// the room panel, which creates the folio at the booking's total; that is not a change to the bill.)
		const [{ n: lines }] = await sql`select count(*)::int n from folio_charges c join folios f on f.id = c.folio_id where f.booking_id = ${highPromo.id} and c.source = 'sc_pwd'`;
		expect(lines).toBe(0);
		expect(await balance(highPromo.id)).toBe(bigTotal);
	});

	// -------------------------------------------------------------------------------------------------
	test('the printed invoice carries the summary, the claimant IDs and a signature line; a reversed claim prints none', async ({ page }) => {
		const m = await money(B2);
		const e = expectedDiscount(m, 2, 3, rate, [{ amount: 70_000, tax: Number((await sql`select tax_centavos t from folio_charges c join folios f on f.id = c.folio_id where f.booking_id = ${B2} and c.description = 'Extra breakfast'`)[0]!.t) }]);

		await page.goto(`/${SLUG}/print/invoice/for/booking/${B2}?format=a4`);
		const body = page.locator('body');
		await expect(body.getByText(/Senior Citizen \/ PWD discount — 2 of 3 guests/)).toBeVisible();
		await expect(body.getByText(/Senior Citizen: Lola Ana — OSCA ID OSCA-2002/)).toBeVisible();
		await expect(body.getByText(/PWD: Mang Jose — PWD ID PWD-3003/)).toBeVisible();
		await expect(body.getByText('Signature of Senior Citizen / PWD')).toBeVisible();
		const text = await body.innerText();
		// Documents print money as "PHP 1,966.00". (VAT removed is 0 on this non-VAT hotel, so that row is not printed.)
		const php = (c: number) => `PHP ${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
		for (const v of [e.share, e.base, e.discount]) expect(text, `printed ${php(v)}`).toContain(php(v));
		expect(e.vatRemoved).toBe(0);
		expect(text).not.toContain('VAT removed');

		// The issued invoice's own figures add up: vatable + VAT + exempt + zero-rated = gross, and gross = the lines.
		const [d] = await sql`select snapshot from documents where booking_id = ${B2} and type = 'invoice' order by issued_at desc limit 1`;
		const snap = d!.snapshot as {
			totals: { vatableSalesCentavos: number; vatExemptSalesCentavos: number; zeroRatedSalesCentavos: number; vatCentavos: number; grossCentavos: number };
			lines: { amountCentavos: number }[];
			scPwd: { claimants: unknown[]; discountCentavos: number; vatRemovedCentavos: number }[];
		};
		const t = snap.totals;
		expect(t.vatableSalesCentavos + t.vatCentavos + t.vatExemptSalesCentavos + t.zeroRatedSalesCentavos).toBe(t.grossCentavos);
		expect(snap.lines.reduce((s, l) => s + l.amountCentavos, 0)).toBe(t.grossCentavos);
		expect(t.vatExemptSalesCentavos).toBeGreaterThan(0); // the Senior/PWD share is a VAT-exempt sale
		expect(snap.scPwd).toHaveLength(1);
		expect(snap.scPwd[0]!.claimants).toHaveLength(2);
		expect(snap.scPwd[0]!.discountCentavos).toBe(e.discount);

		// B3's claim is reversed here, so its invoice must not claim a discount that no longer exists.
		expect((await act(page, 'front-desk?/reverseScPwd', { bookingId: B3, reason: 'print check' })).ok).toBe(true);
		await page.goto(`/${SLUG}/print/invoice/for/booking/${B3}?format=a4`);
		await expect(page.getByText(/Total|Amount/i).first()).toBeVisible();
		await expect(page.getByText(/Senior Citizen \/ PWD discount/)).toHaveCount(0);
		await expect(page.getByText('Signature of Senior Citizen / PWD')).toHaveCount(0);
	});

	// -------------------------------------------------------------------------------------------------
	test('check-in form and front-desk panel: flag at check-in, see the refund owed, reverse, re-apply, check out', async ({ page }) => {
		// A booking for tonight, paid in full, then checked in from the reservation page with the SC/PWD box ticked.
		const [h] = await sql`select timezone from hotels where slug = ${SLUG}`;
		const fmt = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: h!.timezone as string }).format(new Date(ms));
		const { bookingId } = await walkIn(page, { checkIn: fmt(Date.now()), checkOut: fmt(Date.now() + 86_400_000) }, 'Live');
		const m = await money(bookingId);
		const e = expectedDiscount(m, 1, 2, rate);

		await page.goto(`/${SLUG}/management/reservations/room/${bookingId}`, { waitUntil: 'networkidle' });
		const form = page.locator('form#check-in');
		await form.locator('select[name="roomId"]').first().selectOption({ index: 1 });
		await form.getByLabel('Senior Citizen or PWD in this room (BIR discount)').check();
		await form.locator('#scPwdId0').fill('OSCA-1234');
		await form.locator('#scPwdGuests').fill('2');
		await form.getByRole('button', { name: 'Check in' }).click();
		await expect.poll(async () => (await sql`select status from bookings where id = ${bookingId}`)[0]!.status, { timeout: 20_000 }).toBe('checked_in');
		await expect.poll(async () => !!(await claim(bookingId)), { timeout: 10_000 }).toBe(true);

		const c = (await claim(bookingId))!;
		expect(Number(c.vat_removed_centavos) + Number(c.discount_centavos)).toBe(e.reduction);
		expect(Number(c.guest_count)).toBe(2);
		expect((c.claimants as { name: string }[])[0]!.name).toMatch(/^Sc Pwd Live/); // blank name = the booking guest
		expect(await balance(bookingId)).toBe(-e.reduction); // paid in full, then discounted: the hotel owes the difference

		// The room's panel on the front desk shows the claim and the refund owed, and can reverse and re-apply it.
		const [r] = await sql`select r.room_number from room_assignments ra join booking_rooms br on br.id = ra.booking_room_id join rooms r on r.id = ra.room_id where br.booking_id = ${bookingId} limit 1`;
		const room = String(r!.room_number);
		const openPanel = async () => {
			await page.goto(`/${SLUG}/management/front-desk`, { waitUntil: 'networkidle' });
			await page.locator('button', { hasText: new RegExp(`\\b${room}\\b`) }).first().click();
			await page.getByRole('button', { name: /Guest ID & SC\/PWD discount/ }).click();
		};
		// The panel folds its accordion shut after every action; open it again when it has.
		const trigger = page.getByRole('button', { name: /Guest ID & SC\/PWD discount/ });
		const reopen = async () => {
			if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
		};
		await openPanel();
		await expect(page.getByText(/OSCA-1234 — 1 of 2 guests/)).toBeVisible();
		await expect(page.getByText(new RegExp(`paid ${peso(e.reduction).replace(/[₱.]/g, '\\$&')} more than the discounted bill`))).toBeVisible();

		await page.getByRole('button', { name: 'Reverse' }).click();
		await expect.poll(async () => await claim(bookingId)).toBeUndefined();
		await reopen();
		await expect(page.getByRole('button', { name: /Flag Senior Citizen \/ PWD/ })).toBeVisible();
		expect(await claim(bookingId)).toBeUndefined();
		expect(await balance(bookingId)).toBe(0);

		// Re-apply from the panel itself, as 2 of 2 guests this time, and the numbers follow.
		await page.getByRole('button', { name: /Flag Senior Citizen \/ PWD/ }).click();
		await page.locator('#scPwdId0').fill('OSCA-4321');
		await page.locator('#scPwdGuests').fill('1');
		await expect(page.getByText('1 of 1 share of the room is VAT-exempt')).toBeVisible();
		await page.getByRole('button', { name: 'Apply discount' }).click();
		await expect.poll(async () => !!(await claim(bookingId)), { timeout: 10_000 }).toBe(true);
		const full = expectedDiscount(m, 1, 1, rate);
		expect(Number((await claim(bookingId))!.guest_count)).toBe(1);
		expect(await balance(bookingId)).toBe(-full.reduction);
		expect(full.reduction).toBeGreaterThan(e.reduction); // the whole room is discounted, so the saving is larger

		// Clean up like staff would: take the discount off (so no refund is owed), settle the deposit, check out.
		await reopen(); // folded shut again after "Apply discount"
		await page.getByRole('button', { name: 'Reverse' }).click();
		await expect.poll(async () => await claim(bookingId)).toBeUndefined();
		await page.getByRole('heading', { name: 'Security deposit' }).waitFor({ timeout: 10_000 }).catch(() => undefined);
		const settle = page.getByRole('button', { name: 'Settle deposit' });
		if (await settle.count()) {
			if (await settle.isDisabled()) {
				await page.getByRole('button', { name: /Admin override/ }).click();
				await page.getByRole('button', { name: /Yes, skip the check and settle/ }).click();
			} else await settle.click();
			await expect(page.getByText(/Settled — /).first()).toBeVisible();
		}
		await page.getByRole('button', { name: /^Check out( early)?$/ }).click();
		await expect.poll(async () => (await sql`select status from bookings where id = ${bookingId}`)[0]!.status, { timeout: 20_000 }).toBe('checked_out');
	});

	// -------------------------------------------------------------------------------------------------
	test('walk-in sheet: the live preview, adding/removing guests, and what blocks "Create"', async ({ page }) => {
		await page.goto(`/${SLUG}/management/front-desk`);
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: 'Walk-in', exact: true }).click();
		const sheet = page.locator('[data-slot="sheet-content"]');
		await sheet.locator('input[name="checkIn"]').fill(day(160));
		await sheet.locator('input[name="checkOut"]').fill(day(161));
		await sheet.getByRole('button', { name: 'Check availability' }).click();
		await sheet.getByRole('button', { name: 'Add', exact: true }).first().click();
		await expect(sheet.getByRole('button', { name: 'OTA booking' })).toBeVisible();
		await fillWalkInGuest(sheet, `Sc Pwd Ui ${TAG}`);
		await sheet.getByLabel('Senior Citizen / PWD discount').check();

		const create = sheet.getByRole('button', { name: 'Create booking & record payment' });
		const goesDown = sheet.getByText('Bill goes down by').locator('xpath=following-sibling::dd');

		await sheet.locator('#scPwdGuests').fill('3');
		await sheet.locator('#scPwdId0').fill('OSCA-8008');
		await expect(sheet.getByText('1 of 3 share of the room is VAT-exempt')).toBeVisible();
		const oneOfThree = await goesDown.innerText();

		// Add a PWD guest: the share grows from 1/3 to 2/3 and the preview moves with it.
		await sheet.getByRole('button', { name: 'Add guest' }).click();
		await expect(create).toBeDisabled(); // the new guest has no name or ID yet
		await sheet.locator('#scPwdName1').fill('Mang Jose');
		await sheet.locator('#scPwdId1').fill('PWD-9009');
		await sheet.locator('[aria-label="Guest 2 is a"]').getByText('PWD').click();
		await expect(sheet.getByText('2 of 3 share of the room is VAT-exempt')).toBeVisible();
		await expect(sheet.getByText('PWD ID no.')).toBeVisible();
		const twoOfThree = await goesDown.innerText();
		const n = (t: string) => parseFloat(t.replace(/[^\d.]/g, ''));
		expect(n(twoOfThree)).toBeGreaterThan(n(oneOfThree));
		expect(n(twoOfThree)).toBeCloseTo(n(oneOfThree) * 2, 0); // a straight 2x, to within a peso of rounding
		await expect(create).toBeEnabled();

		// Fewer guests than Senior/PWD guests, and nothing ticked: both block, with a reason.
		await sheet.locator('#scPwdGuests').fill('1');
		await expect(sheet.getByText('Enter how many stay in the room, at least 2.')).toBeVisible();
		await expect(create).toBeDisabled();
		await sheet.locator('#scPwdGuests').fill('3');
		await expect(create).toBeEnabled();
		const room = sheet.getByRole('checkbox', { name: /Room nights/ });
		await room.uncheck();
		await expect(sheet.getByText('Tick at least one charge.')).toBeVisible();
		await expect(create).toBeDisabled();
		await room.check();

		// Removing a guest drops the share back.
		await sheet.getByRole('button', { name: 'Remove guest 2' }).click();
		await expect(sheet.getByText('1 of 3 share of the room is VAT-exempt')).toBeVisible();
		await expect(goesDown).toHaveText(oneOfThree);
		await sheet.getByRole('button', { name: 'Add guest' }).click();
		await sheet.locator('#scPwdName1').fill('Mang Jose');
		await sheet.locator('#scPwdId1').fill('PWD-9009');
		await sheet.locator('[aria-label="Guest 2 is a"]').getByText('PWD').click();
		await expect(goesDown).toHaveText(twoOfThree);

		const due = await payTotalDue(sheet);
		await create.click();
		await page.waitForURL(/\/management\/transactions\//);
		const orderId = page.url().match(/transactions\/([0-9a-f-]{36})/)![1]!;
		const [b] = await sql`select id from bookings where order_id = ${orderId}`;
		const bk = b!.id as string;

		// What was previewed is what was charged and what was paid: no refund, no balance.
		const c = (await claim(bk))!;
		const e = expectedDiscount(await money(bk), 2, 3, rate);
		expect(Number(c.vat_removed_centavos) + Number(c.discount_centavos)).toBe(e.reduction);
		expect(peso(e.reduction)).toBe(twoOfThree.replace('−', ''));
		expect((c.claimants as { type: string; name: string }[]).map((k) => `${k.type}:${k.name}`)).toEqual([`senior_citizen:Sc Pwd Ui ${TAG}`, 'pwd:Mang Jose']);
		const paid = Number((await sql`select coalesce(sum(amount_centavos),0) p from payments where order_id = ${orderId} and status = 'paid'`)[0]!.p);
		expect(paid).toBe(due);
		expect(await balance(bk)).toBe(0);

		// The Official Receipt for that payment (issued when its page is first opened) carries the same summary.
		const [pay] = await sql`select id from payments where order_id = ${orderId} and status = 'paid' limit 1`;
		await page.goto(`/${SLUG}/print/receipt/${pay!.id}?format=a4`);
		await expect(page.getByText(/Senior Citizen \/ PWD discount — 2 of 3 guests/i)).toBeVisible();
		await expect(page.getByText(/Senior Citizen: .* — OSCA ID OSCA-8008/)).toBeVisible();
		await expect(page.getByText(/PWD: Mang Jose — PWD ID PWD-9009/)).toBeVisible();
		await expect(page.getByText(/Signature of Senior Citizen \/ PWD/i)).toBeVisible();
		const [or] = await sql`select snapshot from documents where payment_id = ${pay!.id as string} and type = 'official_receipt' order by issued_at desc limit 1`;
		const sc = (or!.snapshot as { scPwd?: { claimants: unknown[]; discountCentavos: number }[] }).scPwd;
		expect(sc).toHaveLength(1);
		expect(sc![0]!.claimants).toHaveLength(2);
		expect(sc![0]!.discountCentavos).toBe(Number(c.discount_centavos));
	});
});
