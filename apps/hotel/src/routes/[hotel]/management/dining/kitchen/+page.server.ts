import { fail } from '@sveltejs/kit';
import { and, asc, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { diningItems, diningOrders } from '$lib/server/db/schema/index';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { recordId } from '$lib/rate-validation';
import { listStations } from '$lib/server/dining-menu';
import { OrderError, listBoardOrders, setDiningOrderStatus } from '$lib/server/dining-orders';
import { expirePendingDiningOrders } from '$lib/server/dining-online';
import type { Actions, PageServerLoad } from './$types';

const isBusinessError = (e: unknown) => e instanceof OrderError;

/** The kitchen sees an order only while it can still be cooked, so served orders are left out. */
export const load: PageServerLoad = async ({ locals, url, depends }) => {
	depends('app:dining-kitchen');
	requireCap(locals.user, locals.role, 'dining:read');
	const hotelId = locals.hotel!.id;

	const venues = await db
		.select({ id: diningItems.id, title: diningItems.title })
		.from(diningItems)
		.where(eq(diningItems.hotelId, hotelId))
		.orderBy(asc(diningItems.sortOrder), asc(diningItems.title));
	const venueId = venues.find((v) => v.id === url.searchParams.get('venue'))?.id ?? null;

	await expirePendingDiningOrders({ hotelId }).catch((e) => console.error('kitchen: expirePendingDiningOrders failed', e));
	const live = await listBoardOrders(hotelId, { venueId, servedSince: new Date(Date.now() + 86_400_000) });
	const orders = live.filter((o) => o.status !== 'served');

	// Orders cancelled in the last 15 minutes, so a cook who already started one is told to stop.
	const cancelled = await db
		.select({ code: diningOrders.code, at: diningOrders.cancelledAt, tableLabel: diningOrders.tableLabel })
		.from(diningOrders)
		.where(
			and(
				eq(diningOrders.hotelId, hotelId),
				eq(diningOrders.status, 'cancelled'),
				gte(diningOrders.cancelledAt, new Date(Date.now() - 15 * 60_000)),
				venueId ? eq(diningOrders.diningItemId, venueId) : undefined
			)
		)
		.orderBy(desc(diningOrders.cancelledAt))
		.limit(5);

	const stations = (await listStations(hotelId)).map((s) => s.name);
	return {
		venues,
		venueId,
		orders,
		cancelled: cancelled.map((c) => ({ code: c.code, tableLabel: c.tableLabel })),
		stations,
		canMove: !!locals.user?.isPlatformAdmin || (!!locals.role && roleCan(locals.role.capabilities, 'dining:write')),
		serverNow: Date.now()
	};
};

export const actions: Actions = {
	/** Start cooking, or mark a ticket ready. Serving stays on the Orders board. */
	advance: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:write');
		const parsed = z
			.object({ orderId: recordId(), to: z.enum(['preparing', 'ready']) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'That order could not be found.' });
		try {
			await setDiningOrderStatus({ hotelId: event.locals.hotel!.id, orderId: parsed.data.orderId, to: parsed.data.to, actor: event.locals.user });
			return { moved: true };
		} catch (e) {
			if (isBusinessError(e)) return fail(400, { error: (e as Error).message });
			throw e;
		}
	}
};
