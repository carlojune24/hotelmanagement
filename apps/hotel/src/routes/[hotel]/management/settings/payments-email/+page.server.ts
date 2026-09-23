import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import {
	PaymongoConnectionError,
	connectPaymongo,
	disconnectPaymongo,
	getPaymongoConnection,
	reconnectPaymongo
} from '$lib/server/paymongo/connection';
import {
	EmailSettingsError,
	clearEmailSettings,
	getEmailSettingsView,
	saveEmailSettings,
	sendTestEmail
} from '$lib/server/email/settings';
import { SecretsError } from '$lib/server/secrets';
import type { Actions, PageServerLoad } from './$types';

/**
 * Settings → Payments & email: the hotel's own PayMongo account and outgoing mailbox.
 * Hotel-admin only. Nothing secret ever reaches the page — only masked hints and status.
 */
export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotelId = locals.hotel!.id;
	const [paymongo, email] = await Promise.all([
		getPaymongoConnection(hotelId),
		getEmailSettingsView(hotelId)
	]);
	return {
		paymongo: paymongo ? { ...paymongo, connectedAt: paymongo.connectedAt.toISOString() } : null,
		email: email.settings,
		platformEmailConfigured: email.platformConfigured,
		userEmail: locals.user?.email ?? ''
	};
};

/** Errors an admin can act on become a toast; anything else is a real bug and should surface. */
function userFacing(e: unknown): string | null {
	if (e instanceof PaymongoConnectionError || e instanceof EmailSettingsError) return e.message;
	if (e instanceof SecretsError) return e.message;
	return null;
}

const emailSchema = z.object({
	host: z.string().trim().min(1, 'Enter the SMTP host.'),
	port: z.coerce.number().int().min(1).max(65535),
	secure: z.literal('on').optional(),
	username: z.string().trim().optional(),
	password: z.string().optional(),
	fromName: z.string().trim().max(120).optional(),
	fromAddress: z.email('Enter a valid From address.'),
	replyTo: z.union([z.email('Enter a valid Reply-to address.'), z.literal('')]).optional()
});

export const actions: Actions = {
	connectPaymongo: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const secretKey = String((await event.request.formData()).get('secretKey') ?? '');
		if (!secretKey.trim()) return fail(400, { error: 'Paste the PayMongo secret key.' });
		try {
			const { mode } = await connectPaymongo(event.locals.hotel!.id, secretKey, event.locals.user);
			return {
				ok:
					mode === 'live'
						? 'PayMongo connected in live mode — guests can pay online.'
						: 'PayMongo connected in test mode — payments are simulated.'
			};
		} catch (e) {
			const msg = userFacing(e);
			if (msg) return fail(400, { error: msg });
			throw e;
		}
	},

	reconnectPaymongo: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		try {
			await reconnectPaymongo(event.locals.hotel!.id, event.locals.user);
			return { ok: 'Webhook re-pointed to this server.' };
		} catch (e) {
			const msg = userFacing(e);
			if (msg) return fail(400, { error: msg });
			throw e;
		}
	},

	disconnectPaymongo: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		await disconnectPaymongo(event.locals.hotel!.id, event.locals.user);
		return { ok: 'PayMongo disconnected — guests can no longer book online.' };
	},

	saveEmail: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const parsed = emailSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the email fields.' });
		}
		const d = parsed.data;
		try {
			await saveEmailSettings(
				event.locals.hotel!.id,
				{
					host: d.host,
					port: d.port,
					secure: d.secure === 'on',
					username: d.username || null,
					password: d.password || null,
					fromName: d.fromName || null,
					fromAddress: d.fromAddress,
					replyTo: d.replyTo || null
				},
				event.locals.user
			);
			return { ok: 'Email settings saved — send a test to check them.' };
		} catch (e) {
			const msg = userFacing(e);
			if (msg) return fail(400, { error: msg });
			throw e;
		}
	},

	sendTestEmail: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const to = z.email().safeParse(String((await event.request.formData()).get('to') ?? '').trim());
		if (!to.success) return fail(400, { error: 'Enter an address to send the test to.' });
		const hotel = event.locals.hotel!;
		const result = await sendTestEmail(hotel.id, hotel.name, to.data);
		return result.ok
			? { ok: `Test email sent to ${to.data}.` }
			: fail(400, { error: `The mail server refused it: ${result.error}` });
	},

	clearEmail: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		await clearEmailSettings(event.locals.hotel!.id, event.locals.user);
		return { ok: 'Removed — email now goes out through the platform mailbox.' };
	}
};
