/** Pure authorization helpers — safe to import on client and server. */

export type MembershipRole =
	'hotel_admin' | 'front_desk' | 'housekeeping' | 'accountant' | 'hr' | 'read_only' | 'group_owner';

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

/** Assignable roles a hotel_admin can hand to staff from their own hotel's Team screen.
 *  `hotel_admin` itself is excluded — only a platform admin can grant that role. */
export const SELF_SERVICE_ASSIGNABLE_ROLES: MembershipRole[] = ASSIGNABLE_HOTEL_ROLES.filter(
	(r) => r !== 'hotel_admin'
);

/**
 * Legacy static capability bundles. No longer the live authorization source — roles are
 * now DB-backed (`roles`/`role_permissions`, see `db/schema/roles.ts`) so a hotel's role
 * capabilities can be inspected/changed without a code deploy. This table survives only as
 * **seed data**: `seedDefaultRoles` copies it into a new hotel's initial `roles` rows, and it
 * backs the one-off `role` enum → `role_id` backfill. Do not add new capability domains here
 * to gate new code — add them to `PERMISSION_CATALOG` below and grant them via the seeded
 * role rows instead.
 *
 * Capability grammar: `"<domain>:<action>"`. A grant may be `"*"` (everything),
 * `"<domain>:*"` (any action in a domain), or `"*:<action>"` (an action across every domain).
 * Only two segments are ever matched — do not introduce three-segment capability strings
 * (e.g. `hr:employee:read`); use a distinct domain instead (e.g. `employee:read`).
 */
export const ROLE_CAPS: Record<MembershipRole, string[]> = {
	hotel_admin: ['*'],
	group_owner: ['*:read', 'reports:*'],
	front_desk: [
		'booking:*',
		'folio:*',
		'guest:*',
		'room:read',
		'reports:read',
		'review:*',
		// A cashier takes payments, opens/closes their own drawer shift, and sees the
		// Finance dashboard + shift/daily-sales reports — but not expenses, transfers,
		// manual cash movements, receivable write-offs, or Finance settings.
		'payment:*',
		'shift:*',
		'finance:read'
	],
	housekeeping: ['housekeeping:*', 'room:read'],
	accountant: [
		'finance:*',
		'ledger:*',
		'reports:*',
		'payment:*',
		'shift:*',
		'expense:*',
		'receivable:*',
		'dayclose:*'
	],
	// HR manages employees/scheduling/DTR/payroll — a people/business domain, distinct from
	// `team:*` (app account & role administration, which stays hotel_admin-only). `hr:read`
	// is a coarse section-visibility grant only (gates the "HR" nav entry, same role
	// `finance:read` plays for the Finance section) — the actual per-feature gates within
	// HR pages are `employee:*`/`schedule:*`/`dtr:*` below.
	hr: ['hr:read', 'employee:*', 'schedule:*', 'dtr:*', 'payroll:*', 'reports:read'],
	read_only: ['*:read']
};

export function roleCan(capabilities: string[], cap: string): boolean {
	if (capabilities.includes('*') || capabilities.includes(cap)) return true;
	const [domain, action] = cap.split(':');
	return capabilities.includes(`${domain}:*`) || capabilities.includes(`*:${action}`);
}

/** A membership's role, resolved for the current request/session — the live authorization
 *  unit. `capabilities` is the flattened permission set for this role (see `roleCan`). */
export interface ResolvedRole {
	id: string;
	slug: string;
	name: string;
	isProtected: boolean;
	capabilities: string[];
}

export interface PermissionDef {
	/** `"<domain>:<action>"` or `"<domain>:*"` — matches `roleCan`'s wildcard grammar. */
	cap: string;
	label: string;
	section: string;
}

export const PERMISSION_SECTIONS = [
	'Front Desk & Bookings',
	'Folio & Payments',
	'Reviews',
	'Reports',
	'Housekeeping',
	'Finance',
	'Team & Access',
	'HR & Employees',
	'Payroll',
	'Settings'
] as const;

