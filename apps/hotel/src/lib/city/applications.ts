import { z } from 'zod';

/** Hotel registration applications — city workflow. Pure, shared by server actions and tests. */

export const APPLICATION_STATUSES = ['pending', 'approved', 'rejected', 'finalized'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
	pending: 'Pending review',
	approved: 'Approved',
	rejected: 'Rejected',
	finalized: 'Finalized'
};

/**
 * pending → approved | rejected; approved → finalized (hotel created) | rejected;
 * rejected → pending (reopen). finalized is terminal: the hotel now exists.
 */
const NEXT: Record<ApplicationStatus, ApplicationStatus[]> = {
	pending: ['approved', 'rejected'],
	approved: ['finalized', 'rejected'],
	rejected: ['pending'],
	finalized: []
};

export const canTransition = (from: ApplicationStatus, to: ApplicationStatus) =>
	NEXT[from].includes(to);

export function isApplicationStatus(v: unknown): v is ApplicationStatus {
	return typeof v === 'string' && (APPLICATION_STATUSES as readonly string[]).includes(v);
}

/** URL-safe suggestion for a hotel slug (3–40 chars, lowercase alphanumerics and hyphens). */
export function slugify(name: string): string {
	const s = name
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)
		.replace(/-+$/g, '');
	return s.length >= 3 ? s : '';
}

const optional = <T extends z.ZodType>(schema: T) =>
	z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

export const applicationSchema = z.object({
	hotelName: z.string().trim().min(2, 'Enter the hotel name.').max(160),
	addressLine: optional(z.string().trim().max(240)),
	city: optional(z.string().trim().max(120)),
	contactName: z.string().trim().min(2, 'Enter the contact person.').max(120),
	contactEmail: z.string().trim().toLowerCase().email('Enter a valid contact email.').max(200),
	contactPhone: optional(z.string().trim().max(40)),
	permitNumber: optional(z.string().trim().max(80)),
	permitExpiresOn: optional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid permit expiry date.')),
	declaredRooms: optional(z.coerce.number().int().min(1).max(5000)),
	notes: optional(z.string().trim().max(2000))
});
export type ApplicationInput = z.infer<typeof applicationSchema>;
