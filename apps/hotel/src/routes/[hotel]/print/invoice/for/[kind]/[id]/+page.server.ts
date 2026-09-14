import { error } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { parseBranding } from '$lib/server/branding';
import { DocumentError, getBirSettings, getOrIssueInvoiceForTarget } from '$lib/server/finance/documents';
import type { FolioTarget } from '$lib/server/folio';
import type { PageServerLoad } from './$types';

/**
 * Staff convenience: issue (or fetch) the Invoice for a booking / hall booking and
 * render it, without needing the `documents.id` up front. Guests always receive a
 * canonical `/print/invoice/[documentId]?t=…` link instead.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCap(locals.user, locals.role, 'folio:read');
	const hotel = locals.hotel!;

	if (params.kind !== 'booking' && params.kind !== 'hall') error(404, 'Not found');
	const target: FolioTarget =
		params.kind === 'booking'
			? { kind: 'room', bookingId: params.id }
			: { kind: 'hall', hallBookingId: params.id };

	try {
		const [rendered, birSettings] = await Promise.all([
			getOrIssueInvoiceForTarget(hotel.id, target, locals.user ?? null),
			getBirSettings(hotel.id)
		]);
		return {
			snapshot: rendered.snapshot,
			logoUrl: parseBranding(hotel.config).logoUrl ?? null,
			thermalPaperWidthMm: (birSettings?.thermalPaperWidthMm === 58 ? 58 : 80) as 58 | 80,
			format: url.searchParams.get('format') === 'a4' ? ('a4' as const) : ('thermal' as const)
		};
	} catch (e) {
		if (e instanceof DocumentError) error(409, e.message);
		throw e;
	}
};
