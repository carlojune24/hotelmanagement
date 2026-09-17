import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import {
	DocumentError,
	createDocumentSeries,
	getBirSettings,
	listDocumentSeries,
	setDocumentSeriesStatus
} from '$lib/server/finance/documents';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const [series, settings] = await Promise.all([
		listDocumentSeries(locals.hotel!.id),
		getBirSettings(locals.hotel!.id)
	]);
	return {
		series,
		defaults: {
			invoicePrefix: settings?.invoicePrefix ?? 'INV',
			orPrefix: settings?.orPrefix ?? 'OR'
		}
	};
};

export const actions: Actions = {
	create: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const parsed = z
			.object({
				type: z.enum(['invoice', 'official_receipt']),
				prefix: z.string().trim().min(1).max(12),
				serialFrom: z.coerce.number().int().min(1),
				serialTo: z.coerce.number().int().min(1),
				startAt: z.union([z.coerce.number().int(), z.literal('')]).optional(),
				atpOrPermitNo: z.string().trim().max(80).optional(),
				dateRegistered: z
					.string()
					.regex(/^\d{4}-\d{2}-\d{2}$/)
					.optional()
					.or(z.literal('')),
				accreditedPrinter: z.string().trim().max(200).optional(),
				accreditationNo: z.string().trim().max(80).optional(),
				notes: z.string().trim().max(400).optional()
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Check the series fields.' });
		const d = parsed.data;

		try {
			await createDocumentSeries(
				event.locals.hotel!.id,
				{
					type: d.type,
					prefix: d.prefix,
					serialFrom: d.serialFrom,
					serialTo: d.serialTo,
					startAt: d.startAt === '' || d.startAt == null ? null : d.startAt,
					atpOrPermitNo: d.atpOrPermitNo || null,
					dateRegistered: d.dateRegistered || null,
					accreditedPrinter: d.accreditedPrinter || null,
					accreditationNo: d.accreditationNo || null,
					notes: d.notes || null
				},
				event.locals.user ?? null
			);
			return { ok: 'Series registered — it is now the active range for that document type.' };
		} catch (e) {
			if (e instanceof DocumentError) return fail(400, { error: e.message });
			throw e;
		}
	},

	setStatus: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const parsed = z
			.object({
				seriesId: z.string().uuid(),
				status: z.enum(['active', 'exhausted', 'superseded', 'cancelled'])
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Invalid request.' });

		try {
			await setDocumentSeriesStatus(
				event.locals.hotel!.id,
				parsed.data.seriesId,
				parsed.data.status,
				event.locals.user ?? null
			);
			return { ok: 'Series updated.' };
		} catch (e) {
			if (e instanceof DocumentError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
