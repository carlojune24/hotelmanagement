import { fail } from '@sveltejs/kit';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	amenities,
	amenityCategory,
	amenityScope,
	hotelAmenities,
	roomTypeAmenities,
	roomTypes
} from '$lib/server/db/schema/index';
import {
	AMENITY_CATEGORY_LABELS,
	AMENITY_CATEGORY_ORDER,
	amenitySlug,
	seedHotelAmenities
} from '$lib/server/amenities/catalog';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotelId = locals.hotel!.id;

	const rows = await db
		.select({
			id: amenities.id,
			name: amenities.name,
			slug: amenities.slug,
			icon: amenities.icon,
			category: amenities.category,
			scope: amenities.scope,
			description: amenities.description,
			isActive: amenities.isActive,
			sortOrder: amenities.sortOrder,
			hotelWide: sql<boolean>`${hotelAmenities.id} is not null`
		})
		.from(amenities)
		.leftJoin(
			hotelAmenities,
			and(eq(hotelAmenities.amenityId, amenities.id), eq(hotelAmenities.hotelId, hotelId))
		)
		.where(eq(amenities.hotelId, hotelId))
		.orderBy(asc(amenities.sortOrder), asc(amenities.name));

	const [types, links] = await Promise.all([
		db
			.select({ id: roomTypes.id, name: roomTypes.name })
			.from(roomTypes)
			.where(eq(roomTypes.hotelId, hotelId))
			.orderBy(asc(roomTypes.sortOrder), asc(roomTypes.name)),
		db
			.select({
				amenityId: roomTypeAmenities.amenityId,
				roomTypeId: roomTypeAmenities.roomTypeId
			})
			.from(roomTypeAmenities)
			.where(eq(roomTypeAmenities.hotelId, hotelId))
	]);

	const byAmenity = new Map<string, string[]>();
	for (const l of links) {
		const list = byAmenity.get(l.amenityId);
		if (list) list.push(l.roomTypeId);
		else byAmenity.set(l.amenityId, [l.roomTypeId]);
	}

	const items = rows.map((r) => ({ ...r, roomTypeIds: byAmenity.get(r.id) ?? [] }));

	const groups = AMENITY_CATEGORY_ORDER.map((key) => ({
		key,
		label: AMENITY_CATEGORY_LABELS[key],
		items: items.filter((r) => r.category === key)
	})).filter((g) => g.items.length > 0);

	return {
		groups,
		roomTypes: types,
		total: rows.length,
		categoryOptions: AMENITY_CATEGORY_ORDER.map((key) => ({
			value: key,
			label: AMENITY_CATEGORY_LABELS[key]
		}))
	};
};

const upsertSchema = z.object({
	name: z.string().trim().min(2).max(80),
	category: z.enum(amenityCategory.enumValues),
	scope: z.enum(amenityScope.enumValues),
	icon: z.string().trim().max(40).optional(),
	description: z.string().trim().max(300).optional()
});

