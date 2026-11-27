import { expect, test, type Page } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';
import { closeDb, hotelIdFor, sql } from './db';

/**
 * Inventory end to end through the real UI: add items, receive (by unit and in packs), record waste,
 * give a dish its ingredients, see a staff order take them from stock and a cancel give them back,
 * give a room type an amenity kit and see check-in hand it out, then audit linens with a stock count.
 * Stock is read back from the dev database.
 *
 *   E2E_HOTEL_SLUG=mmhotel pnpm exec playwright test e2e/inventory.spec.ts
 *
 * Needs: a dining venue with a plain available dish (no add-ons), a room type with a rate plan and an
 * active room, no stock count already open, and the E2E account as hotel admin.
 *
 * Leaves nothing behind: the confirmed booking it checks in is inserted directly (no money moves) and
 * everything this run made — its E2E items (with their recipe / kit lines and movements), the count,
 * the dining order and the booking — is deleted in afterAll.
 */

const RUN = Date.now().toString().slice(-6);
const name = (k: string) => `E2E ${k} ${RUN}`;
const PORK = name('Pork');
const SOAP = name('Soap');
const BRUSH = name('Toothbrush');
const TOWEL = name('Towel');
const SUPPLIER = name('Supplier');
const OR_NO = `E2E-OR-${RUN}`;

let hotelId = '';
let venueId = '';
let dish: { id: string; name: string };
let roomType: { id: string; planId: string };
let t0 = '';
const made = { orders: [] as string[], bookingOrders: [] as string[], guests: [] as string[], counts: [] as string[], restocks: [] as string[] };

const itemId = async (n: string) => (await sql<{ id: string }[]>`select id from stock_items where hotel_id = ${hotelId} and name = ${n}`)[0]?.id;
const onHand = async (n: string) =>
	Number((await sql<{ q: string }[]>`select coalesce(sum(m.qty_milli), 0) q from stock_items i left join stock_movements m on m.item_id = i.id where i.hotel_id = ${hotelId} and i.name = ${n} group by i.id`)[0]?.q ?? NaN);
const g = (n: number) => n * 1000; // grams / pcs → thousandths

/** Picks an option in a bits-ui Select by its trigger. */
async function choose(page: Page, trigger: ReturnType<Page['locator']>, option: string) {
	await trigger.click();
	await page.getByRole('option', { name: option, exact: true }).click();
}

async function addItem(page: Page, it: { name: string; dept: string; unit: string; reusable?: boolean; reorder?: { qty: string; unit: string } }) {
	await page.getByRole('button', { name: 'Add item' }).click();
	const sheet = page.locator('[data-slot="sheet-content"]');
	await sheet.locator('#name').fill(it.name);
	await choose(page, sheet.locator('#department'), it.dept);
	if (it.reusable) await sheet.getByRole('radio', { name: 'Reusable' }).click();
	await choose(page, sheet.locator('#unit'), it.unit);
	if (it.reorder) {
		await sheet.locator('#reorderQty').fill(it.reorder.qty);
		await choose(page, sheet.locator('[aria-label="Reorder unit"]'), it.reorder.unit);
	}
	await sheet.getByRole('button', { name: 'Add item' }).click();
	await expect(sheet).toBeHidden();
	await expect(page.locator('ul.divide-y > li', { hasText: it.name })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
	hotelId = (await hotelIdFor(SLUG)) ?? '';
	t0 = (await sql<{ t: string }[]>`select clock_timestamp()::text t`)[0]!.t;
});

