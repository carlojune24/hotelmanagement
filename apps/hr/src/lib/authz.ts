/** Pure authorization helpers — safe on client and server. Capability grammar mirrors the
 *  hotel app: `"<domain>:<action>"`, with `*` wildcards (`roleCan`). Two segments only. */

export type OrgRole = 'main_hr' | 'owner_readonly';
export type EstablishmentRole = 'business_manager' | 'hr_clerk';
export type Role = OrgRole | EstablishmentRole;

export const ORG_ROLES: OrgRole[] = ['main_hr', 'owner_readonly'];
export const ESTABLISHMENT_ROLES: EstablishmentRole[] = ['business_manager', 'hr_clerk'];

// A manager/clerk builds and submits the roster and files leave and overtime —
// Main HR (`*`) decides them. Holidays and memos are Main HR's alone. `approval:*` is deliberately in no manager bundle.
const MANAGER_CAPS = [
	'establishment:read',
	'employee:read',
	'schedule:*',
	'dtr:*',
	'leave:file',
	'overtime:file'
];
// Pay is more sensitive than the roster: only the manager reads released payslips, not the clerk.
const MANAGER_ONLY_CAPS = [...MANAGER_CAPS, 'payslip:read'];

// shortcut: static role→caps map, not DB-backed rows like the hotel app's `roles` table.
// Upgrade when a client needs to edit role capabilities without a deploy.
export const ROLE_CAPS: Record<Role, string[]> = {
	// Everything HR: registry, assignments, approvals, payroll, payslips, settings.
	main_hr: ['*'],
	owner_readonly: ['*:read'],
	// Managers: see MANAGER_CAPS above. Employee writes, leave policy and every decision stay with Main HR.
	business_manager: MANAGER_ONLY_CAPS,
	hr_clerk: MANAGER_CAPS
};

export const ROLE_LABEL: Record<Role, string> = {
	main_hr: 'Main HR',
	owner_readonly: 'Owner (read-only)',
	business_manager: 'Business manager',
	hr_clerk: 'HR clerk'
};

/** One line each, shown on Users so whoever assigns a role knows what it is. */
export const ROLE_SUMMARY: Record<Role, string> = {
	main_hr: 'Runs HR for the whole company: registers and assigns people, decides approvals, receives DTRs, runs payroll, loans and remittances.',
	owner_readonly: 'Can look at everything across the company, but cannot change, approve or run anything.',
	business_manager:
		'Runs one establishment day to day: roster, DTR, leave and overtime filings. Can read released payslips of their own people. Cannot approve.',
	hr_clerk:
		'Does the same day-to-day work as a manager for their establishment, but cannot see payslips or any pay. Cannot approve.'
};

/**
 * What the roles can do, worked out from `ROLE_CAPS` so this table can never disagree with what the
 * app actually enforces. `cap` is a representative capability for the row.
 */
export const ABILITY_ROWS: Array<{ label: string; cap: string }> = [
	{ label: 'See the establishment and its employees', cap: 'employee:read' },
	{ label: 'Build and submit the roster', cap: 'schedule:write' },
	{ label: 'Import biometrics, edit and send the DTR', cap: 'dtr:write' },
	{ label: 'File leave and overtime (Main HR approves)', cap: 'leave:file' },
	{ label: 'Read released payslips', cap: 'payslip:read' },
	{ label: 'Approve or reject filings', cap: 'approval:decide' },
	{ label: 'Register employees and assign them', cap: 'employee:write' },
	{ label: 'Run payroll, loans and remittances', cap: 'payroll:write' }
];

export const can = (role: Role, cap: string) => roleCan(ROLE_CAPS[role], cap);

export function roleCan(capabilities: string[], cap: string): boolean {
	if (capabilities.includes('*') || capabilities.includes(cap)) return true;
	const [domain, action] = cap.split(':');
	return capabilities.includes(`${domain}:*`) || capabilities.includes(`*:${action}`);
}

/** What a signed-in user may do, resolved once per request. */
export interface Access {
	/** Organization-wide capabilities (from `org_memberships`), else empty. */
	orgCaps: string[];
	/** Per-establishment capabilities (from `establishment_memberships`). */
	establishments: Record<string, string[]>;
}

/** Org-wide grant wins; otherwise the capability must be granted at that establishment. */
export function canAt(access: Access, cap: string, establishmentId?: string): boolean {
	if (roleCan(access.orgCaps, cap)) return true;
	return establishmentId ? roleCan(access.establishments[establishmentId] ?? [], cap) : false;
}

/** Any grant of `cap`, org-wide or at any establishment — for showing a nav item. */
export function canAnywhere(access: Access, cap: string): boolean {
	return (
		roleCan(access.orgCaps, cap) ||
		Object.values(access.establishments).some((caps) => roleCan(caps, cap))
	);
}

export const TIMEZONES = [
	'Asia/Manila',
	'Asia/Singapore',
	'Asia/Hong_Kong',
	'Asia/Tokyo',
	'UTC'
] as const;
