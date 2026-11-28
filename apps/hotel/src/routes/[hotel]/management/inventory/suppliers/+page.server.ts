import { fail } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { requireCap } from '$lib/server/auth/rbac';
import { FinanceError } from '$lib/server/finance/shared';
import { createVendor, deleteVendor, listVendors, updateVendor } from '$lib/server/finance/accounts';
import type { Actions, PageServerLoad } from './$types';

/**
 * The hotel's supplier list (the `vendors` table Finance's expenses use too). Managed here, by
 * hotel admins and inventory managers (`inventory:manage`); Restock and Expenses pick from it.
 */
export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'inventory:manage');
	const hotelId = locals.hotel!.id;
	const [vendors, used] = await Promise.all([
		listVendors(hotelId, { includeInactive: true }),
		db.execute<{ vendor_id: string; receipts: number; last: string | null }>(sql`
			select r.vendor_id, count(*)::int receipts, max(r.receipt_date)::text last
			from stock_restocks r where r.hotel_id = ${hotelId} and r.vendor_id is not null and r.voided_at is null
			group by r.vendor_id`)
	]);
	const byVendor = new Map(used.map((u) => [u.vendor_id, u]));
	return {
		suppliers: vendors.map((v) => ({
			id: v.id,
			name: v.name,
			tin: v.tin,
			address: v.address,
			contactName: v.contactName,
			contactPhone: v.contactPhone,
			contactEmail: v.contactEmail,
			isActive: v.isActive,
			receipts: byVendor.get(v.id)?.receipts ?? 0,
			lastReceipt: byVendor.get(v.id)?.last ?? null
		}))
	};
};

const text = (max: number) => z.string().trim().max(max).optional();
const fields = z.object({
	id: z.union([z.literal(''), z.string().uuid()]).optional(),
	name: z.string().trim().min(1, 'Give the supplier a name.').max(160),
	tin: text(40),
	address: text(300),
	contactName: text(120),
	contactPhone: text(40),
	contactEmail: text(160),
	isActive: z.literal('on').optional()
});

async function run(fn: () => Promise<unknown>, ok: string) {
	try {
		await fn();
		return { ok };
	} catch (e) {
		if (e instanceof FinanceError) return fail(400, { error: e.message.replace('vendor', 'supplier') });
		throw e;
	}
}

export const actions: Actions = {
	save: async ({ locals, request }) => {
		requireCap(locals.user, locals.role, 'inventory:manage');
		const hotelId = locals.hotel!.id;
		const p = fields.safeParse(Object.fromEntries(await request.formData()));
		if (!p.success) return fail(400, { error: p.error.issues[0]?.message ?? 'Check the supplier.' });
		const { id, isActive, ...rest } = p.data;
		// A typed name already on the list (any case) would make the pickers ambiguous.
		const clash = (await listVendors(hotelId, { includeInactive: true })).find((v) => v.id !== id && v.name.toLowerCase() === rest.name.toLowerCase());
		if (clash) return fail(400, { error: `There is already a supplier called "${clash.name}".` });
		if (id) return run(() => updateVendor(hotelId, id, { ...rest, isActive: isActive === 'on' }, locals.user), `${rest.name} saved.`);
		return run(() => createVendor(hotelId, rest, locals.user), `${rest.name} added.`);
	},

	delete: async ({ locals, request }) => {
		requireCap(locals.user, locals.role, 'inventory:manage');
		const id = z.string().uuid().safeParse((await request.formData()).get('id'));
		if (!id.success) return fail(400, { error: 'That supplier could not be found.' });
		return run(() => deleteVendor(locals.hotel!.id, id.data, locals.user), 'Supplier removed.');
	}
};