test.afterAll(async () => {
	if (hotelId) {
		const items = (await sql<{ id: string }[]>`select id from stock_items where hotel_id = ${hotelId} and name like ${`E2E % ${RUN}`}`).map((r) => r.id);
		const bookings = await bookingIds(); // before the orders (and with them the bookings) go
		if (made.counts.length) await sql`delete from stock_counts where id in ${sql(made.counts)}`;
		// Restock expenses are unpaid (no cash moved), so they can go with their receipts.
		const restockExpenses = made.restocks.length
			? (await sql<{ id: string }[]>`select expense_id id from stock_restocks where id in ${sql(made.restocks)} and expense_id is not null`).map((r) => r.id)
			: [];
		if (items.length) {
			await sql`delete from stock_movements where item_id in ${sql(items)}`;
			if (made.restocks.length) await sql`delete from stock_restocks where id in ${sql(made.restocks)}`;
			if (restockExpenses.length) await sql`delete from expenses where id in ${sql(restockExpenses)} and status <> 'paid'`;
			await sql`delete from stock_items where id in ${sql(items)}`; // cascades its recipe / kit lines
		}
		if (made.orders.length) await sql`delete from dining_orders where id in ${sql(made.orders)}`;
		if (made.bookingOrders.length) {
			// Money must be voided in the app, never deleted here (cash balances are a stored running total).
			const [held] = await sql`select 1 from security_deposits where booking_id in ${sql(bookings.length ? bookings : ['00000000-0000-0000-0000-000000000000'])}`;
			if (held) throw new Error('A security deposit was taken for the test booking: void it in Finance → Security deposits, then delete the booking.');
			await sql`delete from orders where id in ${sql(made.bookingOrders)}`; // cascades bookings, rooms, history
			await sql`delete from guests where id in ${sql(made.guests)}`;
		}
		// This run's audit rows only: its own entities, and the recipe / kit it set (on a real dish / room type).
		const ours = [...items, ...made.orders, ...made.counts, ...bookings, ...made.restocks, ...restockExpenses];
		await sql`delete from audit_log where hotel_id = ${hotelId} and created_at >= ${t0}::timestamptz
			and (action in ('stock_recipe.set', 'stock_kit.set') or (cardinality(${ours}::text[]) > 0 and entity_id::text = any(${ours}::text[])))`;
	}
	await closeDb();
});

async function bookingIds() {
	if (!made.bookingOrders.length) return [] as string[];
	return (await sql<{ id: string }[]>`select id from bookings where order_id in ${sql(made.bookingOrders)}`).map((r) => r.id);
}

test.beforeEach(async ({ page }) => {
	test.skip(!hotelId, `No hotel with slug "${SLUG}". Set E2E_HOTEL_SLUG.`);
	await staffLogin(page);
});

test('items: add a dining, two front-desk and a reusable housekeeping item', async ({ page }) => {
	await page.goto(`/${SLUG}/management/inventory/items`, { waitUntil: 'networkidle' });
	await addItem(page, { name: PORK, dept: 'Dining', unit: 'Weight (g, kg, oz, lb)', reorder: { qty: '2', unit: 'kg' } });
	await addItem(page, { name: SOAP, dept: 'Front desk', unit: 'Count (pcs, dozen)' });
	await addItem(page, { name: BRUSH, dept: 'Front desk', unit: 'Count (pcs, dozen)' });
	await addItem(page, { name: TOWEL, dept: 'Housekeeping', unit: 'Count (pcs, dozen)', reusable: true });

	const rows = await sql<{ name: string; department: string; kind: string; unit: string; reorder_level_milli: string | null }[]>`
		select name, department, kind, unit, reorder_level_milli from stock_items where hotel_id = ${hotelId} and name like ${`E2E % ${RUN}`} order by name`;
	expect(rows.map((r) => [r.name, r.department, r.kind, r.unit, r.reorder_level_milli])).toEqual([
		[PORK, 'dining', 'consumable', 'g', '2000000'],
		[SOAP, 'front_desk', 'consumable', 'pcs', null],
		[BRUSH, 'front_desk', 'consumable', 'pcs', null],
		[TOWEL, 'housekeeping', 'reusable', 'pcs', null]
	]);
	// The same name twice (any case) is refused.
	await page.getByRole('button', { name: 'Add item' }).click();
	const sheet = page.locator('[data-slot="sheet-content"]');
	await sheet.locator('#name').fill(PORK.toUpperCase());
	await sheet.getByRole('button', { name: 'Add item' }).click();
	await expect(page.getByText(/There is already an item called/)).toBeVisible();
});

