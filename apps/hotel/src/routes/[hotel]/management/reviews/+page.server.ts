import { fail } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { bookingRooms, bookings, reviews, roomTypes } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'review:read');
	const hotelId = locals.hotel!.id;

	const rows = await db
		.select({
			id: reviews.id,
			rating: reviews.rating,
			comment: reviews.comment,
			guestDisplayName: reviews.guestDisplayName,
			status: reviews.status,
			moderationNote: reviews.moderationNote,
			submittedAt: reviews.submittedAt,
			checkIn: bookings.checkIn,
			checkOut: bookings.checkOut,
			roomTypeName: roomTypes.name
		})
		.from(reviews)
		.innerJoin(bookings, eq(bookings.id, reviews.bookingId))
		.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
		.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
		.where(eq(reviews.hotelId, hotelId))
		.orderBy(desc(reviews.submittedAt));

	return { reviews: rows };
};

const moderateSchema = z.object({
	id: z.string().uuid(),
	moderationNote: z.string().max(500).optional()
});

export const actions: Actions = {
	approve: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'review:approve');
		const hotelId = event.locals.hotel!.id;
		const parsed = moderateSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Invalid review.' });

		await db
			.update(reviews)
			.set({
				status: 'approved',
				moderatedAt: new Date(),
				moderatedBy: event.locals.user!.id
			})
			.where(and(eq(reviews.id, parsed.data.id), eq(reviews.hotelId, hotelId)));

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'review.approve',
			entityType: 'review',
			entityId: parsed.data.id
		});

		return { ok: 'Review approved.' };
	},

	reject: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'review:reject');
		const hotelId = event.locals.hotel!.id;
		const parsed = moderateSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Invalid review.' });

		await db
			.update(reviews)
			.set({
				status: 'rejected',
				moderationNote: parsed.data.moderationNote?.trim() || null,
				moderatedAt: new Date(),
				moderatedBy: event.locals.user!.id
			})
			.where(and(eq(reviews.id, parsed.data.id), eq(reviews.hotelId, hotelId)));

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'review.reject',
			entityType: 'review',
			entityId: parsed.data.id
		});

		return { ok: 'Review rejected.' };
	}
};
