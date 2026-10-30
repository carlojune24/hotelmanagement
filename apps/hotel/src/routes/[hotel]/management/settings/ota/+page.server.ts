import { fail } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { db } from '$lib/server/db/index';
import { orders } from '$lib/server/db/schema/index';
import {
	addOtaChannel,
	listOtaChannels,
	OtaChannelError,
	renameOtaChannel,
	setOtaChannelActive
} from '$lib/server/ota-channels';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotelId = locals.hotel!.id;
	const [channels, counts] = await Promise.all([
		listOtaChannels(hotelId),
		db
			.select({ name: orders.otaName, n: sql<number>`count(*)::int` })
			.from(orders)
			.where(sql`${orders.hotelId} = ${hotelId} and ${orders.otaName} is not null`)
			.groupBy(orders.otaName)
	]);
	const bookings = new Map(counts.map((c) => [c.name, c.n]));
	return { channels: channels.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive, bookings: bookings.get(c.name) ?? 0 })) };
};

const nameSchema = z.object({ name: z.string().trim().min(1, 'Enter the OTA name.').max(60, 'Keep the name to 60 characters.') });
const idSchema = z.object({ id: z.string().uuid() });

export const actions: Actions = {
	add: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const parsed = nameSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]!.message });
		try {
			const ch = await addOtaChannel(hotelId, parsed.data.name);
			await writeAudit({ hotelId, actor: event.locals.user, action: 'ota_channel.add', entityType: 'ota_channel', entityId: ch.id, after: { name: ch.name } });
			return { ok: `${ch.name} added.` };
		} catch (e) {
			if (e instanceof OtaChannelError) return fail(400, { error: e.message });
			throw e;
		}
	},

	rename: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const parsed = nameSchema.merge(idSchema).safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]!.message });
		try {
			await renameOtaChannel(hotelId, parsed.data.id, parsed.data.name);
			await writeAudit({ hotelId, actor: event.locals.user, action: 'ota_channel.rename', entityType: 'ota_channel', entityId: parsed.data.id, after: { name: parsed.data.name } });
			return { ok: 'Renamed. Its bookings carry the new name.' };
		} catch (e) {
			if (e instanceof OtaChannelError) return fail(400, { error: e.message });
			throw e;
		}
	},

	setActive: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const parsed = idSchema.extend({ active: z.enum(['true', 'false']) }).safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Something went wrong. Reload and try again.' });
		const isActive = parsed.data.active === 'true';
		try {
			await setOtaChannelActive(hotelId, parsed.data.id, isActive);
			await writeAudit({ hotelId, actor: event.locals.user, action: isActive ? 'ota_channel.turn_on' : 'ota_channel.turn_off', entityType: 'ota_channel', entityId: parsed.data.id });
			return { ok: isActive ? 'Turned on. Staff can pick it again.' : 'Turned off. Staff can no longer pick it.' };
		} catch (e) {
			if (e instanceof OtaChannelError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
