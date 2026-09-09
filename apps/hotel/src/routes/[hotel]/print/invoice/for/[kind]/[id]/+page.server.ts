import { error } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { parseBranding } from '$lib/server/branding';
import { DocumentError, getOrIssueInvoiceForTarget } from '$lib/server/finance/documents';
import type { FolioTarget } from '$lib/server/folio';
import type { PageServerLoad } from './$types';

/**
 * Staff convenience: issue (or fetch) the Invoice for a booking / hall booking and
 * render it, without needing the `documents.id` up front. Guests always receive a
 * canonical `/print/invoice/[documentId]?t=…` link instead.
 */
export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'folio:read');
	const hotel = locals.hotel!;

	if (params.kind !== 'booking' && params.kind !== 'hall') error(404, 'Not found');
	const target: FolioTarget =
		params.kind === 'booking'
			? { kind: 'room', bookingId: params.id }
			: { kind: 'hall', hallBookingId: params.id };

	try {
		const rendered = await getOrIssueInvoiceForTarget(hotel.id, target, locals.user ?? null);
		return {
			snapshot: rendered.snapshot,
			logoUrl: parseBranding(hotel.config).logoUrl ?? null
		};
	} catch (e) {
		if (e instanceof DocumentError) error(409, e.message);
		throw e;
	}
};
