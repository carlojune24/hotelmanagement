import { fail } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { diningAddonGroups, diningAddons, diningItems } from '$lib/server/db/schema/index';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { loadVenueMenu, venueBelongsToHotel } from '$lib/server/dining-menu';
import { friendlyIssue, moneyPhp, recordId } from '$lib/rate-validation';
import type { RequestEvent } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const hotelId = locals.hotel!.id;

	const venues = await db
		.select({ id: diningItems.id, title: diningItems.title })
		.from(diningItems)
		.where(eq(diningItems.hotelId, hotelId))
		.orderBy(asc(diningItems.sortOrder), asc(diningItems.title));
	const requested = url.searchParams.get('venue');
	const venue = venues.find((v) => v.id === requested) ?? venues[0] ?? null;
	const menu = venue ? await loadVenueMenu(hotelId, venue.id) : null;
	return { venues, venue, groups: menu?.groups ?? [] };
};

function requireManage(event: RequestEvent) {
	const { user, role } = event.locals;
	if (user?.isPlatformAdmin) return;
	if (role && roleCan(role.capabilities, 'hotel:admin')) return;
	requireCap(user, role, 'dining:manage');
}

const toCentavos = (php: number) => Math.round(php * 100);

const optCount = z.preprocess(
	(v) => (v === '' || v == null ? undefined : v),
	z.coerce.number().int().min(0).max(99).optional()
);

const groupSchema = z
	.object({
		name: z.string().trim().min(1, 'Give the group a name.').max(80),
		minChoices: optCount,
		maxChoices: optCount
	})
	.refine((g) => g.maxChoices == null || g.maxChoices >= (g.minChoices ?? 0), {
		message: 'The most a guest can pick must be at least the fewest.'
	});

const firstMessage = (e: z.ZodError, fallback: string) => e.issues[0]?.message ?? fallback;

export const actions: Actions = {
	createGroup: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const venueId = recordId().safeParse(raw.diningItemId);
		const parsed = groupSchema.safeParse(raw);
		if (!parsed.success) return fail(400, { error: firstMessage(parsed.error, 'Check the group details.') });
		if (!venueId.success) return fail(404, { error: 'Venue not found.' });
		if (!(await venueBelongsToHotel(hotelId, venueId.data))) {
			return fail(404, { error: 'Venue not found.' });
		}
		const d = parsed.data;
		const [row] = await db
			.insert(diningAddonGroups)
			.values({
				hotelId,
				diningItemId: venueId.data,
				name: d.name,
				minChoices: d.minChoices ?? 0,
				maxChoices: d.maxChoices ?? null
			})
			.returning({ id: diningAddonGroups.id });
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_addon_group.create',
			entityType: 'dining_addon_group',
			entityId: row!.id,
			after: d
		});
		return { ok: `Added group "${d.name}".` };
	},

	updateGroup: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const groupId = recordId().safeParse(raw.groupId);
		const parsed = groupSchema.safeParse(raw);
		if (!parsed.success) return fail(400, { error: firstMessage(parsed.error, 'Check the group details.') });
		if (!groupId.success) return fail(404, { error: 'Group not found.' });
		const d = parsed.data;
		const updated = await db
			.update(diningAddonGroups)
			.set({
				name: d.name,
				minChoices: d.minChoices ?? 0,
				maxChoices: d.maxChoices ?? null,
				updatedAt: new Date()
			})
			.where(and(eq(diningAddonGroups.id, groupId.data), eq(diningAddonGroups.hotelId, hotelId)))
			.returning({ id: diningAddonGroups.id });
		if (updated.length === 0) return fail(404, { error: 'Group not found.' });
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_addon_group.update',
			entityType: 'dining_addon_group',
			entityId: groupId.data,
			after: d
		});
		return { ok: `Updated "${d.name}".` };
	},

	deleteGroup: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({ groupId: recordId() })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Group not found.' });
		// Its add-ons and item links go with it (ON DELETE CASCADE).
		const deleted = await db
			.delete(diningAddonGroups)
			.where(
				and(eq(diningAddonGroups.id, parsed.data.groupId), eq(diningAddonGroups.hotelId, hotelId))
			)
			.returning({ id: diningAddonGroups.id });
		if (deleted.length === 0) return fail(404, { error: 'Group not found.' });
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_addon_group.delete',
			entityType: 'dining_addon_group',
			entityId: parsed.data.groupId
		});
		return { ok: 'Group deleted and detached from its menu items.' };
	},

	addAddon: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({
				groupId: recordId(),
				name: z.string().trim().min(1, 'Give the add-on a name.').max(80),
				pricePhp: moneyPhp()
			})
			.safeParse({ pricePhp: '0', ...Object.fromEntries(await event.request.formData()) });
		if (!parsed.success) {
			return fail(400, { error: friendlyIssue(parsed.error, firstMessage(parsed.error, 'Check the add-on details.')) });
		}
		const d = parsed.data;
		const [group] = await db
			.select({ id: diningAddonGroups.id })
			.from(diningAddonGroups)
			.where(and(eq(diningAddonGroups.id, d.groupId), eq(diningAddonGroups.hotelId, hotelId)))
			.limit(1);
		if (!group) return fail(404, { error: 'Group not found.' });
		const [row] = await db
			.insert(diningAddons)
			.values({ hotelId, groupId: d.groupId, name: d.name, priceCentavos: toCentavos(d.pricePhp) })
			.returning({ id: diningAddons.id });
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_addon.create',
			entityType: 'dining_addon',
			entityId: row!.id,
			after: d
		});
		return { ok: `Added "${d.name}".` };
	},

	updateAddon: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z
			.object({
				addonId: recordId(),
				name: z.string().trim().min(1, 'Give the add-on a name.').max(80),
				pricePhp: moneyPhp()
			})
			.safeParse(raw);
		if (!parsed.success) {
			return fail(400, { error: friendlyIssue(parsed.error, firstMessage(parsed.error, 'Check the add-on details.')) });
		}
		const d = parsed.data;
		const updated = await db
			.update(diningAddons)
			.set({
				name: d.name,
				priceCentavos: toCentavos(d.pricePhp),
				isAvailable: raw.isAvailable === 'on',
				updatedAt: new Date()
			})
			.where(and(eq(diningAddons.id, d.addonId), eq(diningAddons.hotelId, hotelId)))
			.returning({ id: diningAddons.id });
		if (updated.length === 0) return fail(404, { error: 'Add-on not found.' });
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_addon.update',
			entityType: 'dining_addon',
			entityId: d.addonId,
			after: { name: d.name, pricePhp: d.pricePhp, isAvailable: raw.isAvailable === 'on' }
		});
		return { ok: `Updated "${d.name}".` };
	},

	deleteAddon: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({ addonId: recordId() })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Add-on not found.' });
		const deleted = await db
			.delete(diningAddons)
			.where(and(eq(diningAddons.id, parsed.data.addonId), eq(diningAddons.hotelId, hotelId)))
			.returning({ id: diningAddons.id });
		if (deleted.length === 0) return fail(404, { error: 'Add-on not found.' });
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_addon.delete',
			entityType: 'dining_addon',
			entityId: parsed.data.addonId
		});
		return { ok: 'Add-on removed.' };
	}
};
