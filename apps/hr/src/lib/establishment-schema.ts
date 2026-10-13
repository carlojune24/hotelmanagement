import { z } from 'zod';
import { TIMEZONES } from '$lib/authz';

/** A hotel is linked by the hotel app's own `hotels.org_ref`; a business gets one minted here. */
const ORG_REF = /^org_[0-9A-HJKMNP-TV-Z]{26}$/i;

export const establishmentSchema = z
	.object({
		name: z.string().trim().min(1, 'Enter a name.').max(120),
		kind: z.enum(['hotel', 'business']),
		timezone: z.enum(TIMEZONES),
		/** Required for kind=hotel, ignored for a business. */
		orgRef: z.string().trim().optional()
	})
	.superRefine((v, ctx) => {
		if (v.kind === 'hotel' && !ORG_REF.test(v.orgRef ?? '')) {
			ctx.addIssue({
				code: 'custom',
				path: ['orgRef'],
				message: "Enter the hotel's org reference (org_ followed by 26 characters)."
			});
		}
	});

export type EstablishmentInput = z.infer<typeof establishmentSchema>;