test('restock: one receipt puts its items in stock and becomes one unpaid expense', async ({ page }) => {
	// Restock from the Stock page pre-fills that item.
	await page.goto(`/${SLUG}/management/inventory`, { waitUntil: 'networkidle' });
	await page.getByRole('link', { name: `Restock ${PORK}` }).click();
	await page.waitForURL(/\/restock\/new\?item=/);
	await page.waitForLoadState('networkidle');
	await expect(page.locator('[aria-label="Item 1"]')).toContainText(PORK);

	await page.locator('#rs-vendor').fill(SUPPLIER);
	await page.locator('#receiptNo').fill(OR_NO);
	// Pork 2 kg (with expiry), soap 3 dozen = 36 pcs, toothbrushes 10, towels 20.
	await page.getByRole('spinbutton', { name: 'Quantity of item 1' }).fill('2');
	await choose(page, page.locator('[aria-label="Unit of item 1"]'), 'kg');
	await page.getByLabel('Expiry of item 1').fill('2031-01-31');
	const lines: [string, string, string?][] = [[SOAP, '3', 'dozen'], [BRUSH, '10'], [TOWEL, '20']];
	for (const [i, [n, q, u]] of lines.entries()) {
		const k = i + 2;
		await page.getByRole('button', { name: 'Add another item' }).click();
		await choose(page, page.locator(`[aria-label="Item ${k}"]`), n);
		await page.getByRole('spinbutton', { name: `Quantity of item ${k}` }).fill(q);
		if (u) await choose(page, page.locator(`[aria-label="Unit of item ${k}"]`), u);
	}
	await expect(page.getByText('= 36 pcs')).toBeVisible();
	await page.locator('#total').fill('1234.50');
	// Mixed departments → the expense defaults to Housekeeping supplies, for the hotel.
	await expect(page.locator('#category')).toContainText('Housekeeping supplies');
	await expect(page.getByText('Adds 4 items to stock')).toBeVisible();
	await page.screenshot({ path: 'test-results/inventory-restock-form.png', fullPage: true });
	await page.getByRole('button', { name: 'Save receipt' }).click();
	await page.waitForURL(/\/restock\/[0-9a-f-]{36}\?saved=1$/);
	made.restocks.push(page.url().match(/restock\/([0-9a-f-]{36})/)![1]!);
	await expect(page.getByText('Saved. The items are in stock')).toBeVisible();

	expect(await onHand(PORK)).toBe(g(2000));
	expect(await onHand(SOAP)).toBe(g(36));
	expect(await onHand(BRUSH)).toBe(g(10));
	expect(await onHand(TOWEL)).toBe(g(20));
	const [e] = await sql<{ gross: string; vendor: string; inv: string; status: string; source: string; notes: string; cat: string }[]>`
		select e.gross_centavos gross, e.vendor_name vendor, e.vendor_invoice_no inv, e.status, e.source, e.notes, c.name cat
		from stock_restocks r join expenses e on e.id = r.expense_id join expense_categories c on c.id = e.category_id where r.id = ${made.restocks[0]!}`;
	expect([Number(e!.gross), e!.vendor, e!.inv, e!.source, e!.cat]).toEqual([123_450, SUPPLIER, OR_NO, 'hotel', 'Housekeeping supplies']);
	expect(['draft', 'approved']).toContain(e!.status); // Finance pays it
	expect(e!.notes).toContain(`${PORK} 2 kg`);
	await page.screenshot({ path: 'test-results/inventory-restock-detail.png', fullPage: true });

	// Finance → Expenses tells staff where stock receipts go, and the expense links back.
	await page.getByRole('link', { name: 'Open in Finance' }).click();
	await expect(page.getByRole('link', { name: `From Inventory restock ${OR_NO}` })).toBeVisible();
});

test('stock: record waste and the low flag', async ({ page }) => {
	await page.goto(`/${SLUG}/management/inventory`, { waitUntil: 'networkidle' });
	const sheet = page.locator('[data-slot="sheet-content"]');

	// Waste 250 g of pork, with a reason → 1.75 kg, at/below the 2 kg reorder level.
	await page.getByRole('button', { name: `More for ${PORK}` }).click();
	await page.getByRole('menuitem', { name: 'Record waste' }).click();
	await sheet.locator('#qty').fill('250');
	await sheet.locator('#note').fill('E2E spoiled');
	await sheet.getByRole('button', { name: 'Record waste' }).click();
	await expect(sheet).toBeHidden();
	expect(await onHand(PORK)).toBe(g(1750));
	const porkRow = page.locator('ul.divide-y > li', { hasText: PORK });
	await expect(porkRow).toContainText('1.75 kg');
	await expect(porkRow).toContainText('Low');
	await expect(porkRow).toContainText('Next expiry Jan 31, 2031');
	await page.screenshot({ path: 'test-results/inventory-stock.png', fullPage: true });
});

