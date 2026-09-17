import { fail } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import {
	archiveEmployee,
	createEmployee,
	employeeFormSchema,
	getEmployee,
	listEmployeesWithTeamRole,
	updateEmployee
} from '$lib/server/hr/employees';
import { deleteUploadIfOwned, saveUpload, UploadValidationError } from '$lib/server/uploads';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'employee:*');
	const employees = await listEmployeesWithTeamRole(locals.hotel!.id);
	return { employees };
};

function parseForm(raw: Record<string, FormDataEntryValue>) {
	return employeeFormSchema.safeParse({
		...raw,
		status: raw.status || 'active'
	});
}

export const actions: Actions = {
	create: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'employee:*');
		const hotelId = event.locals.hotel!.id;

		const fd = await event.request.formData();
		const parsed = parseForm(Object.fromEntries(fd));
		if (!parsed.success) return fail(400, { error: 'Check the employee details and try again.' });

		let photoUrl: string | null = null;
		const photoFile = fd.get('photo');
		try {
			if (photoFile instanceof File && photoFile.size > 0) {
				photoUrl = await saveUpload(hotelId, photoFile);
			}
		} catch (e) {
			if (e instanceof UploadValidationError) return fail(400, { error: e.message });
			throw e;
		}

		const employee = await createEmployee(hotelId, parsed.data, photoUrl);
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'employee.create',
			entityType: 'employee',
			entityId: employee.id,
			after: { employeeNo: parsed.data.employeeNo, name: `${parsed.data.firstName} ${parsed.data.lastName}` }
		});
		return { ok: `Added ${parsed.data.firstName} ${parsed.data.lastName}.` };
	},

	update: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'employee:*');
		const hotelId = event.locals.hotel!.id;

		const fd = await event.request.formData();
		const employeeId = String(fd.get('employeeId') ?? '');
		if (!employeeId) return fail(400, { error: 'Missing employee.' });

		const parsed = parseForm(Object.fromEntries(fd));
		if (!parsed.success) return fail(400, { error: 'Check the employee details and try again.' });

		const current = await getEmployee(hotelId, employeeId);
		if (!current) return fail(400, { error: 'Employee not found.' });

		// Three states a resubmit can carry: a new file (replace), `removePhoto=true`
		// (clear), or neither (keep whatever's already there) — same tri-state pattern
		// branding's logo/hero-image fields already use.
		let photoUrl = current.photoUrl;
		const photoFile = fd.get('photo');
		try {
			if (photoFile instanceof File && photoFile.size > 0) {
				const uploaded = await saveUpload(hotelId, photoFile);
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

		const employee = await updateEmployee(hotelId, employeeId, parsed.data, photoUrl);
		if (!employee) return fail(400, { error: 'Employee not found.' });

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'employee.update',
			entityType: 'employee',
			entityId: employeeId,
			after: { employeeNo: parsed.data.employeeNo, status: parsed.data.status }
		});
		return { ok: `Updated ${parsed.data.firstName} ${parsed.data.lastName}.` };
	},

	archive: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'employee:*');
		const hotelId = event.locals.hotel!.id;

		const fd = await event.request.formData();
		const employeeId = fd.get('employeeId');
		if (typeof employeeId !== 'string') return fail(400, { error: 'Missing employee.' });

		await archiveEmployee(hotelId, employeeId);
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'employee.archive',
			entityType: 'employee',
			entityId: employeeId
		});
		return { ok: 'Employee archived.' };
	}
};
