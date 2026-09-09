import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { roleCan } from '$lib/authz';
import { db } from '$lib/server/db/index';
import { orders } from '$lib/server/db/schema/index';
import { parseBranding } from '$lib/server/branding';
import { getDocumentForRender } from '$lib/server/finance/documents';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const hotel = locals.hotel!;

	const rendered = await getDocumentForRender(hotel.id, params.documentId);
	if (!rendered || rendered.document.type !== 'invoice') error(404, 'Invoice not found');
	if (rendered.document.status === 'spoiled') error(404, 'Invoice not found');

	// Staff with folio access, or a guest holding the order's access token.
	const isStaff =
		(locals.user?.isPlatformAdmin ?? false) ||
		(locals.role ? roleCan(locals.role, 'folio:read') : false);
	if (!isStaff) {
		const token = url.searchParams.get('t');
		const orderId = rendered.document.orderId;
		const stored = orderId
			? (
					await db
						.select({ token: orders.accessToken })
						.from(orders)
						.where(eq(orders.id, orderId))
						.limit(1)
				)[0]?.token
			: null;
		if (!token || !stored || token !== stored) error(403, 'This document link is not valid.');
	}

	return {
		snapshot: rendered.snapshot,
		logoUrl: parseBranding(hotel.config).logoUrl ?? null,
		cancelled: rendered.document.status === 'cancelled'
	};
};
