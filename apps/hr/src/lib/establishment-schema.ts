import { z } from 'zod';
import { TIMEZONES } from '$lib/authz';

/** A hotel is linked by the hotel app's own `hotels.org_ref`; a business gets one minted here. */
const ORG_REF = /^org_[0-9A-HJKMNP-TV-Z]{26}$/i;

/** The hotel app's own `hotels.org_ref` is what links a hotel here. It is optional for a hotel that
 *  is not set up in the hotel app yet (a placeholder is minted) and can be linked later. */
export const orgRefField = z
	.string()
	.trim()
	.optional()
	.refine((v) => !v || ORG_REF.test(v), {
		message: "That is not a valid hotel reference (org_ followed by 26 characters). Copy it from the hotel app, or leave it blank."
	});

export const establishmentSchema = z.object({
	name: z.string().trim().min(1, 'Enter a name.').max(120),
	/** One of the types under Settings → Establishment types. */
	typeId: z.string().uuid('Choose a type.'),
	timezone: z.enum(TIMEZONES),
	/** Printed on DTRs and rosters. */
	legalName: z.string().trim().max(160).optional(),
	addressLine: z.string().trim().max(200).optional(),
	city: z.string().trim().max(80).optional(),
	/** Hotels only; blank = not linked to the hotel app yet. */
	orgRef: orgRefField
});

export type EstablishmentInput = z.infer<typeof establishmentSchema>;
