import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	amenities,
	ratePlans,
	roomCategory,
	roomTypeAmenities,
	roomTypes,
	rooms,
	smokingPolicy
} from '$lib/server/db/schema/index';
import { AMENITY_CATEGORY_LABELS, AMENITY_CATEGORY_ORDER } from '$lib/server/amenities/catalog';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import type { BedConfigEntry, RoomPhoto } from '$lib/server/db/schema/inventory';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotelId = locals.hotel!.id;

	const [roomType] = await db
		.select()
		.from(roomTypes)
		.where(and(eq(roomTypes.id, params.roomTypeId), eq(roomTypes.hotelId, hotelId)))
		.limit(1);
	if (!roomType) error(404, 'Room type not found');

	const [roomCount] = await db
		.select({ n: rooms.id })
		.from(rooms)
		.where(and(eq(rooms.hotelId, hotelId), eq(rooms.roomTypeId, params.roomTypeId)));

	const plans = await db
		.select()
		.from(ratePlans)
		.where(and(eq(ratePlans.hotelId, hotelId), eq(ratePlans.roomTypeId, params.roomTypeId)))
		.orderBy(asc(ratePlans.name));

	// Amenity picker: every active hotel amenity that can apply to a room type,
	// grouped by category, plus which ones this room type currently has.
	const amenityRows = await db
		.select({
			id: amenities.id,
			name: amenities.name,
			icon: amenities.icon,
			category: amenities.category
		})
		.from(amenities)
		.where(
			and(
				eq(amenities.hotelId, hotelId),
				eq(amenities.isActive, true),
				inArray(amenities.scope, ['room_type', 'both'])
			)
		)
		.orderBy(asc(amenities.sortOrder), asc(amenities.name));

	const amenityGroups = AMENITY_CATEGORY_ORDER.map((key) => ({
		key,
		label: AMENITY_CATEGORY_LABELS[key],
		items: amenityRows.filter((a) => a.category === key)
	})).filter((g) => g.items.length > 0);

	const selectedAmenities = await db
		.select({
			amenityId: roomTypeAmenities.amenityId,
			isHighlighted: roomTypeAmenities.isHighlighted
		})
		.from(roomTypeAmenities)
		.where(eq(roomTypeAmenities.roomTypeId, params.roomTypeId));

	return {
		roomType,
		hasRooms: Boolean(roomCount),
		ratePlans: plans,
		amenityGroups,
		selectedAmenities,
		currency: locals.hotel!.currency,
		vatRateBps: locals.hotel!.vatRateBps
	};
};

const updateSchema = z.object({
	name: z.string().min(2).max(120),
	code: z.string().max(40).optional(),
	category: z.enum(roomCategory.enumValues).optional().or(z.literal('')),
	description: z.string().max(4000).optional(),
	photosJson: z.string(),
	baseOccupancy: z.coerce.number().int().min(1).max(20),
	maxOccupancy: z.coerce.number().int().min(1).max(20),
	maxAdults: z.coerce.number().int().min(0).max(20).optional(),
	maxChildren: z.coerce.number().int().min(0).max(20).optional(),
	extraBedAllowed: z.coerce.boolean(),
	maxExtraBeds: z.coerce.number().int().min(0).max(10).optional(),
	sizeSqm: z.coerce.number().int().min(0).max(10000).optional(),
	bedConfigurationJson: z.string(),
	bedFlexible: z.coerce.boolean(),
	flexibilityNote: z.string().max(500).optional(),
	viewType: z.string().optional(),
	wheelchairAccessible: z.coerce.boolean(),
	rollInShower: z.coerce.boolean(),
	grabBars: z.coerce.boolean(),
	smokingPolicy: z.enum(smokingPolicy.enumValues)
});

function parseJsonArray<T>(raw: string): T[] {
	try {
		const value = JSON.parse(raw);
		return Array.isArray(value) ? value : [];
	} catch {
		return [];
	}
}

