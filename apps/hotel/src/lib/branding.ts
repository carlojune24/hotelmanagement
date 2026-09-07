/**
 * Branding constants safe to import from both server and browser code.
 * Validation/parsing logic (which touches `hotels.config` shapes) stays in
 * `$lib/server/branding.ts` — anything under `lib/server/` is server-only in
 * SvelteKit and can't be imported from a `.svelte` file, so the plain values
 * a client component needs (e.g. the branding settings form's color-picker
 * default) live here instead.
 */

/**
 * Sane fallback thread color when a hotel hasn't set an accent yet — a deep
 * antique gold. Kept dark enough (contrast ≈4.7:1 against `--ledger-paper`
 * text on a filled button) that the "flat accent + light text" pairing in
 * `ledger-btn-primary` stays accessible without per-hotel adaptive logic.
 */
export const DEFAULT_ACCENT_COLOR = '#836819';

/** Fallback page background ("paper") when a hotel hasn't picked one — pure white. */
export const DEFAULT_PAPER_COLOR = '#ffffff';

/** Max gallery images a hotel can set beyond its room types' own photos. */
export const MAX_GALLERY_IMAGES = 16;

/** Convert a `#rrggbb` hex string to `[hue 0-360, saturation 0-100, lightness 0-100]`. */
export function hexToHsl(hex: string): [number, number, number] {
	const clean = hex.replace('#', '');
	const num = parseInt(clean, 16);
	const r = ((num >> 16) & 255) / 255;
	const g = ((num >> 8) & 255) / 255;
	const b = (num & 255) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, Math.round(l * 100)];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h: number;
	switch (max) {
		case r:
			h = (g - b) / d + (g < b ? 6 : 0);
			break;
		case g:
			h = (b - r) / d + 2;
			break;
		default:
			h = (r - g) / d + 4;
	}
	return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}

/** Convert `hue 0-360, saturation 0-100, lightness 0-100` to a `#rrggbb` hex string. */
export function hslToHex(h: number, s: number, l: number): string {
	const sNorm = s / 100;
	const lNorm = l / 100;
	const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = lNorm - c / 2;
	let [r, g, b] = [0, 0, 0];
	if (h < 60) [r, g, b] = [c, x, 0];
	else if (h < 120) [r, g, b] = [x, c, 0];
	else if (h < 180) [r, g, b] = [0, c, x];
	else if (h < 240) [r, g, b] = [0, x, c];
	else if (h < 300) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	const toHex = (v: number) =>
		Math.round((v + m) * 255)
			.toString(16)
			.padStart(2, '0');
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Saturation/lightness locked across every curated accent hue (and the hue
 * slider derived from it) so every color a hotel can pick this way lands at
 * roughly the same "dark enough for white button text" contrast as
 * `DEFAULT_ACCENT_COLOR` itself — matches that color's own HSL recipe.
 */
export const ACCENT_SATURATION = 68;
export const ACCENT_LIGHTNESS = 31;

/** Named starting points for the accent color picker's hue slider. */
export const ACCENT_PALETTE: { name: string; hue: number }[] = [
	{ name: 'Gold', hue: 45 },
	{ name: 'Terracotta', hue: 18 },
	{ name: 'Wine', hue: 350 },
	{ name: 'Plum', hue: 290 },
	{ name: 'Navy', hue: 215 },
	{ name: 'Teal', hue: 185 },
	{ name: 'Forest', hue: 140 },
	{ name: 'Olive', hue: 75 }
];

/**
 * Saturation/lightness locked for the page-background ("paper") picker — kept
 * extremely light and low-saturation (unlike the accent's own recipe) so
 * whatever hue a hotel picks stays close enough to white that the fixed dark
 * `--ledger-ink` body text, `.ledger-btn-primary`'s `--ledger-paper`-colored
 * button labels, and every ruled hairline all stay exactly as readable as
 * they are on the plain white default — no separate "pick a matching text
 * color" step needed, by construction rather than admin discipline.
 */
export const PAPER_SATURATION = 3;
export const PAPER_LIGHTNESS = 98;

/** Named starting points for the background color picker's hue slider. */
export const PAPER_PALETTE: { name: string; hue: number }[] = [
	{ name: 'Cream', hue: 45 },
	{ name: 'Peach', hue: 18 },
	{ name: 'Blush', hue: 350 },
	{ name: 'Lilac', hue: 290 },
	{ name: 'Sky', hue: 215 },
	{ name: 'Mint', hue: 185 },
	{ name: 'Sage', hue: 140 },
	{ name: 'Moss', hue: 75 }
];

/**
 * Curated Display-register font choices for the storefront (see DESIGN.md's
 * "Woven Ledger" three-register type system) — a hotel picks one of these for
 * headings/room names/prices' companion display text; body (Inter) and
 * data/mono (JetBrains Mono) stay fixed so the register contrast that makes
 * the system legible doesn't get broken by a mismatched pairing. Each has a
 * self-hosted `@fontsource-variable/*` package imported in `woven-ledger.css`
 * — no Google Fonts CDN call at request time.
 */
export const DISPLAY_FONT_IDS = ['literata', 'playfair-display', 'fraunces', 'cormorant-garamond'] as const;
export type DisplayFontId = (typeof DISPLAY_FONT_IDS)[number];
export const DEFAULT_DISPLAY_FONT: DisplayFontId = 'literata';

export const DISPLAY_FONTS: Record<DisplayFontId, { label: string; family: string }> = {
	literata: { label: 'Literata', family: "'Literata Variable', Georgia, serif" },
	'playfair-display': {
		label: 'Playfair Display',
		family: "'Playfair Display Variable', Georgia, serif"
	},
	fraunces: { label: 'Fraunces', family: "'Fraunces Variable', Georgia, serif" },
	'cormorant-garamond': {
		label: 'Cormorant Garamond',
		family: "'Cormorant Garamond Variable', Georgia, serif"
	}
};