test('dining: a dish with ingredients takes them from stock, and a cancel gives them back', async ({ page }) => {
	const [d] = await sql<{ id: string; name: string; venue: string }[]>`
		select m.id, m.name, m.dining_item_id venue from dining_menu_items m
		where m.hotel_id = ${hotelId} and m.deleted_at is null and m.is_active and m.is_available
		  and not exists (select 1 from dining_menu_item_addon_groups x where x.menu_item_id = m.id)
		  and not exists (select 1 from dining_addon_groups ag where ag.menu_item_id = m.id)
		  and not exists (select 1 from stock_recipe_lines r where r.menu_item_id = m.id)
		order by m.sort_order, m.name limit 1`;
	test.skip(!d, 'No plain available dish (no add-ons, no recipe yet) to test with.');
	dish = { id: d!.id, name: d!.name };
	venueId = d!.venue;

	// The dish's Ingredients: 150 g of pork per serving.
	await page.goto(`/${SLUG}/management/dining/menu?venue=${venueId}`, { waitUntil: 'networkidle' });
	await page.getByRole('button', { name: `Edit ${dish.name}` }).click();
	const dialog = page.getByRole('dialog');
	const ingredients = dialog.locator('section', { has: page.getByRole('heading', { name: 'Ingredients' }) });
	await ingredients.getByRole('button', { name: 'Add item' }).click();
	await choose(page, ingredients.locator('[aria-label="Item 1"]'), PORK);
	await ingredients.getByRole('spinbutton', { name: 'Quantity of item 1' }).fill('150');
	await page.screenshot({ path: 'test-results/inventory-recipe.png' });
	await ingredients.getByRole('button', { name: 'Save ingredients' }).click();
	await expect(page.getByText('Ingredients saved.')).toBeVisible();
	const [line] = await sql<{ qty_milli: string }[]>`select qty_milli from stock_recipe_lines where menu_item_id = ${dish.id}`;
	expect(Number(line!.qty_milli)).toBe(g(150));

	// A staff takeaway order (unpaid) for 2 → 300 g leaves stock as it reaches the kitchen.
	await page.goto(`/${SLUG}/management/dining/orders`);
	const menu = page.locator('section[aria-label="Menu"]');
	await expect(async () => {
		await page.getByRole('button', { name: 'New order' }).click();
		await expect(menu).toBeVisible({ timeout: 2000 });
	}).toPass({ timeout: 30_000 });
	const dishButton = menu.locator('li > button:not([disabled])', { hasText: dish.name }).first();
	await dishButton.click();
	await dishButton.click();
	const cart = page.locator('aside[aria-label="This order"]');
	await cart.getByText('Takeaway', { exact: true }).click();
	await cart.getByRole('button', { name: 'Place order', exact: true }).click();
	let order = { id: '', code: '' };
	await expect
		.poll(async () => {
			const [o] = await sql<{ id: string; code: string }[]>`
				select o.id, o.code from dining_orders o join dining_order_items i on i.order_id = o.id
				where o.hotel_id = ${hotelId} and i.menu_item_id = ${dish.id} and o.created_at >= ${t0}::timestamptz order by o.created_at desc limit 1`;
			order = o ?? order;
			return order.id;
		}, { timeout: 20_000 })
		.not.toBe('');
	made.orders.push(order.id);
	const [qty] = await sql<{ q: number }[]>`select sum(quantity)::int q from dining_order_items where order_id = ${order.id}`;
	expect(await onHand(PORK)).toBe(g(1750) - qty!.q * g(150));
	const moves = await sql<{ type: string; note: string }[]>`select type, note from stock_movements where dining_order_id = ${order.id}`;
	expect(moves.every((m) => m.type === 'order' && m.note === `Order ${order.code}`)).toBe(true);

	// Cancel it before the kitchen starts → the pork comes back.
	await page.goto(`/${SLUG}/management/dining/orders`, { waitUntil: 'networkidle' });
	await page.getByText(order.code).first().click();
	await page.getByRole('button', { name: /^Cancel/ }).first().click();
	await page.locator('#cancelReason').fill('E2E inventory test');
	await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
	await expect.poll(async () => (await sql<{ s: string }[]>`select status s from dining_orders where id = ${order.id}`)[0]!.s).toBe('cancelled');
	expect(await onHand(PORK)).toBe(g(1750));

	// Movements tells the story, newest first.
	await page.goto(`/${SLUG}/management/inventory/movements?item=${(await itemId(PORK))!}`, { waitUntil: 'networkidle' });
	await expect(page.getByText('Order cancelled').first()).toBeVisible();
	await expect(page.getByText('Dining order').first()).toBeVisible();
	await page.screenshot({ path: 'test-results/inventory-movements.png', fullPage: true });
});