export const actions: Actions = {
	update: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const roomTypeId = event.params.roomTypeId;

		const formData = await event.request.formData();
		const raw = Object.fromEntries(formData);
		const parsed = updateSchema.safeParse({
			...raw,
			extraBedAllowed: raw.extraBedAllowed === 'on',
			bedFlexible: raw.bedFlexible === 'on',
			wheelchairAccessible: raw.wheelchairAccessible === 'on',
			rollInShower: raw.rollInShower === 'on',
			grabBars: raw.grabBars === 'on'
		});
		if (!parsed.success) return fail(400, { error: 'Check the room type details and try again.' });
		if (parsed.data.maxOccupancy < parsed.data.baseOccupancy) {
			return fail(400, { error: 'Max occupancy must be at least base occupancy.' });
		}

		const bedConfiguration = parseJsonArray<BedConfigEntry>(parsed.data.bedConfigurationJson);
		const photos = parseJsonArray<RoomPhoto>(parsed.data.photosJson).filter((p) => p.url?.trim());
		const submittedAmenityIds = [...new Set(formData.getAll('amenityIds').map(String))];
		const highlightIds = new Set(formData.getAll('highlightIds').map(String));

		try {
			await db
				.update(roomTypes)
				.set({
					name: parsed.data.name.trim(),
					code: parsed.data.code?.trim() || null,
					category: parsed.data.category || null,
					description: parsed.data.description?.trim() || null,
					photos,
					baseOccupancy: parsed.data.baseOccupancy,
					maxOccupancy: parsed.data.maxOccupancy,
					maxAdults: parsed.data.maxAdults ?? null,
					maxChildren: parsed.data.maxChildren ?? null,
					extraBedAllowed: parsed.data.extraBedAllowed,
					maxExtraBeds: parsed.data.maxExtraBeds ?? null,
					sizeSqm: parsed.data.sizeSqm ?? null,
					bedConfiguration,
					bedFlexible: parsed.data.bedFlexible,
					flexibilityNote: parsed.data.flexibilityNote?.trim() || null,
					viewType: parsed.data.viewType?.trim() || null,
					wheelchairAccessible: parsed.data.wheelchairAccessible,
					rollInShower: parsed.data.rollInShower,
					grabBars: parsed.data.grabBars,
					smokingPolicy: parsed.data.smokingPolicy,
					updatedAt: new Date()
				})
				.where(and(eq(roomTypes.id, roomTypeId), eq(roomTypes.hotelId, hotelId)));
		} catch (e) {
			if (e instanceof Error && 'code' in e && (e as { code: string }).code === '23505') {
				return fail(400, { error: `Room type code "${parsed.data.code}" is already in use.` });
			}
			throw e;
		}

		// Sync the room type ↔ amenity links. Keep only submitted ids that are real
		// amenities of this hotel and allowed at room-type scope.
		const validAmenityIds =
			submittedAmenityIds.length === 0
				? []
				: (
						await db
							.select({ id: amenities.id })
							.from(amenities)
							.where(
								and(
									eq(amenities.hotelId, hotelId),
									inArray(amenities.id, submittedAmenityIds),
									inArray(amenities.scope, ['room_type', 'both'])
								)
							)
					).map((r) => r.id);

		await db.transaction(async (tx) => {
			await tx.delete(roomTypeAmenities).where(eq(roomTypeAmenities.roomTypeId, roomTypeId));
			if (validAmenityIds.length > 0) {
				await tx.insert(roomTypeAmenities).values(
					validAmenityIds.map((id, i) => ({
						hotelId,
						roomTypeId,
						amenityId: id,
						isHighlighted: highlightIds.has(id),
						sortOrder: i
					}))
				);
			}
		});

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'room_type.update',
			entityType: 'room_type',
			entityId: roomTypeId
		});

		return { ok: 'Room type updated.' };
	},

	delete: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const roomTypeId = event.params.roomTypeId;

		const [existing] = await db
			.select({ id: rooms.id })
			.from(rooms)
			.where(and(eq(rooms.hotelId, hotelId), eq(rooms.roomTypeId, roomTypeId)))
			.limit(1);
		if (existing) return fail(400, { error: 'Remove all rooms of this type before deleting it.' });

		await db
			.delete(roomTypes)
			.where(and(eq(roomTypes.id, roomTypeId), eq(roomTypes.hotelId, hotelId)));

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'room_type.delete',
			entityType: 'room_type',
			entityId: roomTypeId
		});

		redirect(303, `/${event.params.hotel}/settings/rooms`);
	}
};
