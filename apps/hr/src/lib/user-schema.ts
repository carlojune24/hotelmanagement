import { z } from 'zod';
import { ESTABLISHMENT_ROLES, ORG_ROLES, type Role } from '$lib/authz';

export const MIN_PASSWORD = 12;

const ALL_ROLES = [...ORG_ROLES, ...ESTABLISHMENT_ROLES] as [Role, ...Role[]];

export const isOrgRole = (role: string): boolean => (ORG_ROLES as string[]).includes(role);

const password = z
	.string()
	.min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters.`)
	.max(200);

/** An organization-wide role covers every establishment; a manager/clerk must be scoped to at
 *  least one. The two never mix, so the form can't produce an ambiguous account. */
function roleScope(
	v: { role: string; establishmentIds: string[] },
	ctx: z.RefinementCtx
): void {
	if (isOrgRole(v.role) && v.establishmentIds.length > 0) {
		ctx.addIssue({
			code: 'custom',
			path: ['establishmentIds'],
			message: 'An organization-wide role covers every establishment — leave these unchecked.'
		});
	}
	if (!isOrgRole(v.role) && v.establishmentIds.length === 0) {
		ctx.addIssue({
			code: 'custom',
			path: ['establishmentIds'],
			message: 'Choose at least one establishment for this role.'
		});
	}
}

const base = {
	name: z.string().trim().min(1, 'Enter a name.').max(120),
	role: z.enum(ALL_ROLES),
	establishmentIds: z.array(z.string().uuid()).default([])
};

export const createUserSchema = z
	.object({
		...base,
		email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(200),
		password
	})
	.superRefine(roleScope);

export const updateUserSchema = z
	.object({
		...base,
		id: z.string().uuid(),
		status: z.enum(['active', 'disabled'])
	})
	.superRefine(roleScope);

export const resetPasswordSchema = z.object({ id: z.string().uuid(), password });

export const changePasswordSchema = z
	.object({
		current: z.string().min(1, 'Enter your current password.'),
		next: password,
		confirm: z.string()
	})
	.refine((v) => v.next === v.confirm, { path: ['confirm'], message: 'The passwords do not match.' });

/** Pure lockout guard: would this edit leave the organization with no active Main HR? */
export function removesLastMainHr(opts: {
	targetIsActiveMainHr: boolean;
	staysActiveMainHr: boolean;
	otherActiveMainHrCount: number;
}): boolean {
	return opts.targetIsActiveMainHr && !opts.staysActiveMainHr && opts.otherActiveMainHrCount === 0;
}
