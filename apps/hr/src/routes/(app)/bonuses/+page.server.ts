import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { db } from '$lib/server/db/index';
import { establishments } from '$lib/server/db/schema/index';
import { getOrganization } from '$lib/server/establishments';
import { bonusActions } from '$lib/server/hr/bonus-actions';
import { KIND_LABEL, KINDS, listBatches } from '$lib/server/hr/bonuses';
import { TAX_EXEMPT_CENTAVOS } from '$lib/server/hr/thirteenth-month';
import { businessDateFor } from '$lib/server/time';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	const org = await getOrganization();
	const today = businessDateFor('Asia/Manila');
	const parsed = z.coerce.number().int().min(2000).max(2100).safeParse(url.searchParams.get('year'));
	const year = parsed.success ? parsed.data : Number(today.slice(0, 4));
	const [batches, ests] = await Promise.all([
		listBatches(org.id, year),
		db
			.select({ id: establishments.id, name: establishments.name })
			.from(establishments)
			.where(and(eq(establishments.organizationId, org.id), isNull(establishments.deletedAt), eq(establishments.status, 'active')))
			.orderBy(asc(establishments.name))
	]);
	return {
		year,
		today,
		batches,
		establishments: ests,
		kinds: KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })),
		taxExempt: TAX_EXEMPT_CENTAVOS
	};
};

export const actions: Actions = bonusActions;
