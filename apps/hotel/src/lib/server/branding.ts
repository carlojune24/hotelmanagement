import { z } from 'zod';
import {
	DEFAULT_ACCENT_COLOR,
	DEFAULT_PAPER_COLOR,
	DISPLAY_FONT_IDS,
	MAX_GALLERY_IMAGES
} from '$lib/branding';

/** Re-exported for existing server-side importers; the values themselves live in
    `$lib/branding.ts` so client components can use them without importing this
    server-only module (see that file's doc comment for why). */
export { DEFAULT_ACCENT_COLOR, DEFAULT_PAPER_COLOR, MAX_GALLERY_IMAGES };

/**
 * A stored image reference: either our own upload (`/uploads/<hotelId>/<file>`,
 * written by `lib/server/uploads.ts`) or, for backward compatibility with
 * branding set before uploads existed, a fully-qualified external URL. Exported
 * for reuse by other per-hotel jsonb-config modules (e.g. `lib/server/dining.ts`'s
 * menu gallery) rather than duplicating this validator.
 */
export const imageRef = z
	.string()
	.max(2000)
	.refine((v) => /^\/uploads\/[0-9a-zA-Z-]+\/[0-9A-Za-z]{20,30}\.(jpg|png|webp|gif)$/.test(v) || z.string().url().safeParse(v).success, {
		message: 'Not a valid image reference'
	});

/** Same shape as `imageRef`, for the hero backdrop video — either our own upload or an external URL. */
export const videoRef = z
	.string()
	.max(2000)
	.refine((v) => /^\/uploads\/[0-9a-zA-Z-]+\/[0-9A-Za-z]{20,30}\.(mp4|webm)$/.test(v) || z.string().url().safeParse(v).success, {
		message: 'Not a valid video reference'
	});

export const brandingSchema = z.object({
	logoUrl: imageRef.optional(),
	accentColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/, `Use a 6-digit hex color, e.g. ${DEFAULT_ACCENT_COLOR}`)
		.optional(),
	heroImageUrl: imageRef.optional(),
	/** Page background ("paper") — unset = pure white. Locked to a light, low-saturation
	    range at the picker level (`$lib/branding.ts`'s `PAPER_SATURATION`/`PAPER_LIGHTNESS`),
	    so any value that actually reaches here keeps the fixed dark `--ledger-ink` text and
	    `--ledger-paper`-colored button labels readable without a separate contrast check. */
	paperColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/, `Use a 6-digit hex color, e.g. ${DEFAULT_PAPER_COLOR}`)
		.optional(),
	/** Optional hero backdrop clip — takes over from `heroImageUrl` on the storefront when set (muted, looped, autoplaying); `heroImageUrl` still serves as its poster frame and as the fallback when unset. */
	heroVideoUrl: videoRef.optional(),
	/** Curated Display-register font (see `$lib/branding.ts`'s `DISPLAY_FONTS`) — unset = Literata, the world's own default. */
	fontDisplay: z.enum(DISPLAY_FONT_IDS).optional(),
	tagline: z.string().max(140).optional(),
	/** Short marketing copy for the storefront's "About" section. */
	about: z.string().max(1200).optional(),
	/** Property-wide photos (grounds, lobby, views) shown in the storefront gallery, in addition to each room type's own photos. */
	galleryImages: z.array(imageRef).max(MAX_GALLERY_IMAGES).optional(),
	/** Free-text check-in/check-out policy shown on the room detail page. Unset = that block is omitted, never fabricated. */
	checkInPolicy: z.string().max(500).optional(),
	checkOutPolicy: z.string().max(500).optional(),
	contactPhone: z.string().max(40).optional(),
	contactEmail: z.string().email('Not a valid email address').max(200).optional(),
	/** Free-text street address for `/book/contact`, shown as a row and used as the map's fallback (address-search embed) when no pin has been dropped. */
	contactAddress: z.string().max(300).optional(),
	/** A precise pin dropped on the staff map picker — when set, the public Contact page embeds this exact coordinate instead of geocoding `contactAddress`. */
	contactLat: z.number().min(-90).max(90).optional(),
	contactLng: z.number().min(-180).max(180).optional()
});

export type HotelBranding = z.infer<typeof brandingSchema>;

/**
 * Safely reads `hotels.config.branding` — never throws on missing/malformed data
 * so a hotel with no branding set (or a config shape from before this field existed)
 * still renders with sane defaults.
 */
export function parseBranding(config: unknown): HotelBranding {
	if (config == null || typeof config !== 'object') return {};
	const branding = (config as Record<string, unknown>).branding;
	const parsed = brandingSchema.safeParse(branding);
	return parsed.success ? parsed.data : {};
}

/** Merge a branding update into an existing `hotels.config` jsonb value without clobbering other keys. */
export function mergeBrandingIntoConfig(config: unknown, branding: HotelBranding): object {
	const base = config != null && typeof config === 'object' ? (config as object) : {};
	return { ...base, branding };
}
