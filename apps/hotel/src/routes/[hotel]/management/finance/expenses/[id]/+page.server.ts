import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { getExpense } from '$lib/server/finance/expenses';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	// A malformed id would make Postgres throw on the uuid cast; treat it as not found.
	if (!z.string().uuid().safeParse(params.id).success) error(404, 'Expense not found');
	const expense = await getExpense(locals.hotel!.id, params.id);
	if (!expense) error(404, 'Expense not found');
	return { expense };
};
