import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

/** Live-DB tests for the Sales tab and its CSV. Own throwaway hotels, removed afterwards;
 *  skipped when no DATABASE_URL is configured. */
const hasDb = Boolean(process.env.DATABASE_URL) || (await hasEnvFile());

async function hasEnvFile(): Promise<boolean> {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}

describe.skipIf(!hasDb)('dining sales page and CSV (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const page = await import('./+page.server');
	const csv = await import('./csv/+server');
	const o = await import('$lib/server/dining-orders');
	const { seedFinanceDefaults } = await import('$lib/server/finance/seed-defaults');
	const { businessDateFor } = await import('$lib/server/finance/shared');

	const tag = `salespage-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let hotelA: any;
	let hotelB: any;
	let venueA = '';
	let venueB = '';
	const today = businessDateFor('Asia/Manila');

	async function mkHotel(suffix: string) {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: `${tag}-${suffix}`, name: `Sales page ${suffix}`, orgRef: mintRef('org') })
			.returning();
		hotelIds.push(h!.id);
		return h!;
	}
	const locals = (hotel: any, caps: string[]) =>
		({ hotel, user: { id: 'u', isPlatformAdmin: false }, role: { id: 'r', slug: 'r', name: 'R', isProtected: false, capabilities: caps } }) as never;

	beforeAll(async () => {
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		await seedFinanceDefaults(db, hotelA.id);
		await seedFinanceDefaults(db, hotelB.id);
		const [va] = await db.insert(s.diningItems).values({ hotelId: hotelA.id, title: 'Cafe' }).returning();
		const [vb] = await db.insert(s.diningItems).values({ hotelId: hotelB.id, title: 'Other' }).returning();
		venueA = va!.id;
		venueB = vb!.id;
		const [st] = await db.insert(s.diningStations).values({ hotelId: hotelA.id, name: 'Kitchen' }).returning();
		const [dish] = await db
			.insert(s.diningMenuItems)
			.values({ hotelId: hotelA.id, diningItemId: venueA, name: 'Adobo, "house"', priceCentavos: 25_000, stationId: st!.id })
			.returning();
		for (let i = 0; i < 2; i++) {
			const c = await o.createDiningOrder({ hotelId: hotelA.id, venueId: venueA, orderType: 'dine_in', lines: [{ menuItemId: dish!.id, quantity: 1 }] });
			await o.payDiningOrder({ hotelId: hotelA.id, orderId: c.id, method: 'card' });
		}
		// an unpaid order must not count
		await o.createDiningOrder({ hotelId: hotelA.id, venueId: venueA, orderType: 'dine_in', lines: [{ menuItemId: dish!.id, quantity: 3 }] });
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	it('reports today by default, counting only paid orders', async () => {
		const out = (await page.load({ locals: locals(hotelA, ['dining:read']), url: new URL('http://x/') } as never)) as any;
		expect(out).toMatchObject({ from: today, to: today, venueId: null });
		expect(out.report).toMatchObject({ orders: 2, grossCentavos: 50_000 });
		expect(out.report.byItem[0]).toMatchObject({ name: 'Adobo, "house"', quantity: 2 });
		expect(out.presets.week.from < out.presets.week.to || out.presets.week.from === out.presets.week.to).toBe(true);
	});

	it('returns nothing for a range with no sales, and ignores a venue from another hotel', async () => {
		const empty = (await page.load({ locals: locals(hotelA, ['dining:read']), url: new URL('http://x/?from=2020-01-01&to=2020-01-31') } as never)) as any;
		expect(empty.report.orders).toBe(0);
		const foreign = (await page.load({ locals: locals(hotelA, ['dining:read']), url: new URL(`http://x/?venue=${venueB}`) } as never)) as any;
		expect(foreign.venueId).toBeNull(); // not a venue of this hotel, so no filter is applied
		expect(foreign.report.orders).toBe(2);
		expect(((await page.load({ locals: locals(hotelB, ['dining:read']), url: new URL('http://x/') } as never)) as any).report.orders).toBe(0);
	});

	it('is closed to staff without dining access', async () => {
		await expect(page.load({ locals: locals(hotelA, []), url: new URL('http://x/') } as never)).rejects.toMatchObject({ status: 403 });
		await expect(csv.GET({ locals: locals(hotelA, []), url: new URL('http://x/') } as never)).rejects.toMatchObject({ status: 403 });
	});

	it('exports a CSV with the summary and each breakdown, quoting commas and quotes', async () => {
		const res = await csv.GET({ locals: locals(hotelA, ['dining:read']), url: new URL(`http://x/?from=${today}&to=${today}`) } as never);
		expect(res.headers.get('content-type')).toContain('text/csv');
		expect(res.headers.get('content-disposition')).toContain(`dining-sales-${today}-to-${today}.csv`);
		const text = await res.text();
		expect(text.split('\r\n')[0]).toBe(`Dining sales,${today} to ${today}`);
		expect(text).toContain('Orders paid,2');
		expect(text).toContain('Sales (VAT included),500.00');
		expect(text).toContain('By station');
		expect(text).toContain('Kitchen,2,500.00');
		expect(text).toContain('"Adobo, ""house""",2,500.00'); // a name with a comma and quotes stays one cell
		expect(text).toContain('card,2,500.00');
		// the other hotel's export is empty, not a leak
		const other = await (await csv.GET({ locals: locals(hotelB, ['dining:read']), url: new URL('http://x/') } as never)).text();
		expect(other).toContain('Orders paid,0');
		expect(other).not.toContain('Adobo');
	});
});