export const actions: Actions = {
	create: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const parsed = upsertSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Check the amenity details and try again.' });

		const [{ max } = { max: 0 }] = await db
			.select({ max: sql<number>`coalesce(max(${amenities.sortOrder}), 0)::int` })
			.from(amenities)
			.where(eq(amenities.hotelId, hotelId));

		try {
			const [row] = await db
				.insert(amenities)
				.values({
					hotelId,
					name: parsed.data.name,
					slug: amenitySlug(parsed.data.name),
					icon: parsed.data.icon || null,
					category: parsed.data.category,
					scope: parsed.data.scope,
					description: parsed.data.description || null,
					sortOrder: max + 1
				})
				.returning({ id: amenities.id });

			await writeAudit({
				hotelId,
				actor: event.locals.user,
				action: 'amenity.create',
				entityType: 'amenity',
				entityId: row!.id,
				after: { name: parsed.data.name }
			});
		} catch (e) {
			if (e instanceof Error && 'code' in e && (e as { code: string }).code === '23505') {
				return fail(400, { error: `"${parsed.data.name}" already exists.` });
			}
			throw e;
		}

		return { ok: 'Amenity added.' };
	},

	update: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const form = Object.fromEntries(await event.request.formData());
		const id = z.string().uuid().safeParse(form.id);
		if (!id.success) return fail(400, { error: 'Unknown amenity.' });
		const parsed = upsertSchema.safeParse(form);
		if (!parsed.success) return fail(400, { error: 'Check the amenity details and try again.' });

		const res = await db
			.update(amenities)
			.set({
				name: parsed.data.name,
				icon: parsed.data.icon || null,
				category: parsed.data.category,
				scope: parsed.data.scope,
				description: parsed.data.description || null,
				isActive: form.isActive === 'on' || form.isActive === 'true',
				updatedAt: new Date()
			})
			.where(and(eq(amenities.id, id.data), eq(amenities.hotelId, hotelId)))
			.returning({ id: amenities.id });
		if (res.length === 0) return fail(404, { error: 'Amenity not found.' });

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'amenity.update',
			entityType: 'amenity',
			entityId: id.data
		});
		return { ok: 'Amenity updated.' };
	},

	remove: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const id = z
			.string()
			.uuid()
			.safeParse((await event.request.formData()).get('id'));
		if (!id.success) return fail(400, { error: 'Unknown amenity.' });

		const res = await db
			.delete(amenities)
			.where(and(eq(amenities.id, id.data), eq(amenities.hotelId, hotelId)))
			.returning({ id: amenities.id });
		if (res.length === 0) return fail(404, { error: 'Amenity not found.' });

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'amenity.delete',
			entityType: 'amenity',
			entityId: id.data
		});
		return { ok: 'Amenity removed.' };
	},

	toggleHotelWide: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const form = await event.request.formData();
		const id = z.string().uuid().safeParse(form.get('id'));
		if (!id.success) return fail(400, { error: 'Unknown amenity.' });
		const on = form.get('on') === 'true';

		// Guard: only amenities belonging to this hotel.
		const [owned] = await db
			.select({ id: amenities.id, scope: amenities.scope })
			.from(amenities)
			.where(and(eq(amenities.id, id.data), eq(amenities.hotelId, hotelId)));
		if (!owned) return fail(404, { error: 'Amenity not found.' });
		if (on && owned.scope === 'room_type') {
			return fail(400, { error: 'This amenity is set to apply at room-type level only.' });
		}

		if (on) {
			await db
				.insert(hotelAmenities)
				.values({ hotelId, amenityId: id.data })
				.onConflictDoNothing({ target: [hotelAmenities.hotelId, hotelAmenities.amenityId] });
		} else {
			await db
				.delete(hotelAmenities)
				.where(and(eq(hotelAmenities.hotelId, hotelId), eq(hotelAmenities.amenityId, id.data)));
		}
		return { ok: on ? 'Offered hotel-wide.' : 'Removed from hotel-wide.' };
	},

	toggleRoomType: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const form = await event.request.formData();
		const amenityId = z.string().uuid().safeParse(form.get('amenityId'));
		const roomTypeId = z.string().uuid().safeParse(form.get('roomTypeId'));
		if (!amenityId.success || !roomTypeId.success) {
			return fail(400, { error: 'Unknown amenity or room type.' });
		}
		const on = form.get('on') === 'true';

		const [amenity] = await db
			.select({ id: amenities.id, scope: amenities.scope })
			.from(amenities)
			.where(and(eq(amenities.id, amenityId.data), eq(amenities.hotelId, hotelId)));
		if (!amenity) return fail(404, { error: 'Amenity not found.' });
		if (on && amenity.scope === 'hotel') {
			return fail(400, { error: 'This amenity is set to apply hotel-wide only.' });
		}

		const [roomType] = await db
			.select({ id: roomTypes.id, name: roomTypes.name })
			.from(roomTypes)
			.where(and(eq(roomTypes.id, roomTypeId.data), eq(roomTypes.hotelId, hotelId)));
		if (!roomType) return fail(404, { error: 'Room type not found.' });

		if (on) {
			const [{ max } = { max: 0 }] = await db
				.select({ max: sql<number>`coalesce(max(${roomTypeAmenities.sortOrder}), 0)::int` })
				.from(roomTypeAmenities)
				.where(eq(roomTypeAmenities.roomTypeId, roomTypeId.data));
			await db
				.insert(roomTypeAmenities)
				.values({
					hotelId,
					roomTypeId: roomTypeId.data,
					amenityId: amenityId.data,
					sortOrder: max + 1
				})
				.onConflictDoNothing({
					target: [roomTypeAmenities.roomTypeId, roomTypeAmenities.amenityId]
				});
		} else {
			await db
				.delete(roomTypeAmenities)
				.where(
					and(
						eq(roomTypeAmenities.roomTypeId, roomTypeId.data),
						eq(roomTypeAmenities.amenityId, amenityId.data)
					)
				);
		}

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'amenity.toggle_room_type',
			entityType: 'amenity',
			entityId: amenityId.data,
			after: { roomTypeId: roomTypeId.data, on }
		});

		return { ok: on ? `Added to ${roomType.name}.` : `Removed from ${roomType.name}.` };
	},

	loadStandard: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		await seedHotelAmenities(db, hotelId);
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'amenity.load_standard',
			entityType: 'hotel',
			entityId: hotelId
		});
		return { ok: 'Standard amenities loaded.' };
	}
};
