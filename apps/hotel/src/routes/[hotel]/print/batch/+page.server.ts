import { error } from '@sveltejs/kit';
import { roleCan } from '$lib/authz';
import { parseBranding } from '$lib/server/branding';
import { getBirSettings, getDocumentForRender } from '$lib/server/finance/documents';
import { parseBatchIds } from '$lib/print-batch';
import type { PageServerLoad } from './$types';

/**
 * Several receipts or invoices in one print job (a table settled with one document per order).
 * Staff only: finance staff, or dining staff for restaurant documents. There is deliberately no
 * guest-token path here, a guest opens their own document from its single link.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const hotel = locals.hotel!;
	const ids = parseBatchIds(url.searchParams.get('ids'));
	if (ids.length === 0) error(404, 'Nothing to print');

	const isStaff =
		(locals.user?.isPlatformAdmin ?? false) || (locals.role ? roleCan(locals.role.capabilities, 'folio:read') : false);
	const isDiningStaff = locals.role ? roleCan(locals.role.capabilities, 'dining:read') : false;

	const rendered = await Promise.all(ids.map((id) => getDocumentForRender(hotel.id, id)));
	const docs = rendered.map((r) => {
		if (!r || r.document.status === 'spoiled') error(404, 'Document not found');
		if (!isStaff && !(isDiningStaff && r.document.diningOrderId)) error(403, 'You cannot print this document.');
		return { snapshot: r.snapshot, cancelled: r.document.status === 'cancelled' };
	});

	const bir = await getBirSettings(hotel.id);
	return {
		docs,
		logoUrl: parseBranding(hotel.config).logoUrl ?? null,
		thermalPaperWidthMm: (bir?.thermalPaperWidthMm === 58 ? 58 : 80) as 58 | 80,
		format: url.searchParams.get('format') === 'a4' ? ('a4' as const) : ('thermal' as const)
	};
};
