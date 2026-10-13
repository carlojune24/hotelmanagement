import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { canAt } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { businessDateFor } from '$lib/server/time';
import {
	RegistryError,
	assignEmployee,
	assignableEstablishments,
	endAssignment,
	listPeople,
	setPrimary
} from '$lib/server/hr/registry';
import { assignSchema, endAssignmentSchema, setPrimarySchema } from '$lib/registry-schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.access, 'employee:read');
	const people = await listPeople();
	// Which establishments each person could still be assigned to — computed once per person row.
	const assignable = Object.fromEntries(
		await Promise.all(people.map(async (p) => [p.id, await assignableEstablishments(p.id)] as const))
	);
	return {
		people,
		assignable,
		today: businessDateFor('Asia/Manila'),
		canWrite: locals.user!.isSystemAdmin || canAt(locals.access!, 'employee:*')
	};
};

const fd = async (request: Request) => Object.fromEntries(await request.formData());

export const actions: Actions = {
	assign: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'employee:*');
		const values = await fd(request);
		const parsed = assignSchema.safeParse({ ...values, makePrimary: values.makePrimary === 'on' });
		if (!parsed.success) {
			return fail(400, { action: 'assign', errors: z.flattenError(parsed.error).fieldErrors });
		}
		try {
			const a = await assignEmployee(parsed.data);
			await writeAudit({
				actor: locals.user,
				establishmentId: a.establishmentId,
				action: 'assignment.create',
				entityType: 'assignment',
				entityId: a.id,
				after: { employeeId: a.employeeId, startDate: a.startDate, isPrimary: a.isPrimary }
			});
		} catch (e) {
			if (e instanceof RegistryError) return fail(400, { action: 'assign', message: e.message });
			throw e;
		}
		return { ok: 'Assigned.' };
	},

	end: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'employee:*');
		const parsed = endAssignmentSchema.safeParse(await fd(request));
		if (!parsed.success) return fail(400, { action: 'end', message: 'Choose an end date.' });
		try {
			const a = await endAssignment(parsed.data.assignmentId, parsed.data.endDate);
			await writeAudit({
				actor: locals.user,
				establishmentId: a.establishmentId,
				action: 'assignment.end',
				entityType: 'assignment',
				entityId: a.id,
				after: { endDate: parsed.data.endDate }
			});
		} catch (e) {
			if (e instanceof RegistryError) return fail(400, { action: 'end', message: e.message });
			throw e;
		}
		return { ok: 'Assignment ended.' };
	},

	primary: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'employee:*');
		const parsed = setPrimarySchema.safeParse(await fd(request));
		if (!parsed.success) return fail(400, { action: 'primary', message: 'Unknown assignment.' });
		try {
			const a = await setPrimary(parsed.data.assignmentId);
			await writeAudit({
				actor: locals.user,
				establishmentId: a.establishmentId,
				action: 'assignment.set_primary',
				entityType: 'assignment',
				entityId: a.id
			});
		} catch (e) {
			if (e instanceof RegistryError) return fail(400, { action: 'primary', message: e.message });
			throw e;
		}
		return { ok: 'Home establishment updated.' };
	}
};
