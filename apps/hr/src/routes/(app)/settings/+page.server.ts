import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import {
	LeaveError,
	deleteLeaveTypeForOrg,
	listLeaveTypesForOrg,
	restoreStatutoryDefaultsForOrg,
	saveLeaveTypeForOrg
} from '$lib/server/hr/leave';
import { leaveTypeFromForm } from '$lib/server/hr/leave-form';
import { EstablishmentError, getOrganization } from '$lib/server/establishments';
import { logoUrlFor, removeLogo, setLogo } from '$lib/server/brand';
import {
	CostCenterError,
	costCenterSchema,
	listCostCenters,
	saveCostCenter,
	setCostCenterActive
} from '$lib/server/hr/cost-centers';
import { UploadValidationError } from '$lib/server/uploads';
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
import { getRemittanceSettings, saveRemittanceSettings } from '$lib/server/hr/remittance';
import {
	DEFAULT_CLEARANCE,
	MAX_CLEARANCE_ITEMS,
	SeparationError,
	getClearanceTemplate,
	saveClearanceTemplate
} from '$lib/server/hr/separations';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	const org = await getOrganization();
	const types = await listLoanTypes(org.id);
const estTypes = await listEstablishmentTypes(org.id);
	const leaveTypeRows = await listLeaveTypesForOrg(org.id);
	const remittance = await getRemittanceSettings(org.id);
	const clearanceItems = await getClearanceTemplate(org.id);
	return {
		clearanceItems,
		logoUrl: logoUrlFor(org.config),
		costCenters: await listCostCenters(org.id),
		clearanceDefaults: DEFAULT_CLEARANCE,
		maxClearanceItems: MAX_CLEARANCE_ITEMS,
		remittance: { employerIds: remittance.employerIds, dueDay: remittance.dueDay },
leaveTypes: leaveTypeRows.map((t) => ({
			id: t.id,
			code: t.code,
			name: t.name,
			description: t.description ?? '',
			statutory: t.statutory,
			paid: t.paid,
			daysPerYear: t.daysPerYear,
			dayCount: t.dayCount as 'working' | 'calendar',
			minServiceMonths: t.minServiceMonths,
			employmentTypes: t.employmentTypes,
			sexRestriction: t.sexRestriction as 'male' | 'female' | null,
			halfDayAllowed: t.halfDayAllowed,
			carryOverDays: t.carryOverDays,
			cashConvertible: t.cashConvertible,
			requiresDocument: t.requiresDocument,
			active: t.active
		})),
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

const dueDay = z.preprocess(
	(v) => (v === '' || v === null || v === undefined ? null : v),
	z.coerce.number().int().min(1).max(31).nullable()
);

const fd = async (request: Request) => Object.fromEntries(await request.formData());

export const actions: Actions = {
	saveCostCenter: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const parsed = costCenterSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the cost center.' });
		try {
			const org = await getOrganization();
			const r = await saveCostCenter(org.id, parsed.data);
			await writeAudit({
				actor: locals.user,
				action: r.before ? 'cost_center.update' : 'cost_center.create',
				entityType: 'cost_center',
				entityId: r.after.id,
				before: r.before ? { code: r.before.code, name: r.before.name } : undefined,
				after: { code: r.after.code, name: r.after.name }
			});
			return { ok: r.before ? 'Cost center saved.' : 'Cost center added.' };
		} catch (e) {
			if (e instanceof CostCenterError) return fail(400, { error: e.message });
			throw e;
		}
	},

	toggleCostCenter: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const parsed = z
			.object({ id: z.string().uuid(), active: z.enum(['true', 'false']) })
			.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: 'That cost center could not be found.' });
		try {
			const org = await getOrganization();
			const row = await setCostCenterActive(org.id, parsed.data.id, parsed.data.active === 'true');
			await writeAudit({
				actor: locals.user,
				action: 'cost_center.update',
				entityType: 'cost_center',
				entityId: row.id,
				after: { active: row.active }
			});
			return { ok: row.active ? 'Cost center activated.' : 'Cost center deactivated.' };
		} catch (e) {
			if (e instanceof CostCenterError) return fail(400, { error: e.message });
			throw e;
		}
	},

	uploadLogo: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const file = (await request.formData()).get('logo');
		if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'Choose an image to upload.' });
		try {
			const org = await getOrganization();
			await setLogo(org, file);
			await writeAudit({ actor: locals.user, action: 'organization.logo', entityType: 'organization', entityId: org.id, after: { logo: 'set' } });
			return { ok: 'Logo saved.' };
		} catch (e) {
			if (e instanceof UploadValidationError) return fail(400, { error: e.message });
			throw e;
		}
	},

	removeLogo: async ({ locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const org = await getOrganization();
		await removeLogo(org);
		await writeAudit({ actor: locals.user, action: 'organization.logo', entityType: 'organization', entityId: org.id, after: { logo: 'removed' } });
		return { ok: 'Logo removed.' };
	},

	saveClearance: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const items = (await request.formData()).getAll('item').map(String);
		try {
			const org = await getOrganization();
			const saved = await saveClearanceTemplate(org.id, items);
			await writeAudit({
				actor: locals.user,
				action: 'separation.clearance_template',
				entityType: 'organization',
				entityId: org.id,
				after: { items: saved }
			});
			return { ok: 'Clearance checklist saved.' };
		} catch (e) {
			if (e instanceof SeparationError) return fail(400, { error: e.message });
			throw e;
		}
	},

	saveRemittance: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const parsed = z
			.object({
				sssNo: z.string().trim().max(40),
				philhealthNo: z.string().trim().max(40),
				pagibigNo: z.string().trim().max(40),
				dueSss: dueDay,
				duePhilhealth: dueDay,
				duePagibig: dueDay,
				dueBir: dueDay,
				dueSssLoan: dueDay,
				duePagibigLoan: dueDay
			})
			.safeParse(await fd(request));
		if (!parsed.success) return fail(400, { error: 'Due days are 1–31 (or leave blank).' });
		const p = parsed.data;
		const org = await getOrganization();
		const days = {
			sss: p.dueSss,
			philhealth: p.duePhilhealth,
			pagibig: p.duePagibig,
			bir: p.dueBir,
			sss_loan: p.dueSssLoan,
			pagibig_loan: p.duePagibigLoan
		};
		await saveRemittanceSettings(org.id, {
			employerIds: {
				sss: p.sssNo || undefined,
				philhealth: p.philhealthNo || undefined,
				pagibig: p.pagibigNo || undefined
			},
			dueDay: days
		});
		await writeAudit({
			actor: locals.user,
			action: 'remittance.settings',
			entityType: 'organization',
			entityId: org.id,
			after: { dueDay: days }
		});
		return { ok: 'Saved.' };
	},

	saveLeaveType: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'leave:*');
		try {
			const org = await getOrganization();
			const fd = await request.formData();
			const parsed = leaveTypeFromForm(fd);
			if (!parsed.success) return fail(400, { error: parsed.error.issues[0]!.message });
			const id = fd.get('id');
			const { before, after } = await saveLeaveTypeForOrg(
				org.id,
				parsed.data,
				typeof id === 'string' && id ? id : undefined
			);
			await writeAudit({
				actor: locals.user,
				action: before ? 'leave.type_update' : 'leave.type_create',
				entityType: 'leave_type',
				entityId: after.id,
				before: before ?? undefined,
				after
			});
			return { ok: before ? `${after.name} updated.` : `${after.name} added.` };
		} catch (e) {
			if (e instanceof LeaveError) return fail(400, { error: e.message });
			throw e;
		}
	},

	deleteLeaveType: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'leave:*');
		try {
			const org = await getOrganization();
			const id = z.string().uuid().safeParse((await request.formData()).get('id'));
			if (!id.success) return fail(400, { error: 'Missing leave.' });
			await deleteLeaveTypeForOrg(org.id, id.data);
			await writeAudit({ actor: locals.user, action: 'leave.type_delete', entityType: 'leave_type', entityId: id.data });
			return { ok: 'Leave deleted.' };
		} catch (e) {
			if (e instanceof LeaveError) return fail(400, { error: e.message });
			throw e;
		}
	},

	restoreLeaveDefaults: async ({ locals }) => {
		requireCap(locals.user, locals.access, 'leave:*');
		const org = await getOrganization();
		await restoreStatutoryDefaultsForOrg(org.id);
		await writeAudit({ actor: locals.user, action: 'leave.restore_defaults', entityType: 'leave_type', entityId: null });
		return { ok: 'Statutory leaves are back to the legal defaults.' };
	},

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
