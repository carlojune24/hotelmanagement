import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { bookings, hallBookings, orders } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { parseBranding } from '$lib/server/branding';
import { DocumentError, getBirSettings, getOrIssueInvoiceForTarget } from '$lib/server/finance/documents';
import type { FolioTarget } from '$lib/server/folio';
import type { PageServerLoad } from './$types';

/**
 * Staff convenience: every booking/hall-booking line under one order, each issued (or
 * fetched) and rendered as its own invoice — same official per-line numbering
 * `/print/invoice/for/[kind]/[id]` already issues, just batched into one print job so
 * staff isn't opening a separate tab per line on a multi-room order.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCap(locals.user, locals.role, 'folio:read');
	const hotel = locals.hotel!;

	const [order] = await db
		.select({ id: orders.id, hotelId: orders.hotelId })
		.from(orders)
		.where(eq(orders.id, params.orderId));
	if (!order || order.hotelId !== hotel.id) error(404, 'Not found');

	const [roomLines, hallLines] = await Promise.all([
		db.select({ id: bookings.id }).from(bookings).where(eq(bookings.orderId, order.id)),
		db.select({ id: hallBookings.id }).from(hallBookings).where(eq(hallBookings.orderId, order.id))
	]);

	const targets: FolioTarget[] = [
		...roomLines.map((r): FolioTarget => ({ kind: 'room', bookingId: r.id })),
		...hallLines.map((h): FolioTarget => ({ kind: 'hall', hallBookingId: h.id }))
	];
	if (targets.length === 0) error(404, 'Not found');

	try {
		const [rendered, birSettings] = await Promise.all([
			Promise.all(
				targets.map((target) => getOrIssueInvoiceForTarget(hotel.id, target, locals.user ?? null))
			),
			getBirSettings(hotel.id)
		]);
		return {
			snapshots: rendered.map((r) => r.snapshot),
			logoUrl: parseBranding(hotel.config).logoUrl ?? null,
			thermalPaperWidthMm: (birSettings?.thermalPaperWidthMm === 58 ? 58 : 80) as 58 | 80,
			format: url.searchParams.get('format') === 'a4' ? ('a4' as const) : ('thermal' as const)
		};
	} catch (e) {
		if (e instanceof DocumentError) error(409, e.message);
		throw e;
	}
};