test('check-in: the room type kit is pre-filled, staff adjust it, and it leaves stock tagged with the stay', async ({ page }) => {
	const [rt] = await sql<{ id: string; plan: string }[]>`
		select t.id, (select p.id from rate_plans p where p.room_type_id = t.id and p.deleted_at is null order by p.created_at limit 1) plan
		from room_types t where t.hotel_id = ${hotelId} and t.deleted_at is null
		  and exists (select 1 from rooms r where r.room_type_id = t.id and r.is_active and r.operational_status = 'available')
		  and not exists (select 1 from stock_checkin_kit_lines k where k.room_type_id = t.id)
		order by t.sort_order limit 1`;
	test.skip(!rt?.plan, 'No room type with a rate plan, a free room and no kit yet.');
	roomType = { id: rt!.id, planId: rt!.plan };

	// The kit: 1 soap per room, 1 toothbrush per guest. Linens are not offered.
	await page.goto(`/${SLUG}/management/settings/rooms/types/${roomType.id}`, { waitUntil: 'networkidle' });
	const kit = page.locator('section', { has: page.getByRole('heading', { name: 'Check-in amenity kit' }) });
	await kit.getByRole('button', { name: 'Add item' }).click();
	await kit.locator('[aria-label="Item 1"]').click();
	await expect(page.getByRole('option', { name: TOWEL })).toHaveCount(0);
	await expect(page.getByRole('option', { name: PORK })).toHaveCount(0);
	await page.getByRole('option', { name: SOAP, exact: true }).click();
	await kit.getByRole('spinbutton', { name: 'Quantity of item 1' }).fill('1');
	await kit.getByRole('button', { name: 'Add item' }).click();
	await choose(page, kit.locator('[aria-label="Item 2"]'), BRUSH);
	await kit.getByRole('spinbutton', { name: 'Quantity of item 2' }).fill('1');
	await kit.getByRole('radiogroup', { name: 'Item 2 counted per' }).getByRole('radio', { name: 'per guest' }).click();
	await page.screenshot({ path: 'test-results/inventory-kit.png' });
	await kit.getByRole('button', { name: 'Save kit' }).click();
	await expect(page.getByText('Amenity kit saved.')).toBeVisible();
	const lines = await sql<{ name: string; qty_milli: string; per: string }[]>`
		select i.name, k.qty_milli, k.per from stock_checkin_kit_lines k join stock_items i on i.id = k.stock_item_id where k.room_type_id = ${roomType.id} order by i.name`;
	expect(lines.map((l) => [l.name, Number(l.qty_milli), l.per])).toEqual([
		[SOAP, g(1), 'room'],
		[BRUSH, g(1), 'guest']
	]);

	// A confirmed, already-settled booking for 3 guests, far enough out that a room is free.
	const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
	const start = 700 + Number(RUN.slice(-2));
	const guestName = `E2E Inventory Guest ${RUN}`;
	const [gu] = await sql<{ id: string }[]>`insert into guests (hotel_id, full_name, email) values (${hotelId}, ${guestName}, ${`e2e-inv-${RUN}@example.test`}) returning id`;
	made.guests.push(gu!.id);
	const money = { subtotal_centavos: 100_000, fees_centavos: 0, vat_centavos: 12_000, total_centavos: 112_000 };
	const [o] = await sql<{ id: string }[]>`insert into orders ${sql({ hotel_id: hotelId, guest_id: gu!.id, status: 'confirmed', access_token: crypto.randomUUID(), ...money })} returning id`;
	made.bookingOrders.push(o!.id);
	const [b] = await sql<{ id: string }[]>`insert into bookings ${sql({ hotel_id: hotelId, order_id: o!.id, status: 'confirmed', check_in: day(start), check_out: day(start + 1), occupancy: 3, ...money })} returning id`;
	await sql`insert into booking_rooms ${sql({ booking_id: b!.id, room_type_id: roomType.id, rate_plan_id: roomType.planId, quantity: 1 })}`;

	// The check-in form shows the kit scaled to the stay: 1 soap (room), 3 toothbrushes (guests).
	await page.goto(`/${SLUG}/management/reservations/room/${b!.id}`, { waitUntil: 'networkidle' });
	const handed = page.getByRole('group', { name: 'Amenities handed out' });
	await expect(handed).toBeVisible();
	await expect(handed.getByLabel(SOAP)).toHaveValue('1');
	await expect(handed.getByLabel(BRUSH)).toHaveValue('3');
	// One guest says no thanks.
	await handed.getByLabel(BRUSH).fill('2');
	await page.screenshot({ path: 'test-results/inventory-checkin.png', fullPage: true });
	await page.locator('select[name="roomId"]').first().selectOption({ index: 1 });
	// The rate plan may pre-fill a security deposit; blank it so this test moves no money.
	const deposit = page.locator('#depositAmount');
	if (await deposit.count()) await deposit.fill('');
	const soap0 = await onHand(SOAP);
	const brush0 = await onHand(BRUSH);
	await page.getByRole('button', { name: 'Check in', exact: true }).click();
	await expect.poll(async () => (await sql<{ s: string }[]>`select status s from bookings where id = ${b!.id}`)[0]!.s, { timeout: 15_000 }).toBe('checked_in');
	expect(await onHand(SOAP)).toBe(soap0 - g(1));
	expect(await onHand(BRUSH)).toBe(brush0 - g(2));
	const notes = await sql<{ note: string }[]>`select distinct note from stock_movements where booking_id = ${b!.id} and type = 'checkin_kit'`;
	expect(notes.map((n) => n.note)).toEqual([`Check-in ${o!.id.slice(0, 8).toUpperCase()} · ${guestName}`]);
});

