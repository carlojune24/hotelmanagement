import { fail, redirect } from '@sveltejs/kit';
import { asc, eq, isNull, max } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { hotels } from '$lib/server/db/schema/index';
import { seedHotelAmenities } from '$lib/server/amenities/catalog';
import { seedFinanceDefaults } from '$lib/server/finance/seed-defaults';
import { seedDefaultRoles } from '$lib/server/auth/roles';
import { writeAudit } from '$lib/server/audit';
import { mintRef } from '$lib/server/ids';
import { slugError } from '$lib/server/tenant';
import { requirePlatformAdmin } from '$lib/server/auth/rbac';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const rows = await db
		.select({
			id: hotels.id,
			slug: hotels.slug,
			name: hotels.name,
			status: hotels.status,
			city: hotels.city,
			sortOrder: hotels.sortOrder
		})
		.from(hotels)
		.where(isNull(hotels.deletedAt))
		.orderBy(asc(hotels.sortOrder), asc(hotels.name));
	return { hotels: rows };
};

const createSchema = z.object({
	name: z.string().min(2).max(160),
	slug: z.string().min(3).max(40)
});

export const actions: Actions = {
	/** Moves a hotel one place up or down, then renumbers 1..n so ties can never build up. */
	move: async (event) => {
		requirePlatformAdmin(event.locals.user);
		const f = await event.request.formData();
		const id = String(f.get('id') ?? '');
		const dir = f.get('dir') === 'up' ? -1 : 1;
		const rows = await db
			.select({ id: hotels.id })
			.from(hotels)
			.where(isNull(hotels.deletedAt))
			.orderBy(asc(hotels.sortOrder), asc(hotels.name));
		const from = rows.findIndex((r) => r.id === id);
		const to = from + dir;
		if (from < 0 || to < 0 || to >= rows.length) return { ok: true };
		const ids = rows.map((r) => r.id);
		[ids[from], ids[to]] = [ids[to]!, ids[from]!];
		await db.transaction(async (tx) => {
			for (const [i, hid] of ids.entries()) {
				await tx.update(hotels).set({ sortOrder: i + 1 }).where(eq(hotels.id, hid));
			}
		});
		return { ok: true };
	},

	create: async (event) => {
		requirePlatformAdmin(event.locals.user);
		const parsed = createSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Enter a name and slug.' });

		const slug = parsed.data.slug.toLowerCase().trim();
		const slugErr = slugError(slug);
		if (slugErr) return fail(400, { error: slugErr });

		let newId: string;
		try {
			const [top] = await db.select({ n: max(hotels.sortOrder) }).from(hotels);
			const [row] = await db
				.insert(hotels)
				.values({ name: parsed.data.name.trim(), slug, orgRef: mintRef('org'), sortOrder: (top?.n ?? 0) + 1 })
				.returning({ id: hotels.id });
			newId = row!.id;
		} catch (e) {
			if (e instanceof Error && 'code' in e && (e as { code: string }).code === '23505') {
				return fail(400, { error: `The slug "${slug}" is already taken.` });
			}
			throw e;
		}

		// Give the new hotel the standard amenity catalogue, a working Finance setup, and
		// its default role set (so the first hotel_admin invite has a role to grant).
		await seedHotelAmenities(db, newId);
		await seedFinanceDefaults(db, newId);
		await seedDefaultRoles(db, newId);

		await writeAudit({
			actor: event.locals.user,
			action: 'hotel.create',
			entityType: 'hotel',
			entityId: newId,
			after: { slug, name: parsed.data.name }
		});
		redirect(303, `/admin/hotels/${newId}`);
	}
};
