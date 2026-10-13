import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { EstablishmentError, getOrganization } from '$lib/server/establishments';
import {
	createEstablishmentType,
	listEstablishmentTypes,
	newTypeSchema,
	typeSchema,
	updateEstablishmentType
} from '$lib/server/establishment-types';
import {
	LoanError,
	REMIT_TO_LABEL,
	createLoanType,
	listLoanTypes,
	loanTypeSchema,
	updateLoanType
} from '$lib/server/hr/loans';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	const org = await getOrganization();
	const types = await listLoanTypes(org.id);
	const estTypes = await listEstablishmentTypes(org.id);
	return {
		establishmentTypes: estTypes.map((t) => ({
			id: t.id,
			name: t.name,
			linksToHotelApp: t.linksToHotelApp,
			active: t.active,
			establishmentCount: t.establishmentCount
		})),
		loanTypes: types.map((t) => ({
			id: t.id,
			name: t.name,
			remitTo: t.remitTo,
			active: t.active,
			loanCount: t.loanCount
		})),
		remitOptions: (Object.keys(REMIT_TO_LABEL) as Array<keyof typeof REMIT_TO_LABEL>).map((k) => ({
			value: k,
			label: REMIT_TO_LABEL[k]
		}))
	};
};

const fd = async (request: Request) => Object.fromEntries(await request.formData());

export const actions: Actions = {
	createEstType: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const values = await fd(request);
		const parsed = newTypeSchema.safeParse({ ...values, linksToHotelApp: values.linksToHotelApp === 'on' });
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the type.' });
		try {
			const org = await getOrganization();
			const row = await createEstablishmentType(org.id, parsed.data);
			await writeAudit({
				actor: locals.user,
				action: 'establishment_type.create',
				entityType: 'establishment_type',
				entityId: row.id,
				after: { name: row.name, linksToHotelApp: row.linksToHotelApp }
			});
		} catch (e) {
			if (e instanceof EstablishmentError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Establishment type added.' };
	},

	updateEstType: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const parsed = typeSchema
			.extend({ id: z.string().uuid(), active: z.enum(['true', 'false']).transform((v) => v === 'true') })
			.safeParse(await fd(request));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the type.' });
		try {
			const org = await getOrganization();
			const { before, after } = await updateEstablishmentType(org.id, parsed.data.id, parsed.data);
			await writeAudit({
				actor: locals.user,
				action: 'establishment_type.update',
				entityType: 'establishment_type',
				entityId: after.id,
				before: { name: before.name, active: before.active },
				after: { name: after.name, active: after.active }
			});
		} catch (e) {
			if (e instanceof EstablishmentError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Saved.' };
	},

	createType: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const parsed = loanTypeSchema.safeParse(await fd(request));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the loan type.' });
		try {
			const org = await getOrganization();
			const row = await createLoanType(org.id, parsed.data);
			await writeAudit({
				actor: locals.user,
				action: 'loan_type.create',
				entityType: 'loan_type',
				entityId: row.id,
				after: { name: row.name, remitTo: row.remitTo }
			});
		} catch (e) {
			if (e instanceof LoanError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Loan type added.' };
	},

	updateType: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const parsed = loanTypeSchema
			.extend({ id: z.string().uuid(), active: z.enum(['true', 'false']).transform((v) => v === 'true') })
			.safeParse(await fd(request));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the loan type.' });
		try {
			const org = await getOrganization();
			const { before, after } = await updateLoanType(org.id, parsed.data.id, parsed.data);
			await writeAudit({
				actor: locals.user,
				action: 'loan_type.update',
				entityType: 'loan_type',
				entityId: after.id,
				before: { name: before.name, remitTo: before.remitTo, active: before.active },
				after: { name: after.name, remitTo: after.remitTo, active: after.active }
			});
		} catch (e) {
			if (e instanceof LoanError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Saved.' };
	}
};
