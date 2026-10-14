import { fail } from '@sveltejs/kit';
import { canAt } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import {
	archiveEmployee,
	createEmployee,
	employeeFormSchema,
	getEmployee,
	listEmployees,
	updateEmployee,
	EmployeeError
} from '$lib/server/hr/employees';
import { getOrganization } from '$lib/server/establishments';
import { SalaryError, adjustSalary, adjustSchema, listHistories, syncCurrentRates } from '$lib/server/hr/salary';
import { businessDateFor } from '$lib/server/time';
import { deleteUploadIfOwned, saveUpload, UploadValidationError } from '$lib/server/uploads';
import { listCostCenters } from '$lib/server/hr/cost-centers';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const est = locals.establishment!;
	// Managers may view their own staff; creating/editing/archiving stays with Main HR.
	requireCap(locals.user, locals.access, 'employee:read', est.id);
	// A raise dated for today or earlier becomes the employee's current rate here, so the list is right.
	await syncCurrentRates((await getOrganization()).id);
	const employees = await listEmployees(est.id);
	const costCenters = (await listCostCenters((await getOrganization()).id)).map((x) => ({
		code: x.code,
		name: x.name,
		active: x.active
	}));
	return {
		employees,
		costCenters,
		history: await listHistories(employees.map((e) => e.id)),
		today: businessDateFor('Asia/Manila'),
		canWrite: locals.user!.isSystemAdmin || canAt(locals.access!, 'employee:*', est.id)
	};
};

function parseForm(raw: Record<string, FormDataEntryValue>) {
	return employeeFormSchema.safeParse({
		...raw,
		status: raw.status || 'active'
	});
}

export const actions: Actions = {
	adjustSalary: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'employee:*', event.locals.establishment!.id);
		const parsed = adjustSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the adjustment.' });
		try {
			const org = await getOrganization();
			const r = await adjustSalary(org.id, parsed.data, event.locals.user!.id);
			await writeAudit({
				actor: event.locals.user,
				action: 'employee.salary_adjust',
				entityType: 'employee',
				entityId: parsed.data.employeeId,
				before: { payBasis: r.previous.payBasis, baseRateCentavos: r.previous.baseRateCentavos },
				after: {
					payBasis: parsed.data.payBasis,
					baseRateCentavos: r.entry.baseRateCentavos,
					effectiveFrom: parsed.data.effectiveFrom,
					remarks: parsed.data.remarks
				}
			});
			return {
				ok:
					r.lockedPayslipsAffected > 0
						? `Salary adjusted. ${r.lockedPayslipsAffected} locked payslip${r.lockedPayslipsAffected === 1 ? '' : 's'} on or after that date keep the old rate — correct them by hand if needed.`
						: 'Salary adjusted and recorded.'
			};
		} catch (e) {
			if (e instanceof SalaryError) return fail(400, { error: e.message });
			throw e;
		}
	},

	create: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'employee:*', event.locals.establishment!.id);
		const establishmentId = event.locals.establishment!.id;

		const fd = await event.request.formData();
		const parsed = parseForm(Object.fromEntries(fd));
		if (!parsed.success) return fail(400, { error: 'Check the employee details and try again.' });

		let photoUrl: string | null = null;
		const photoFile = fd.get('photo');
		try {
			if (photoFile instanceof File && photoFile.size > 0) {
				photoUrl = await saveUpload(establishmentId, photoFile);
			}
		} catch (e) {
			if (e instanceof UploadValidationError) return fail(400, { error: e.message });
			throw e;
		}

		let employee;
		try {
			employee = await createEmployee(establishmentId, parsed.data, photoUrl);
		} catch (e) {
			if (e instanceof EmployeeError) return fail(400, { error: e.message });
			throw e;
		}
		await writeAudit({
			establishmentId,
			actor: event.locals.user,
			action: 'employee.create',
			entityType: 'employee',
			entityId: employee.id,
			after: { employeeNo: parsed.data.employeeNo, name: `${parsed.data.firstName} ${parsed.data.lastName}` }
		});
		return { ok: `Added ${parsed.data.firstName} ${parsed.data.lastName}.` };
	},

	update: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'employee:*', event.locals.establishment!.id);
		const establishmentId = event.locals.establishment!.id;

		const fd = await event.request.formData();
		const employeeId = String(fd.get('employeeId') ?? '');
		if (!employeeId) return fail(400, { error: 'Missing employee.' });

		const parsed = parseForm(Object.fromEntries(fd));
		if (!parsed.success) return fail(400, { error: 'Check the employee details and try again.' });

		const current = await getEmployee(establishmentId, employeeId);
		if (!current) return fail(400, { error: 'Employee not found.' });

		// Three states a resubmit can carry: a new file (replace), `removePhoto=true`
		// (clear), or neither (keep whatever's already there) — same tri-state pattern
		// branding's logo/hero-image fields already use.
		let photoUrl = current.photoUrl;
		const photoFile = fd.get('photo');
		try {
			if (photoFile instanceof File && photoFile.size > 0) {
				const uploaded = await saveUpload(establishmentId, photoFile);
				await deleteUploadIfOwned(current.photoUrl);
				photoUrl = uploaded;
			} else if (fd.get('removePhoto') === 'true') {
				await deleteUploadIfOwned(current.photoUrl);
				photoUrl = null;
			}
		} catch (e) {
			if (e instanceof UploadValidationError) return fail(400, { error: e.message });
			throw e;
		}

		let employee;
		try {
			employee = await updateEmployee(establishmentId, employeeId, parsed.data, photoUrl);
		} catch (e) {
			if (e instanceof EmployeeError) return fail(400, { error: e.message });
			throw e;
		}
		if (!employee) return fail(400, { error: 'Employee not found.' });

		await writeAudit({
			establishmentId,
			actor: event.locals.user,
			action: 'employee.update',
			entityType: 'employee',
			entityId: employeeId,
			after: { employeeNo: parsed.data.employeeNo, status: parsed.data.status }
		});
		return { ok: `Updated ${parsed.data.firstName} ${parsed.data.lastName}.` };
	},

	archive: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'employee:*', event.locals.establishment!.id);
		const establishmentId = event.locals.establishment!.id;

		const fd = await event.request.formData();
		const employeeId = fd.get('employeeId');
		if (typeof employeeId !== 'string') return fail(400, { error: 'Missing employee.' });

		await archiveEmployee(establishmentId, employeeId);
		await writeAudit({
			establishmentId,
			actor: event.locals.user,
			action: 'employee.archive',
			entityType: 'employee',
			entityId: employeeId
		});
		return { ok: 'Employee archived.' };
	}
};
