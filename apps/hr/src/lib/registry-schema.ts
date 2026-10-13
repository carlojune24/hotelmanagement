import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date.');

export const assignSchema = z.object({
	employeeId: z.string().uuid(),
	establishmentId: z.string().uuid('Choose an establishment.'),
	startDate: date,
	position: z.string().trim().min(1, 'Enter the post at this establishment.').max(120),
	department: z.string().trim().max(120).optional(),
	biometricEnrollId: z.string().trim().max(40).optional(),
	makePrimary: z.coerce.boolean().default(false)
});

export const endAssignmentSchema = z.object({
	assignmentId: z.string().uuid(),
	endDate: date
});

export const setPrimarySchema = z.object({ assignmentId: z.string().uuid() });

/** `true` when an assignment is open on `today` (started, and not yet ended). */
export function isOpenOn(a: { startDate: string; endDate: string | null }, today: string): boolean {
	return a.startDate <= today && (a.endDate === null || a.endDate >= today);
}
