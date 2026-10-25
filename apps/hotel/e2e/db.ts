/**
 * Read-only reach into the dev database for specs that have to check a money trail the page
 * does not show — which drawer a sale landed in, which shift it was tagged with, which
 * chart-of-accounts leaf it posted to.
 *
 * The specs never write SQL: the UI makes every change, these helpers only read it back.
 * `src/lib/server/db/index.ts` cannot be imported here (it reads `$env/dynamic/private`, a
 * SvelteKit-only module), so this opens its own connection the way `scripts/*.ts` do.
 */
import 'dotenv/config';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set — the e2e money assertions need the dev database.');

export const sql = postgres(url, { max: 1 });

export interface Drawer {
	id: string;
	name: string;
	/** The account's own chart-of-accounts leaf — `1010` is the front desk's. */
	coaCode: string | null;
}

export interface Shift {
	id: string;
	cashAccountId: string;
	status: string;
	openingFloatCentavos: number;
	expectedCashCentavos: number | null;
	countedCashCentavos: number | null;
	varianceCentavos: number | null;
}

export interface Movement {
	id: string;
	direction: string;
	category: string;
	amountCentavos: number;
	cashAccountId: string;
	shiftId: string | null;
	sourceType: string | null;
	sourceId: string | null;
	journalEntryId: string | null;
	memo: string | null;
	voidedAt: Date | null;
}

/** Centavos arrive as bigint strings; every amount in these specs is an integer centavo count. */
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

export async function hotelIdFor(slug: string): Promise<string | null> {
	const [row] = await sql<{ id: string }[]>`select id from hotels where slug = ${slug} limit 1`;
	return row?.id ?? null;
}

async function drawerFor(hotelId: string, column: 'dining_drawer_account_id' | 'default_drawer_account_id') {
	const [row] = await sql<{ id: string; name: string; code: string | null }[]>`
		select a.id, a.name, c.code
		from finance_settings s
		join cash_accounts a on a.id = s.${sql(column)}
		left join chart_of_accounts c on c.id = a.coa_account_id
		where s.hotel_id = ${hotelId}
		limit 1`;
	return row ? ({ id: row.id, name: row.name, coaCode: row.code } satisfies Drawer) : null;
}

/** The till Finance has assigned to dining, or null when dining still rings into the front desk's. */
export const diningDrawer = (hotelId: string) => drawerFor(hotelId, 'dining_drawer_account_id');
export const frontDeskDrawer = (hotelId: string) => drawerFor(hotelId, 'default_drawer_account_id');

export async function cashAccountByName(hotelId: string, name: string): Promise<Drawer | null> {
	const [row] = await sql<{ id: string; name: string; code: string | null }[]>`
		select a.id, a.name, c.code
		from cash_accounts a
		left join chart_of_accounts c on c.id = a.coa_account_id
		where a.hotel_id = ${hotelId} and lower(a.name) = lower(${name}) and a.deleted_at is null
		order by a.is_active desc
		limit 1`;
	return row ? { id: row.id, name: row.name, coaCode: row.code } : null;
}

export async function openShiftFor(cashAccountId: string): Promise<Shift | null> {
	const [row] = await sql`
		select * from cashier_shifts where cash_account_id = ${cashAccountId} and status = 'open' limit 1`;
	return row ? shift(row) : null;
}

export async function shiftById(id: string): Promise<Shift | null> {
	const [row] = await sql`select * from cashier_shifts where id = ${id} limit 1`;
	return row ? shift(row) : null;
}

function shift(r: postgres.Row): Shift {
	return {
		id: r.id as string,
		cashAccountId: r.cash_account_id as string,
		status: r.status as string,
		openingFloatCentavos: num(r.opening_float_centavos),
		expectedCashCentavos: r.expected_cash_centavos === null ? null : num(r.expected_cash_centavos),
		countedCashCentavos: r.counted_cash_centavos === null ? null : num(r.counted_cash_centavos),
		varianceCentavos: r.variance_centavos === null ? null : num(r.variance_centavos)
	};
}

