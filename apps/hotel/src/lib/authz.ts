/** Pure authorization helpers — safe to import on client and server. */

export type MembershipRole =
	| 'hotel_admin'
	| 'front_desk'
	| 'housekeeping'
	| 'accountant'
	| 'hr'
	| 'read_only'
	| 'group_owner';

export const MEMBERSHIP_ROLES: MembershipRole[] = [
	'hotel_admin',
	'front_desk',
	'housekeeping',
	'accountant',
	'hr',
	'read_only',
	'group_owner'
];

/** Roles that can be assigned to a hotel member (excludes portfolio-level). */
export const ASSIGNABLE_HOTEL_ROLES: MembershipRole[] = [
	'hotel_admin',
	'front_desk',
	'housekeeping',
	'accountant',
	'hr',
	'read_only'
];

/**
 * Coarse capability groups. A capability is `"<domain>:<action>"`. Grants may use
 * `"*"` (everything), `"<domain>:*"` (any action in a domain), or `"*:<action>"`
 * (an action across every domain). Extend as modules land.
 */
export const ROLE_CAPS: Record<MembershipRole, string[]> = {
	hotel_admin: ['*'],
	group_owner: ['*:read', 'reports:*'],
	front_desk: ['booking:*', 'folio:*', 'guest:*', 'room:read', 'reports:read', 'review:*'],
	housekeeping: ['housekeeping:*', 'room:read'],
	accountant: ['finance:*', 'ledger:*', 'reports:*'],
	hr: ['hr:*', 'payroll:*', 'reports:read'],
	read_only: ['*:read']
};

export function roleCan(role: MembershipRole, cap: string): boolean {
	const caps = ROLE_CAPS[role];
	if (caps.includes('*') || caps.includes(cap)) return true;
	const [domain, action] = cap.split(':');
	return caps.includes(`${domain}:*`) || caps.includes(`*:${action}`);
}
