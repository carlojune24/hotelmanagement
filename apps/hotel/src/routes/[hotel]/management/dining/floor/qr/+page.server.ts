import { fail } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { diningAreas, diningItems, diningTables } from '$lib/server/db/schema/index';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { recordId } from '$lib/rate-validation';
import { qrSvg, tableQrUrl } from '$lib/server/table-qr';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const hotelId = locals.hotel!.id;
	const venues = await db
		.select({ id: diningItems.id, title: diningItems.title })
		.from(diningItems)
		.where(eq(diningItems.hotelId, hotelId))
		.orderBy(asc(diningItems.sortOrder), asc(diningItems.title));
	const venue = venues.find((v) => v.id === url.searchParams.get('venue')) ?? venues[0] ?? null;
	if (!venue) return { venues, venue: null, areas: [], tables: [], canManage: false };

	const areas = await db
		.select({ id: diningAreas.id, name: diningAreas.name })
		.from(diningAreas)
		.where(and(eq(diningAreas.hotelId, hotelId), eq(diningAreas.diningItemId, venue.id)))
		.orderBy(asc(diningAreas.sortOrder), asc(diningAreas.name));
	const rows = await db
		.select({ id: diningTables.id, name: diningTables.name, seats: diningTables.seats, areaId: diningTables.areaId, qrToken: diningTables.qrToken })
		.from(diningTables)
		.where(and(eq(diningTables.hotelId, hotelId), eq(diningTables.diningItemId, venue.id), eq(diningTables.isActive, true)))
		.orderBy(asc(diningTables.name));

	const tables = await Promise.all(
		rows.map(async (t) => {
			const link = tableQrUrl({ requestOrigin: url.origin, slug: locals.hotel!.slug, token: t.qrToken, customDomain: !!locals.isCustomDomain });
			return { id: t.id, name: t.name, seats: t.seats, areaId: t.areaId, link, svg: await qrSvg(link) };
		})
	);
	const can = (cap: string) => !!locals.user?.isPlatformAdmin || (!!locals.role && roleCan(locals.role.capabilities, cap));
	return { venues, venue, areas, tables, canManage: can('dining:manage') || can('hotel:admin') };
};

export const actions: Actions = {
	/** Retires the table's printed QR code and issues a fresh one. */
	rotate: async (event) => {
		const { user, role } = event.locals;
		if (!user?.isPlatformAdmin && !(role && roleCan(role.capabilities, 'hotel:admin'))) requireCap(user, role, 'dining:manage');
		const hotelId = event.locals.hotel!.id;
		const parsed = z.object({ tableId: recordId() }).safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(404, { error: 'Table not found.' });
		const updated = await db
			.update(diningTables)
			.set({ qrToken: randomUUID(), updatedAt: new Date() })
			.where(and(eq(diningTables.id, parsed.data.tableId), eq(diningTables.hotelId, hotelId)))
			.returning({ name: diningTables.name });
		if (updated.length === 0) return fail(404, { error: 'Table not found.' });
		await writeAudit({ hotelId, actor: user, action: 'dining_table.rotate_qr', entityType: 'dining_table', entityId: parsed.data.tableId });
		return { ok: `New QR code for table ${updated[0]!.name}. Reprint it; the old one no longer works.` };
	}
};
