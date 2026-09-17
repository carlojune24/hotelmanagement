import { fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { orders } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { listEmailLog } from '$lib/server/email/log';
import { sendBookingConfirmation } from '$lib/server/email/send-booking-confirmation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'booking:read');
	return { emails: await listEmailLog(locals.hotel!.id) };
};

export const actions: Actions = {
	resend: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;

		const form = await event.request.formData();
		const orderId = String(form.get('orderId') ?? '');
		if (!orderId) return fail(400, { error: 'Missing order reference.' });

		const [order] = await db
			.select({ status: orders.status })
			.from(orders)
			.where(and(eq(orders.id, orderId), eq(orders.hotelId, hotelId)));
		if (!order) return fail(404, { error: 'Booking not found.' });
		if (order.status !== 'confirmed') {
			return fail(400, { error: 'Only a confirmed booking has a confirmation to send.' });
		}

		const res = await sendBookingConfirmation(orderId, { force: true });
		if (!res.ok) return fail(502, { error: `Could not send: ${res.error ?? 'unknown error'}` });
		return { ok: 'Confirmation email sent.' };
	}
};
