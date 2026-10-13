import { error, redirect } from '@sveltejs/kit';
import { canAt, type Access } from '$lib/authz';
import type { SessionUser } from './session';

/** Require an authenticated user; redirect to sign-in otherwise. */
export function requireUser(
	user: SessionUser | null,
	redirectTo: string
): asserts user is SessionUser {
	if (!user) redirect(302, `/auth/login?next=${encodeURIComponent(redirectTo)}`);
}

/** 403 unless the user holds `cap` org-wide, or at `establishmentId` when one is given. */
export function requireCap(
	user: SessionUser | null,
	access: Access | null,
	cap: string,
	establishmentId?: string
): void {
	if (user?.isSystemAdmin) return;
	if (!access || !canAt(access, cap, establishmentId)) error(403, `Missing capability: ${cap}`);
}
