import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { establishments } from '$lib/server/db/schema/index';
import { DEFAULT_NIGHT_WINDOW } from '$lib/hr-import';

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);

/** Establishment-wide night differential: the default window for shifts without their own, and the premium. */
export const nightDiffSchema = z
	.object({
		start: hhmm,
		end: hhmm,
		/** Premium on the hourly rate, in percent. 10 is the Philippine statutory minimum. */
		ratePct: z.coerce.number().min(0).max(100)
	})
	.refine((v) => v.start !== v.end, { message: 'Start and end must differ.', path: ['end'] });
export type NightDiffConfig = z.infer<typeof nightDiffSchema>;

export const DEFAULT_NIGHT_DIFF: NightDiffConfig = {
	start: DEFAULT_NIGHT_WINDOW.start,
	end: DEFAULT_NIGHT_WINDOW.end,
	ratePct: 10
};

/** Safely reads `establishments.config.nightDiff`; anything missing or malformed falls back to the defaults. */
export function parseNightDiff(config: unknown): NightDiffConfig {
	if (config == null || typeof config !== 'object') return DEFAULT_NIGHT_DIFF;
	const parsed = nightDiffSchema.safeParse((config as Record<string, unknown>).nightDiff);
	return parsed.success ? parsed.data : DEFAULT_NIGHT_DIFF;
}

/** Merge a night-diff update into an existing `establishments.config` value without clobbering other keys. */
export function mergeNightDiffIntoConfig(config: unknown, nightDiff: NightDiffConfig): object {
	const base = config != null && typeof config === 'object' ? (config as object) : {};
	return { ...base, nightDiff };
}

export async function getEstablishmentNightDiff(establishmentId: string): Promise<NightDiffConfig> {
	const [row] = await db
		.select({ config: establishments.config })
		.from(establishments)
		.where(eq(establishments.id, establishmentId));
	return parseNightDiff(row?.config);
}
