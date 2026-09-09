import { error } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { DocumentError, getBirSettings, getLiquidationRegister } from '$lib/server/finance/documents';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotel = locals.hotel!;

	try {
		const register = await getLiquidationRegister(hotel.id, params.seriesId);
		const bir = await getBirSettings(hotel.id);
		return {
			register,
			hotelName: hotel.name,
			hotelTin: bir?.tin ?? null,
			printedAt: new Date().toISOString().slice(0, 16).replace('T', ' ')
		};
	} catch (e) {
		if (e instanceof DocumentError) error(404, e.message);
		throw e;
	}
};
