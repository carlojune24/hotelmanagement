import { error, redirect } from '@sveltejs/kit';
import { roleCan, type ResolvedRole } from '$lib/authz';
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

/** Require any membership at the current hotel (or platform admin). Every membership now
 *  resolves to some role, so this is just a non-null check — per-area guards refine further
 *  via `requireCap`. */
export function requireHotelRole(
	user: SessionUser | null,
	role: ResolvedRole | null
): asserts role is ResolvedRole {
	if (!user) redirect(302, '/auth/login');
	if (user.isPlatformAdmin) return;
	if (!role) error(403, 'You do not have access to this area');
}

/** Require the current hotel's protected `hotel_admin` role specifically (or platform admin).
 *  Reserve this for genuine identity gates — e.g. granting another hotel_admin — everything
 *  else should be a capability check via `requireCap`. */
export function requireHotelAdmin(
	user: SessionUser | null,
	role: ResolvedRole | null
): asserts role is ResolvedRole {
	if (!user) redirect(302, '/auth/login');
	if (user.isPlatformAdmin) return;
	if (!role?.isProtected) error(403, 'Hotel admin access required');
}

export function requireCap(user: SessionUser | null, role: ResolvedRole | null, cap: string): void {
	if (user?.isPlatformAdmin) return;
	if (!role || !roleCan(role.capabilities, cap)) error(403, `Missing capability: ${cap}`);
}
