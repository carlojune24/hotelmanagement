import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests: the BIR "VAT-registered" flag drives hotels.vat_rate_bps (off → 0, back on → 1200
 * unless a rate is already set), the Finance settings page pins/locks the rate while off, and the
 * DB-backed VAT consumers (stay pricing, folio charges, hall overtime) follow it.
 * Own throwaway hotels, removed afterwards; skipped when no DATABASE_URL.
 */
const hasDb = Boolean(process.env.DATABASE_URL) || (await hasEnvFile());

async function hasEnvFile(): Promise<boolean> {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}

describe.skipIf(!hasDb)('VAT-registered flag drives the VAT rate (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { upsertBirSettings, getBirSettings } = await import('$lib/server/finance/documents');
	const { priceStay } = await import('$lib/server/pricing');
	const { addAdHocCharge } = await import('$lib/server/folio');
	const { hallOvertimeAmount } = await import('$lib/hall-overtime');
	const settingsPage = await import('./settings/+page.server');

	const tag = `vatflag-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let userId = '';

	const bir = (isVatRegistered: boolean) => ({
		tin: null,
		isVatRegistered,
		registeredAddress: null,
		birPermitNo: null,
		permitDateIssued: null,
		accreditedPrinterName: null,
		accreditedPrinterTin: null,
		accreditedPrinterAccreditationNo: null,
		printerAccreditationDate: null,
		invoicePrefix: 'INV',
		orPrefix: 'OR',
		serialPadWidth: 6,
		autoIssueInvoiceOnCheckout: true,
		autoIssueReceiptOnPayment: true,
		footerNote: null,
		thermalPaperWidthMm: 80
	});

	async function mkHotel(suffix: string) {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: `${tag}-${suffix}`, name: `VAT flag ${suffix}`, orgRef: mintRef('org') })
			.returning();
		hotelIds.push(h!.id);
		return h!;
	}
	const rateOf = async (hotelId: string) =>
		(await db.select({ r: s.hotels.vatRateBps }).from(s.hotels).where(eq(s.hotels.id, hotelId)))[0]!.r;

	const asAdmin = (hotel: { id: string; slug: string; timezone: string; vatRateBps: number }) =>
		({
			hotel,
			user: { id: userId, email: 'x@x', name: 'Tester', isPlatformAdmin: false },
			role: { id: 'r', slug: 'r', name: 'Role', isProtected: false, capabilities: ['hotel:admin', 'finance:read'] }
		}) as never;
	const detailsForm = (vatRatePct: string) => {
		const fd = new FormData();
		fd.set('currency', 'PHP');
		fd.set('vatRatePct', vatRatePct);
		fd.set('timezone', 'Asia/Manila');
		fd.set('scPwdDiscountPct', '20');
		return new Request('http://localhost/x', { method: 'POST', body: fd });
	};

	beforeAll(async () => {
		const [u] = await db
			.insert(s.users)
			.values({ email: `${tag}@example.test`, name: 'VAT tester', passwordHash: null })
			.returning({ id: s.users.id });
		userId = u!.id;
	});

	afterAll(async () => {
		if (hotelIds.length) {
			const folioIds = (
				await db.select({ id: s.folios.id }).from(s.folios).where(inArray(s.folios.hotelId, hotelIds))
			).map((r) => r.id);
			if (folioIds.length) await db.delete(s.folioCharges).where(inArray(s.folioCharges.folioId, folioIds));
			await db.delete(s.folios).where(inArray(s.folios.hotelId, hotelIds));
			const bookingIds = (
				await db.select({ id: s.bookings.id }).from(s.bookings).where(inArray(s.bookings.hotelId, hotelIds))
			).map((r) => r.id);
			if (bookingIds.length) await db.delete(s.bookingRooms).where(inArray(s.bookingRooms.bookingId, bookingIds));
			await db.delete(s.bookings).where(inArray(s.bookings.hotelId, hotelIds));
			await db.delete(s.orders).where(inArray(s.orders.hotelId, hotelIds));
			await db.delete(s.guests).where(inArray(s.guests.hotelId, hotelIds));
			await db.delete(s.ratePlans).where(inArray(s.ratePlans.hotelId, hotelIds));
			await db.delete(s.roomTypes).where(inArray(s.roomTypes.hotelId, hotelIds));
			await db.delete(s.birSettings).where(inArray(s.birSettings.hotelId, hotelIds));
			await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
		}
		if (userId) await db.delete(s.users).where(eq(s.users.id, userId));
	});

	describe('saving the BIR setup', () => {
		it('unchecking sets the rate to 0, only for that hotel', async () => {
			const a = await mkHotel('a1');
			const other = await mkHotel('a2');
			await upsertBirSettings(a.id, bir(false), null);
			expect(await rateOf(a.id)).toBe(0);
			expect(await rateOf(other.id)).toBe(1200);
			expect((await getBirSettings(a.id))?.isVatRegistered).toBe(false);
		});

		it('re-checking restores 12% when the rate is 0', async () => {
			const h = await mkHotel('b1');
			await upsertBirSettings(h.id, bir(false), null);
			await upsertBirSettings(h.id, bir(true), null);
			expect(await rateOf(h.id)).toBe(1200);
		});

		it('re-checking keeps a rate the hotel already has', async () => {
			const h = await mkHotel('c1');
			await db.update(s.hotels).set({ vatRateBps: 500 }).where(eq(s.hotels.id, h.id));
			await upsertBirSettings(h.id, bir(true), null);
			expect(await rateOf(h.id)).toBe(500);
		});

		it('saving unchanged while off stays at 0 (idempotent)', async () => {
			const h = await mkHotel('d1');
			await upsertBirSettings(h.id, bir(false), null);
			await upsertBirSettings(h.id, bir(false), null);
			expect(await rateOf(h.id)).toBe(0);
		});
	});

	describe('Finance → Settings page', () => {
		it('locks and pins the rate while VAT-registered is off, ignoring a submitted 12', async () => {
			const h = await mkHotel('e1');
			await upsertBirSettings(h.id, bir(false), null);
			const fresh = (await db.select().from(s.hotels).where(eq(s.hotels.id, h.id)))[0]!;
			const locals = asAdmin(fresh);

			const data = (await settingsPage.load({ locals } as never)) as { vatLocked: boolean; hotelDetails: { vatRateBps: number } };
			expect(data.vatLocked).toBe(true);
			expect(data.hotelDetails.vatRateBps).toBe(0);

			await settingsPage.actions.updateHotelDetails!({ locals, request: detailsForm('12') } as never);
			expect(await rateOf(h.id)).toBe(0);
		});

		it('stays editable when registered, and for a hotel with no BIR row yet', async () => {
			const withRow = await mkHotel('f1');
			await upsertBirSettings(withRow.id, bir(true), null);
			const noRow = await mkHotel('f2');

			for (const h of [withRow, noRow]) {
				const fresh = (await db.select().from(s.hotels).where(eq(s.hotels.id, h.id)))[0]!;
				const locals = asAdmin(fresh);
				const data = (await settingsPage.load({ locals } as never)) as { vatLocked: boolean };
				expect(data.vatLocked).toBe(false);
				await settingsPage.actions.updateHotelDetails!({ locals, request: detailsForm('10') } as never);
				expect(await rateOf(h.id)).toBe(1000);
			}
		});
	});

	describe('VAT consumers follow the rate', () => {
		async function mkStay(hotelId: string) {
			const [rt] = await db.insert(s.roomTypes).values({ hotelId, name: 'Std' }).returning();
			const [plan] = await db
				.insert(s.ratePlans)
				.values({ hotelId, roomTypeId: rt!.id, name: 'Rack', basePriceCentavos: 100_000 })
				.returning();
			return { rt: rt!, plan: plan! };
		}

		it('stay pricing: 12% when registered, 0 when not', async () => {
			const h = await mkHotel('g1');
			const { plan } = await mkStay(h.id);
			const q = { hotelId: h.id, ratePlanId: plan.id, checkIn: '2031-06-10', checkOut: '2031-06-12' };

			const on = await priceStay(q);
			expect(on.vatCentavos).toBeGreaterThan(0);

			await upsertBirSettings(h.id, bir(false), null);
			const off = await priceStay(q);
			expect(off.vatCentavos).toBe(0);
			expect(off.totalCentavos).toBe(off.subtotalCentavos + off.fees.reduce((n, f) => n + f.amountCentavos, 0));
		});

		it('folio charge: taxable charge carries 12% tax, then 0 after unchecking; existing charges keep theirs', async () => {
			const h = await mkHotel('h1');
			const { rt, plan } = await mkStay(h.id);
			const [g] = await db.insert(s.guests).values({ hotelId: h.id, fullName: 'Folio Guest', email: 'g@example.test' }).returning();
			const [o] = await db
				.insert(s.orders)
				.values({ hotelId: h.id, guestId: g!.id, status: 'confirmed', subtotalCentavos: 0, feesCentavos: 0, vatCentavos: 0, totalCentavos: 0, accessToken: randomUUID() })
				.returning();
			const [b] = await db
				.insert(s.bookings)
				.values({ hotelId: h.id, orderId: o!.id, status: 'confirmed', checkIn: '2031-06-10', checkOut: '2031-06-12', occupancy: 2, subtotalCentavos: 0, feesCentavos: 0, vatCentavos: 0, totalCentavos: 0 })
				.returning();
			await db.insert(s.bookingRooms).values({ bookingId: b!.id, roomTypeId: rt.id, ratePlanId: plan.id, quantity: 1 } as never);
			const target = { kind: 'room', bookingId: b!.id } as const;

			const first = await addAdHocCharge(h.id, target, { description: 'Minibar', amountCentavos: 10_000, taxable: true }, null);
			await upsertBirSettings(h.id, bir(false), null);
			const second = await addAdHocCharge(h.id, target, { description: 'Laundry', amountCentavos: 10_000, taxable: true }, null);

			const tax = async (id: string) =>
				(await db.select({ t: s.folioCharges.taxCentavos }).from(s.folioCharges).where(eq(s.folioCharges.id, id)))[0]!.t;
			expect(await tax(first.chargeId)).toBe(1200);
			expect(await tax(second.chargeId)).toBe(0);
		});

		it('hall overtime: 0% rate gives no VAT', () => {
			expect(hallOvertimeAmount(2, 50_000, 1200).vatCentavos).toBe(12_000);
			expect(hallOvertimeAmount(2, 50_000, 0).vatCentavos).toBe(0);
		});
	});
});
