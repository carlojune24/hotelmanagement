import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { hotels } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
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
	const hotelId = locals.hotel!.id;
	const [settings, identity] = await Promise.all([
		getBirSettings(hotelId),
		db
			.select({ legalName: hotels.legalName, addressLine: hotels.addressLine, city: hotels.city })
			.from(hotels)
			.where(eq(hotels.id, hotelId))
			.then((r) => r[0]!)
	]);
	return { settings, configured: birConfigured(settings), identity };
};

export const actions: Actions = {
	saveIdentity: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({
				legalName: nullableStr(200),
				addressLine: nullableStr(240),
				city: nullableStr(120)
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Check the legal identity fields.' });

		await db.update(hotels).set({ ...parsed.data, updatedAt: new Date() }).where(eq(hotels.id, hotelId));
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'hotel.update_identity',
			entityType: 'hotel',
			entityId: hotelId,
			after: parsed.data
		});
		return { ok: 'Legal identity saved.' };
	},

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
				footerNote: nullableStr(400),
				thermalPaperWidthMm: z.coerce.number().int().refine((v) => v === 58 || v === 80).default(80),
				scPwdDiscountPct: z.coerce.number().min(0).max(100).default(20)
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Check the BIR setup fields.' });

		try {
			const { scPwdDiscountPct, ...rest } = parsed.data;
			await upsertBirSettings(
				event.locals.hotel!.id,
				{ ...rest, scPwdDiscountBps: Math.round(scPwdDiscountPct * 100) },
				event.locals.user ?? null
			);
			return { ok: 'BIR setup saved.' };
		} catch (e) {
			if (e instanceof DocumentError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
