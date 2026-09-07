import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { imageRef } from './branding';
import { MAX_GALLERY_IMAGES } from '$lib/branding';
import { db } from './db/index';
import { diningItems, type DiningItem } from './db/schema/index';

/**
 * Hotel-wide dining config — kept separate from `hotels.config.branding` (its own
 * top-level `hotels.config.dining` jsonb key) since dining now has its own settings
 * area, not a subsection of Branding. Individual dining venues (`dining_items`, a
 * real table — see `lib/server/db/schema/dining.ts`) aren't here; this only holds
 * the hotel-wide menu photo gallery, which has no natural owner among per-venue rows.
 */
export const diningConfigSchema = z.object({
	/** Photos of menus/menu boards, shown on the public Dining page below the venue list. */
	menuImages: z.array(imageRef).max(MAX_GALLERY_IMAGES).optional()
});

export type DiningConfig = z.infer<typeof diningConfigSchema>;

/** Safely reads `hotels.config.dining` — never throws on missing/malformed data. */
export function parseDiningConfig(config: unknown): DiningConfig {
	if (config == null || typeof config !== 'object') return {};
	const dining = (config as Record<string, unknown>).dining;
	const parsed = diningConfigSchema.safeParse(dining);
	return parsed.success ? parsed.data : {};
}

/** Merge a dining-config update into an existing `hotels.config` jsonb value without clobbering other keys. */
export function mergeDiningConfigIntoConfig(config: unknown, dining: DiningConfig): object {
	const base = config != null && typeof config === 'object' ? (config as object) : {};
	return { ...base, dining };
}

/** Active dining venues for the public Dining page. */
export async function listDiningItems(hotelId: string): Promise<DiningItem[]> {
	return db
		.select()
		.from(diningItems)
		.where(and(eq(diningItems.hotelId, hotelId), eq(diningItems.isActive, true)))
		.orderBy(asc(diningItems.sortOrder), asc(diningItems.title));
}
