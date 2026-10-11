import { error } from '@sveltejs/kit';
import { canOpenSettings, visibleSettingsEntries } from '$lib/settings-nav';
import type { LayoutServerLoad } from './$types';

/**
 * The Settings area is open to anyone who manages at least one piece of configuration in it — not
 * only a hotel admin. Each page still enforces its own capability; this only decides who sees the
 * navigation and lets a delegated role (HR for leave, a team admin, …) reach the pages it owns.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) error(401, 'Sign in to continue');
	const isPlatformAdmin = locals.user.isPlatformAdmin;
	const caps = locals.role?.capabilities ?? null;
	if (!canOpenSettings(caps, isPlatformAdmin)) error(403, 'Missing capability: hotel:admin');

	return {
		settingsEntryIds: visibleSettingsEntries(caps, isPlatformAdmin).map((e) => e.id)
	};
};
