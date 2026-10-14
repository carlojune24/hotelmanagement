import { fail, redirect } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getOrganization } from '$lib/server/establishments';
import {
	KIND_LABEL,
	KINDS,
	SeparationError,
	listSeparations,
	separableEmployees,
	startSchema,
	startSeparation
} from '$lib/server/hr/separations';
import { businessDateFor } from '$lib/server/time';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	const org = await getOrganization();
	const [rows, people] = await Promise.all([listSeparations(org.id), separableEmployees(org.id)]);
	return {
		rows,
		people,
		kinds: KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })),
		today: businessDateFor('Asia/Manila')
	};
};

export const actions: Actions = {
	start: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const parsed = startSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the details.' });
		let id: string;
		try {
			const org = await getOrganization();
			const sep = await startSeparation(org.id, parsed.data, locals.user!.id);
			id = sep.id;
			await writeAudit({
				actor: locals.user,
				action: 'separation.start',
				entityType: 'separation',
				entityId: sep.id,
				after: { employeeId: sep.employeeId, kind: sep.kind, lastDay: sep.lastDay }
			});
		} catch (e) {
			if (e instanceof SeparationError) return fail(400, { error: e.message });
			throw e;
		}
		redirect(303, `/separations/${id}`);
	}
};
