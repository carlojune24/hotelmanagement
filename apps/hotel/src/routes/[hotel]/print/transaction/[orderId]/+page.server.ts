import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { hotels } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { load as loadTransaction } from '../../../management/transactions/[orderId]/+page.server';
import type { PageServerLoad } from './$types';

/** Staff-only. Reuses the Transaction page's own loader so the printout can never disagree with
 *  what staff see on screen (same rooms, payments, deposits, city ledger and balance). */
export const load: PageServerLoad = async (event) => {
	requireCap(event.locals.user, event.locals.role, 'booking:read');
	const hotel = event.locals.hotel!;
	const t = (await (loadTransaction as unknown as (e: unknown) => Promise<Record<string, any>>)(event)) as any;

	const [h] = await db
		.select({ name: hotels.name, legalName: hotels.legalName, addressLine: hotels.addressLine, city: hotels.city })
		.from(hotels)
		.where(eq(hotels.id, hotel.id))
		.limit(1);

	return {
		data: {
			hotel: {
				name: h?.name ?? hotel.name,
				legalName: h?.legalName ?? null,
				address: [h?.addressLine, h?.city].filter(Boolean).join(', ') || null
			},
			order: t.order,
			guest: t.guest,
			lines: t.lines,
			payments: t.payments,
			ledger: t.ledger,
			cityLedgerAccount: t.cityLedgerAccount
		},
		printedAt: new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
	};
};
