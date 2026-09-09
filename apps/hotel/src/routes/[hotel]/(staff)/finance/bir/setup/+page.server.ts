import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { DocumentError, birConfigured, getBirSettings, upsertBirSettings } from '$lib/server/finance/documents';
import type { Actions, PageServerLoad } from './$types';

const nullableStr = (max: number) =>
	z
		.string()
		.max(max)
		.trim()
		.optional()
		.transform((v) => (v && v.length ? v : null));

const dateStr = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.optional()
	.transform((v) => v || null);

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const settings = await getBirSettings(locals.hotel!.id);
	return { settings, configured: birConfigured(settings) };
};

export const actions: Actions = {
	save: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const parsed = z
			.object({
				tin: nullableStr(40),
				isVatRegistered: z
					.union([z.literal('on'), z.literal('true'), z.literal('false'), z.undefined()])
					.transform((v) => v === 'on' || v === 'true'),
				registeredAddress: nullableStr(300),
				birPermitNo: nullableStr(80),
				permitDateIssued: dateStr,
				accreditedPrinterName: nullableStr(200),
				accreditedPrinterTin: nullableStr(40),
				accreditedPrinterAccreditationNo: nullableStr(80),
				printerAccreditationDate: dateStr,
				invoicePrefix: z.string().trim().max(12).default('INV'),
				orPrefix: z.string().trim().max(12).default('OR'),
				serialPadWidth: z.coerce.number().int().min(1).max(12).default(6),
				autoIssueInvoiceOnCheckout: z
					.union([z.literal('on'), z.undefined()])
					.transform((v) => v === 'on'),
				autoIssueReceiptOnPayment: z
					.union([z.literal('on'), z.undefined()])
					.transform((v) => v === 'on'),
				footerNote: nullableStr(400)
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Check the BIR setup fields.' });

		try {
			await upsertBirSettings(event.locals.hotel!.id, parsed.data, event.locals.user ?? null);
			return { ok: 'BIR setup saved.' };
		} catch (e) {
			if (e instanceof DocumentError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
