import { error, redirect } from '@sveltejs/kit';
import { roleCan, type MembershipRole } from '$lib/authz';
import type { SessionUser } from './session';

export { roleCan, ROLE_CAPS } from '$lib/authz';

/** Require an authenticated user; redirect to login otherwise. */
export function requireUser(
	user: SessionUser | null,
	redirectTo: string
): asserts user is SessionUser {
	if (!user) redirect(302, `/auth/login?next=${encodeURIComponent(redirectTo)}`);
}

export function requirePlatformAdmin(user: SessionUser | null): asserts user is SessionUser {
	if (!user) redirect(302, '/auth/login?next=/admin');
	if (!user.isPlatformAdmin) error(403, 'Platform admin access required');
}

/** Require a membership role at the current hotel. Platform admins pass through. */
export function requireHotelRole(
	user: SessionUser | null,
	role: MembershipRole | null,
	allowed: MembershipRole[]
): asserts role is MembershipRole {
	if (!user) redirect(302, '/auth/login');
	if (user.isPlatformAdmin) return;
	if (!role || !allowed.includes(role)) error(403, 'You do not have access to this area');
}

export function requireCap(
	user: SessionUser | null,
	role: MembershipRole | null,
	cap: string
): void {
	if (user?.isPlatformAdmin) return;
	if (!role || !roleCan(role, cap)) error(403, `Missing capability: ${cap}`);
}
