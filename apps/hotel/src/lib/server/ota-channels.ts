import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from './db/index';
import { orders, otaChannels, receivables, type OtaChannel } from './db/schema/index';

export class OtaChannelError extends Error {}

const DEFAULT_NAMES = ['Agoda', 'Booking.com'];

const clean = (name: string) => name.trim().replace(/\s+/g, ' ');

/** The hotel's OTA list. A hotel that has never had one (made after the migration) starts with the defaults. */
export async function listOtaChannels(hotelId: string, opts: { activeOnly?: boolean } = {}): Promise<OtaChannel[]> {
	let rows = await db.select().from(otaChannels).where(eq(otaChannels.hotelId, hotelId)).orderBy(asc(otaChannels.name));
	if (rows.length === 0) {
		await db
			.insert(otaChannels)
			.values(DEFAULT_NAMES.map((name) => ({ hotelId, name })))
			.onConflictDoNothing();
		rows = await db.select().from(otaChannels).where(eq(otaChannels.hotelId, hotelId)).orderBy(asc(otaChannels.name));
	}
	return opts.activeOnly ? rows.filter((r) => r.isActive) : rows;
}

/** The configured name for what staff picked (case-insensitive), or an error: only listed, active OTAs can take a booking. */
export async function resolveActiveOtaName(hotelId: string, picked: string): Promise<string> {
	const want = clean(picked).toLowerCase();
	const hit = (await listOtaChannels(hotelId, { activeOnly: true })).find((c) => c.name.toLowerCase() === want);
	if (!hit) throw new OtaChannelError('Pick one of the OTAs set up for this hotel.');
	return hit.name;
}

export async function addOtaChannel(hotelId: string, name: string): Promise<OtaChannel> {
	const n = clean(name);
	if (!n || n.length > 60) throw new OtaChannelError('Enter the OTA name (up to 60 characters).');
	await listOtaChannels(hotelId); // seeds the defaults first, so adding the first one does not hide them
	const [row] = await db.insert(otaChannels).values({ hotelId, name: n }).onConflictDoNothing().returning();
	if (!row) throw new OtaChannelError(`${n} is already in the list.`);
	return row;
}

/** Renames the channel and every booking made under it, so the OTA payouts tab never splits one OTA in two. */
export async function renameOtaChannel(hotelId: string, id: string, name: string): Promise<void> {
	const n = clean(name);
	if (!n || n.length > 60) throw new OtaChannelError('Enter the OTA name (up to 60 characters).');
	await db.transaction(async (tx) => {
		const [ch] = await tx.select().from(otaChannels).where(and(eq(otaChannels.id, id), eq(otaChannels.hotelId, hotelId))).for('update');
		if (!ch) throw new OtaChannelError('OTA not found.');
		const [clash] = await tx
			.select({ id: otaChannels.id })
			.from(otaChannels)
			.where(and(eq(otaChannels.hotelId, hotelId), sql`lower(${otaChannels.name}) = ${n.toLowerCase()}`, sql`${otaChannels.id} <> ${id}`));
		if (clash) throw new OtaChannelError(`${n} is already in the list.`);
		await tx.update(otaChannels).set({ name: n }).where(eq(otaChannels.id, id));
		await tx.update(orders).set({ otaName: n }).where(and(eq(orders.hotelId, hotelId), eq(orders.otaName, ch.name)));
		// Their ledger accounts are billed to the OTA by name.
		await tx
			.update(receivables)
			.set({ billToName: n })
			.where(and(eq(receivables.hotelId, hotelId), sql`${receivables.orderId} in (select id from orders where hotel_id = ${hotelId} and ota_name = ${n})`));
	});
}

export async function setOtaChannelActive(hotelId: string, id: string, isActive: boolean): Promise<void> {
	const res = await db
		.update(otaChannels)
		.set({ isActive })
		.where(and(eq(otaChannels.id, id), eq(otaChannels.hotelId, hotelId)))
		.returning({ id: otaChannels.id });
	if (res.length === 0) throw new OtaChannelError('OTA not found.');
}
