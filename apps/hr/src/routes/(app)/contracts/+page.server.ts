import { fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { db } from '$lib/server/db/index';
import { employees } from '$lib/server/db/schema/index';
import { getOrganization } from '$lib/server/establishments';
import { ContractError, contractsDue, createContract, listContracts } from '$lib/server/hr/contracts';
import { businessDateFor } from '$lib/server/time';
import type { Actions, PageServerLoad } from './$types';

/** Employment contracts generated from the templates. Main HR only: they state pay. */
export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.access, 'employee:write');
	const org = await getOrganization();
	const today = businessDateFor('Asia/Manila');
	const [contracts, people, due] = await Promise.all([
		listContracts(org.id),
		db
			.select({
				id: employees.id,
				last: employees.lastName,
				first: employees.firstName,
				no: employees.employeeNo,
				employmentType: employees.employmentType,
				hiredOn: employees.hiredOn
			})
			.from(employees)
			.where(and(eq(employees.organizationId, org.id), isNull(employees.deletedAt), sql`${employees.status} <> 'separated'`))
			.orderBy(asc(employees.lastName), asc(employees.firstName)),
		contractsDue(org.id, today, 30)
	]);
	return {
		today,
		contracts,
		due: due.map((d) => ({ id: d.id, employeeName: d.employeeName, kind: d.kind, endDate: d.endDate!, daysLeft: d.daysLeft, overdue: d.overdue })),
		people: people.map((p) => ({
			id: p.id,
			name: `${p.last}, ${p.first}`,
			employeeNo: p.no,
			employmentType: p.employmentType,
			hiredOn: p.hiredOn
		}))
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'employee:write');
		const fd = Object.fromEntries(await request.formData());
		let id: string;
		try {
			const org = await getOrganization();
			const c = await createContract(org.id, fd, locals.user!.id);
			id = c.id;
			await writeAudit({
				actor: locals.user,
				action: 'contract.issue',
				entityType: 'employee_contract',
				entityId: c.id,
				after: { employeeId: c.employeeId, kind: c.kind, startDate: c.startDate, endDate: c.endDate }
			});
		} catch (e) {
			if (e instanceof ContractError) return fail(400, { error: e.message });
			throw e;
		}
		redirect(303, `/contracts/${id}`);
	}
};
