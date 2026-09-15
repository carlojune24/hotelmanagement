import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireCap } from '$lib/server/auth/rbac';
import { db } from '$lib/server/db/index';
import { hotels, standaloneSaleItems, standaloneSales } from '$lib/server/db/schema/index';
import { getBirSettings } from '$lib/server/finance/documents';
import type { PageServerLoad } from './$types';

/** Staff-only — a walk-up sale has no guest-facing access-token path (there's no
 *  guest record to send a link to), same reasoning as the registration card. */
export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'payment:create');
	const hotel = locals.hotel!;

	const [sale] = await db
		.select()
		.from(standaloneSales)
		.where(eq(standaloneSales.id, params.saleId))
		.limit(1);
	if (!sale || sale.hotelId !== hotel.id) error(404, 'Sale not found');

	const [items, [hotelRow], bir] = await Promise.all([
		db.select().from(standaloneSaleItems).where(eq(standaloneSaleItems.saleId, sale.id)),
		db
			.select({ name: hotels.name, legalName: hotels.legalName, addressLine: hotels.addressLine, city: hotels.city })
			.from(hotels)
			.where(eq(hotels.id, hotel.id))
			.limit(1),
		getBirSettings(hotel.id)
	]);

	return {
		saleRef: `SALE-${sale.id.slice(0, 8).toUpperCase()}`,
		issuedAtIso: sale.createdAt.toISOString(),
		method: sale.method,
		totalCentavos: sale.totalCentavos,
		tenderedCentavos: sale.tenderedCentavos,
		changeCentavos: sale.changeCentavos,
		lines: items.map((i) => ({
			description: i.description,
			quantity: i.quantity,
			unitPriceCentavos: i.unitPriceCentavos,
			lineTotalCentavos: i.lineTotalCentavos
		})),
		hotel: {
			name: hotelRow?.name ?? hotel.name,
			legalName: hotelRow?.legalName ?? null,
			address: bir?.registeredAddress || [hotelRow?.addressLine, hotelRow?.city].filter(Boolean).join(', ') || null,
			tin: bir?.tin ?? null,
			isVatRegistered: bir?.isVatRegistered ?? false
		},
		widthMm: (bir?.thermalPaperWidthMm === 58 ? 58 : 80) as 58 | 80
	};
};