test('stock count: a linen audit posts the difference with its reason', async ({ page }) => {
	const [open] = await sql`select 1 from stock_counts where hotel_id = ${hotelId} and status = 'open'`;
	test.skip(!!open, 'A stock count is already open in this hotel.');

	await page.goto(`/${SLUG}/management/inventory/counts`, { waitUntil: 'networkidle' });
	await page.getByRole('radio', { name: /Housekeeping/ }).click();
	await page.locator('#countNote').fill(`E2E linen audit ${RUN}`);
	await page.getByRole('button', { name: 'Start count' }).click();
	await page.waitForURL(/\/inventory\/counts\/[0-9a-f-]{36}$/);
	made.counts.push(page.url().split('/').pop()!);

	// 18 towels on the shelf, system says 20: Finish says the remark is missing and posts nothing.
	const counted = page.getByRole('spinbutton', { name: `${TOWEL} counted, in pcs` });
	await counted.fill('18');
	await expect(page.locator('ul.divide-y > li', { hasText: TOWEL })).toContainText('-2 pcs');
	const finish = page.getByRole('button', { name: 'Finish count' });
	await finish.click();
	await expect(page.getByRole('alert')).toContainText(`Add a remark for ${TOWEL}`);
	expect(await onHand(TOWEL)).toBe(g(20));
	await page.getByRole('textbox', { name: `Remarks for ${TOWEL}` }).fill('E2E 2 taken by guests');
	await page.screenshot({ path: 'test-results/inventory-count.png', fullPage: true });
	await finish.click();
	await expect(page.getByText(/Count finished/)).toBeVisible();

	expect(await onHand(TOWEL)).toBe(g(18));
	const [line] = await sql<{ expected_milli: string; variance_milli: string; reason: string }[]>`
		select expected_milli, variance_milli, reason from stock_count_lines where count_id = ${made.counts[0]!} and item_id = ${(await itemId(TOWEL))!}`;
	expect([Number(line!.expected_milli), Number(line!.variance_milli), line!.reason]).toEqual([g(20), g(-2), 'E2E 2 taken by guests']);
	// The finished count is read-only and lists the difference.
	await expect(page.locator('ul.divide-y > li', { hasText: TOWEL })).toContainText('Expected 20 pcs');
	await expect(page.getByRole('button', { name: 'Finish count' })).toHaveCount(0);
});