/** The full set of capabilities real code actually checks (via `requireCap`/`roleCan`),
 *  formalized with labels/sections for a future role-permission UI. Keep in sync with the
 *  call sites — a permission here only means something if code somewhere gates on it. */
export const PERMISSION_CATALOG: PermissionDef[] = [
	{ cap: 'booking:create', label: 'Create bookings', section: 'Front Desk & Bookings' },
	{ cap: 'booking:read', label: 'View bookings', section: 'Front Desk & Bookings' },
	{
		cap: 'booking:write',
		label: 'Modify bookings (dates, status, quotes)',
		section: 'Front Desk & Bookings'
	},
	{ cap: 'guest:*', label: 'Manage the guest directory', section: 'Front Desk & Bookings' },

	{ cap: 'folio:read', label: 'View guest folios', section: 'Folio & Payments' },
	{ cap: 'folio:write', label: 'Post charges/adjustments to folios', section: 'Folio & Payments' },
	{ cap: 'payment:create', label: 'Take payments', section: 'Folio & Payments' },
	{ cap: 'payment:record', label: 'Record payments', section: 'Folio & Payments' },
	{ cap: 'shift:open', label: 'Open a cash-drawer shift', section: 'Folio & Payments' },
	{ cap: 'shift:close', label: 'Close a cash-drawer shift', section: 'Folio & Payments' },
	{ cap: 'shift:write', label: 'Manage cash-drawer shifts', section: 'Folio & Payments' },

	{ cap: 'review:read', label: 'View guest reviews', section: 'Reviews' },
	{ cap: 'review:approve', label: 'Approve reviews', section: 'Reviews' },
	{ cap: 'review:reject', label: 'Reject reviews', section: 'Reviews' },

	{ cap: 'reports:read', label: 'View reports', section: 'Reports' },
	{ cap: 'reports:*', label: 'View and export all reports', section: 'Reports' },

	{ cap: 'housekeeping:*', label: 'Manage housekeeping tasks', section: 'Housekeeping' },
	{ cap: 'room:read', label: 'View room status', section: 'Housekeeping' },

	{ cap: 'finance:read', label: 'View the Finance dashboard', section: 'Finance' },
	{ cap: 'finance:write', label: 'Post finance transactions', section: 'Finance' },
	{ cap: 'finance:post', label: 'Post ledger entries', section: 'Finance' },
	{ cap: 'ledger:*', label: 'Manage the general ledger', section: 'Finance' },
	{ cap: 'expense:create', label: 'Create expenses', section: 'Finance' },
	{ cap: 'expense:approve', label: 'Approve expenses', section: 'Finance' },
	{ cap: 'expense:pay', label: 'Pay expenses', section: 'Finance' },
	{ cap: 'expense:void', label: 'Void expenses', section: 'Finance' },
	{ cap: 'receivable:write', label: 'Manage receivables', section: 'Finance' },
	{ cap: 'receivable:write_off', label: 'Write off receivables', section: 'Finance' },
	{ cap: 'dayclose:run', label: 'Run day-close', section: 'Finance' },

	{ cap: 'team:*', label: 'Invite and manage staff accounts', section: 'Team & Access' },

	{ cap: 'hr:read', label: 'See the HR section', section: 'HR & Employees' },
	{ cap: 'employee:*', label: 'Register and manage employee records', section: 'HR & Employees' },
	{ cap: 'schedule:*', label: 'Create and manage employee work schedules', section: 'HR & Employees' },
	{ cap: 'dtr:*', label: 'Manage time records / biometric import', section: 'HR & Employees' },

	{ cap: 'payroll:*', label: 'Run payroll, manage payslips and cash advances', section: 'Payroll' },

	{
		cap: 'hotel:admin',
		label: 'Manage hotel settings (rooms, rates, amenities, branding, automation)',
		section: 'Settings'
	}
];
