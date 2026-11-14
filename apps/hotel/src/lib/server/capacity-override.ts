import { roleCan, type ResolvedRole } from '$lib/authz';

/**
 * Staff bypass for the guest-capacity limit (e.g. 4 guests + 2 extra beds in a room that "caters" 3).
 * Stored in `hotels.config.capacityOverride`, so no migration. Hotel admins can always use it; front
 * desk only while an admin has the switch on — turning it off takes effect on the next request.
 */
export interface CapacityOverrideConfig {
	frontDesk: boolean;
}

export function parseCapacityOverride(config: unknown): CapacityOverrideConfig {
	const raw = config != null && typeof config === 'object' ? (config as Record<string, unknown>).capacityOverride : null;
	const frontDesk = raw != null && typeof raw === 'object' && (raw as Record<string, unknown>).frontDesk === true;
	return { frontDesk };
}

/** Merge into an existing `hotels.config` without clobbering its other keys. */
export function mergeCapacityOverrideIntoConfig(config: unknown, value: CapacityOverrideConfig): object {
	const base = config != null && typeof config === 'object' ? (config as object) : {};
	return { ...base, capacityOverride: value };
}

export function canOverrideCapacity(role: ResolvedRole | null | undefined, hotelConfig: unknown): boolean {
	if (!role) return false;
	if (roleCan(role.capabilities, 'hotel:admin')) return true;
	return parseCapacityOverride(hotelConfig).frontDesk && roleCan(role.capabilities, 'booking:write');
}
