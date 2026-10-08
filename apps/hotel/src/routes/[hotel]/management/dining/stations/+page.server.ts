import { fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { diningMenuItems, diningStations } from '$lib/server/db/schema/index';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { listStations } from '$lib/server/dining-menu';
import { recordId } from '$lib/rate-validation';
import type { RequestEvent } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const hotelId = locals.hotel!.id;
	const stations = await listStations(hotelId);
	// How many dishes sit on each station, so a delete warns about what it unassigns.
	const items = await db
		.select({ stationId: diningMenuItems.stationId })
		.from(diningMenuItems)
		.where(eq(diningMenuItems.hotelId, hotelId));
	const counts: Record<string, number> = {};
	for (const i of items) if (i.stationId) counts[i.stationId] = (counts[i.stationId] ?? 0) + 1;
	return { stations, counts };
};

/** Station edits need `dining:manage` (hotel admins also qualify through `hotel:admin`). */
function requireManage(event: RequestEvent) {
	const { user, role } = event.locals;
	if (user?.isPlatformAdmin) return;
	if (role && roleCan(role.capabilities, 'hotel:admin')) return;
	requireCap(user, role, 'dining:manage');
}

const stationName = z.string().trim().min(1, 'Give the station a name.').max(40);

/** Postgres unique-violation, whether drizzle surfaces it directly or on `cause`. */
const isDuplicate = (e: unknown) =>
	(e as { code?: string })?.code === '23505' ||
	(e as { cause?: { code?: string } })?.cause?.code === '23505';

export const actions: Actions = {
	createStation: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({ name: stationName })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Give the station a name.' });
		try {
			const [row] = await db
				.insert(diningStations)
				.values({ hotelId, name: parsed.data.name })
				.returning({ id: diningStations.id });
			await writeAudit({
				hotelId,
				actor: event.locals.user,
				action: 'dining_station.create',
				entityType: 'dining_station',
				entityId: row!.id,
				after: parsed.data
			});
		} catch (e) {
			if (isDuplicate(e)) return fail(400, { error: `You already have a station called "${parsed.data.name}".` });
			throw e;
		}
		return { ok: `Added station "${parsed.data.name}".` };
	},

	renameStation: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({ stationId: recordId(), name: stationName })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the station name.' });
		try {
			const updated = await db
				.update(diningStations)
				.set({ name: parsed.data.name, updatedAt: new Date() })
				.where(and(eq(diningStations.id, parsed.data.stationId), eq(diningStations.hotelId, hotelId)))
				.returning({ id: diningStations.id });
			if (updated.length === 0) return fail(404, { error: 'Station not found.' });
		} catch (e) {
			if (isDuplicate(e)) return fail(400, { error: `You already have a station called "${parsed.data.name}".` });
			throw e;
		}
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_station.update',
			entityType: 'dining_station',
			entityId: parsed.data.stationId,
			after: { name: parsed.data.name }
		});
		return { ok: 'Station renamed.' };
	},

	deleteStation: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({ stationId: recordId() })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Station not found.' });
		// Dishes on this station become unassigned (FK is ON DELETE SET NULL).
		const deleted = await db
			.delete(diningStations)
			.where(and(eq(diningStations.id, parsed.data.stationId), eq(diningStations.hotelId, hotelId)))
			.returning({ id: diningStations.id });
		if (deleted.length === 0) return fail(404, { error: 'Station not found.' });
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_station.delete',
			entityType: 'dining_station',
			entityId: parsed.data.stationId
		});
		return { ok: 'Station deleted. Its dishes are now unassigned.' };
	},
};
