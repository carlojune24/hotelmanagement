import { asc, eq, min } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { ratePlans, roomTypes, rooms } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import type { LayoutServerLoad } from './$types';
import type { BedConfigEntry, RoomPhoto } from '$lib/server/db/schema/inventory';

export const load: LayoutServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotelId = locals.hotel!.id;

	const types = await db
		.select()
		.from(roomTypes)
		.where(eq(roomTypes.hotelId, hotelId))
		.orderBy(asc(roomTypes.sortOrder), asc(roomTypes.name));

	const fromPrice = await db
		.select({ roomTypeId: ratePlans.roomTypeId, price: min(ratePlans.basePriceCentavos) })
		.from(ratePlans)
		.where(eq(ratePlans.hotelId, hotelId))
		.groupBy(ratePlans.roomTypeId);
	const priceByType = new Map(fromPrice.map((p) => [p.roomTypeId, p.price]));

	const roomList = await db
		.select()
		.from(rooms)
		.where(eq(rooms.hotelId, hotelId))
		.orderBy(asc(rooms.roomNumber));
	const typeById = new Map(types.map((t) => [t.id, t]));

	return {
		roomTypeList: types.map((t) => ({
			id: t.id,
			name: t.name,
			code: t.code,
			category: t.category,
			sizeSqm: t.sizeSqm,
			baseOccupancy: t.baseOccupancy,
			maxOccupancy: t.maxOccupancy,
			bedConfiguration: t.bedConfiguration as BedConfigEntry[],
			roomCount: roomList.filter((r) => r.roomTypeId === t.id).length,
			fromPriceCentavos: priceByType.get(t.id) ?? null
		})),
		roomList: roomList.map((r) => {
			const t = typeById.get(r.roomTypeId);
			return {
				id: r.id,
				roomNumber: r.roomNumber,
				floor: r.floor,
				buildingBlock: r.buildingBlock,
				operationalStatus: r.operationalStatus,
				isActive: r.isActive,
				isConnecting: r.isConnecting,
				roomTypeId: r.roomTypeId,
				roomTypeName: t?.name ?? '—',
				maxOccupancy: t?.maxOccupancy ?? null,
				sizeSqm: t?.sizeSqm ?? null,
				photo: (r.photos as RoomPhoto[])[0]?.url ?? null
			};
		}),
		roomTypeOptions: types.map((t) => ({ id: t.id, name: t.name }))
	};
};