function movement(r: postgres.Row): Movement {
	return {
		id: r.id as string,
		direction: r.direction as string,
		category: r.category as string,
		amountCentavos: num(r.amount_centavos),
		cashAccountId: r.cash_account_id as string,
		shiftId: (r.shift_id as string | null) ?? null,
		sourceType: (r.source_type as string | null) ?? null,
		sourceId: (r.source_id as string | null) ?? null,
		journalEntryId: (r.journal_entry_id as string | null) ?? null,
		memo: (r.memo as string | null) ?? null,
		voidedAt: (r.voided_at as Date | null) ?? null
	};
}

/** Every movement tagged with this shift, oldest first — what the drawer count is built from. */
export async function movementsForShift(shiftId: string): Promise<Movement[]> {
	const rows = await sql`select * from cash_movements where shift_id = ${shiftId} order by created_at asc`;
	return rows.map(movement);
}

/**
 * What an open shift should be holding: opening float + cash in − cash out, counting only
 * movements on its own drawer (a cash drop's bank leg carries the same shift id).
 */
export async function expectedCashFor(shift: Shift): Promise<number> {
	const movements = await movementsForShift(shift.id);
	return movements
		.filter((m) => m.cashAccountId === shift.cashAccountId && !m.voidedAt)
		.reduce((sum, m) => sum + (m.direction === 'in' ? m.amountCentavos : -m.amountCentavos), shift.openingFloatCentavos);
}

/** The movement a given source row produced, e.g. `('dining_order', orderId)`. */
export async function movementForSource(sourceType: string, sourceId: string): Promise<Movement | null> {
	const [row] = await sql`
		select * from cash_movements
		where source_type = ${sourceType} and source_id = ${sourceId}
		order by created_at desc limit 1`;
	return row ? movement(row) : null;
}

/** The newest dining order placed for this hotel — the one the spec just rang up. */
export async function latestDiningOrder(hotelId: string) {
	const [row] = await sql<
		{ id: string; code: string; total_centavos: string; payment_status: string; cash_account_id: string | null; shift_id: string | null }[]
	>`select id, code, total_centavos, payment_status, cash_account_id, shift_id
		from dining_orders where hotel_id = ${hotelId} order by created_at desc limit 1`;
	return row
		? {
				id: row.id,
				code: row.code,
				totalCentavos: num(row.total_centavos),
				paymentStatus: row.payment_status,
				cashAccountId: row.cash_account_id,
				shiftId: row.shift_id
			}
		: null;
}

/** The posted journal lines for a movement, as `{ code, debit, credit }` — the ledger end of the trail. */
export async function journalLines(journalEntryId: string) {
	return sql<{ code: string; name: string; debit_centavos: string; credit_centavos: string }[]>`
		select c.code, c.name, l.debit_centavos, l.credit_centavos
		from journal_lines l
		join chart_of_accounts c on c.id = l.account_id
		where l.journal_entry_id = ${journalEntryId}
		order by c.code`;
}

export const closeDb = () => sql.end();

/** A drawer's ledger balance — what the balance sheet says the till is holding. */
export async function accountBalance(cashAccountId: string): Promise<number> {
	const [row] = await sql<{ bal: string }[]>`
		select current_balance_centavos as bal from cash_accounts where id = ${cashAccountId}`;
	return num(row?.bal);
}

/** The drawer's leg of the float transfer an opened shift posted, if it needed one. */
export async function floatMovementFor(shiftId: string, cashAccountId: string): Promise<Movement | null> {
	const [row] = await sql`
		select * from cash_movements
		where source_type = 'shift_open' and source_id = ${shiftId} and cash_account_id = ${cashAccountId}
		order by created_at desc limit 1`;
	return row ? movement(row) : null;
}
