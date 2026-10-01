import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { hotels } from '$lib/server/db/schema/index';
import { cityApplications, cityPermits } from '$lib/server/db/schema/city';
import { writeAudit } from '$lib/server/audit';
import { requirePlatformAdmin } from '$lib/server/auth/rbac';
import { createHotelWithDefaults } from '$lib/server/city/create-hotel';
import { canTransition, slugify, type ApplicationStatus } from '$lib/city/applications';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const [app] = await db.select().from(cityApplications).where(eq(cityApplications.id, params.id));
	if (!app) error(404, 'Application not found');

	const [hotel] = app.hotelId
		? await db
				.select({ id: hotels.id, slug: hotels.slug, name: hotels.name })
				.from(hotels)
				.where(eq(hotels.id, app.hotelId))
		: [];

	return { app, hotel: hotel ?? null, suggestedSlug: slugify(app.hotelName) };
};

const noteSchema = z.object({ note: z.string().trim().max(1000).optional() });

/** Moves the application to `to` only if it is still in the status we just read (guards double-submits / stale tabs). */
async function transition(
	event: RequestEvent<{ id: string }>,
	to: ApplicationStatus,
	opts: { requireNote?: boolean } = {}
) {
	requirePlatformAdmin(event.locals.user);
	const id = event.params.id;
	const parsed = noteSchema.safeParse(Object.fromEntries(await event.request.formData()));
	const note = parsed.success ? (parsed.data.note ?? '') : '';
	if (opts.requireNote && !note) return fail(400, { error: 'Add a reason for the applicant.' });

	const [current] = await db
		.select({ status: cityApplications.status })
		.from(cityApplications)
		.where(eq(cityApplications.id, id));
	if (!current) error(404, 'Application not found');
	if (!canTransition(current.status, to)) {
		return fail(409, { error: `This application is ${current.status}; it can't be moved to ${to}.` });
	}

	const updated = await db
		.update(cityApplications)
		.set({
			status: to,
			decisionNote: note || null,
			decidedAt: to === 'pending' ? null : new Date(),
			decidedBy: to === 'pending' ? null : event.locals.user!.id,
			updatedAt: new Date()
		})
		.where(and(eq(cityApplications.id, id), eq(cityApplications.status, current.status)))
		.returning({ id: cityApplications.id });
	if (updated.length === 0) {
		return fail(409, { error: 'Someone else just changed this application. Reload the page.' });
	}

	await writeAudit({
		actor: event.locals.user,
		action: `city.application.${to}`,
		entityType: 'city_application',
		entityId: id,
		before: { status: current.status },
		after: { status: to, note: note || null }
	});
	return { ok: true };
}

export const actions: Actions = {
	approve: (event) => transition(event, 'approved'),
	reject: (event) => transition(event, 'rejected', { requireNote: true }),
	reopen: (event) => transition(event, 'pending'),

	/** Final step: the city creates the hotel from an approved application. */
	finalize: async (event) => {
		requirePlatformAdmin(event.locals.user);
		const id = event.params.id;
		const form = await event.request.formData();
		const slug = String(form.get('slug') ?? '').trim();

		const [app] = await db.select().from(cityApplications).where(eq(cityApplications.id, id));
		if (!app) error(404, 'Application not found');
		if (!canTransition(app.status, 'finalized')) {
			return fail(409, { error: 'Only an approved application can be finalized.' });
		}

		const created = await createHotelWithDefaults(
			{ name: app.hotelName, slug, addressLine: app.addressLine, city: app.city },
			event.locals.user
		);
		if (!created.ok) return fail(400, { error: created.error });

		const linked = await db
			.update(cityApplications)
			.set({ status: 'finalized', hotelId: created.id, updatedAt: new Date() })
			.where(and(eq(cityApplications.id, id), eq(cityApplications.status, 'approved')))
			.returning({ id: cityApplications.id });
		if (linked.length === 0) {
			return fail(409, {
				error: `The hotel "${slug}" was created, but this application changed meanwhile and was not linked. Find it under Hotels.`
			});
		}

		// Carry the application's permit onto the new hotel so the Permits page tracks it from day one.
		if (app.permitNumber && app.permitExpiresOn) {
			await db.insert(cityPermits).values({
				hotelId: created.id,
				permitNumber: app.permitNumber,
				expiresOn: app.permitExpiresOn,
				applicationId: app.id,
				recordedBy: event.locals.user!.id
			});
		}

		await writeAudit({
			actor: event.locals.user,
			action: 'city.application.finalized',
			entityType: 'city_application',
			entityId: id,
			before: { status: 'approved' },
			after: { status: 'finalized', hotelId: created.id, slug }
		});
		redirect(303, `/city/hotels/${created.id}`);
	}
};
