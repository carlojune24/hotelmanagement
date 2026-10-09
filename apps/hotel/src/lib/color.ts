/**
 * Small, pure colour maths for the table-ordering app: build a lively palette from a hotel's accent, and
 * prove it stays readable. Nothing here is hand-tuned per hotel: every colour is derived from the accent
 * (and paper) the hotel picked, so a new hotel is on-brand without anyone touching code.
 */

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
	const clean = hex.replace('#', '');
	const full = clean.length === 3 ? clean.replace(/./g, (c) => c + c) : clean;
	const n = parseInt(full, 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
	return (
		'#' +
		[r, g, b]
			.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'))
			.join('')
	);
}

/** Hue 0–360, saturation and lightness 0–1. */
export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const l = (max + min) / 2;
	const d = max - min;
	if (d === 0) return [0, 0, l];
	const s = d / (1 - Math.abs(2 * l - 1));
	let h: number;
	if (max === rn) h = ((gn - bn) / d) % 6;
	else if (max === gn) h = (bn - rn) / d + 2;
	else h = (rn - gn) / d + 4;
	return [(h * 60 + 360) % 360, s, l];
}

export function hslToRgb([h, s, l]: [number, number, number]): RGB {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
	return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** `fg` laid over `bg` at `amount` (0–1): a tint, e.g. the accent at 8% over paper. */
export function mixOver(fg: string, bg: string, amount: number): string {
	const [fr, fgc, fb] = hexToRgb(fg);
	const [br, bgc, bb] = hexToRgb(bg);
	return rgbToHex([br + (fr - br) * amount, bgc + (fgc - bgc) * amount, bb + (fb - bb) * amount]);
}

function channel(v: number) {
	const c = v / 255;
	return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export const luminance = (hex: string) => {
	const [r, g, b] = hexToRgb(hex);
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** WCAG contrast ratio between two colours, 1 to 21. Body text needs 4.5. */
export function contrastRatio(a: string, b: string): number {
	const la = luminance(a);
	const lb = luminance(b);
	const [hi, lo] = la > lb ? [la, lb] : [lb, la];
	return (hi + 0.05) / (lo + 0.05);
}

export const WHITE = '#ffffff';
export const INK = '#1f1a14';
export const MIN_CONTRAST = 4.5;

/** Darkens `bg` just enough that white text on it reaches 4.5:1 (unchanged when it already does). */
export function ensureReadableOnWhite(bg: string, min = MIN_CONTRAST): string {
	let [h, s, l] = rgbToHsl(hexToRgb(bg));
	for (let i = 0; i < 60 && contrastRatio(rgbToHex(hslToRgb([h, s, l])), WHITE) < min; i++) l = Math.max(0, l - 0.01);
	return rgbToHex(hslToRgb([h, s, l]));
}

/** The same hue, livelier: more saturated and lighter. Decorative only, and always paired with dark text. */
export function brighten(hex: string): string {
	const [h, s, l] = rgbToHsl(hexToRgb(hex));
	return rgbToHex(hslToRgb([h, Math.min(1, Math.max(s, 0.55) + 0.2), Math.min(0.62, Math.max(l + 0.18, 0.5))]));
}

/** Lightens `bg` until dark ink on it reaches 4.5:1: a bright colour that can still carry readable text. */
export function ensureReadableOnInk(bg: string, ink = INK, min = MIN_CONTRAST): string {
	let [h, s, l] = rgbToHsl(hexToRgb(bg));
	for (let i = 0; i < 60 && contrastRatio(rgbToHex(hslToRgb([h, s, l])), ink) < min; i++) l = Math.min(1, l + 0.01);
	return rgbToHex(hslToRgb([h, s, l]));
}

export interface TablePalette {
	/** Buttons, active chip, prices: white text on it is always readable. */
	accent: string;
	/** A deeper shade for pressed states and text links. */
	accentDeep: string;
	/** The lively colour: gradients, glows, highlights. Dark text only. */
	bright: string;
	/** The far end of the primary button's gradient: lighter than `accent`, still readable under white text. */
	gradEnd: string;
	/** Soft washes of the accent over the paper. */
	tint: string;
	tint2: string;
	line: string;
	/** Page background: the paper with a whisper of the accent. */
	page: string;
	/** `r, g, b` of the accent for rgba() shadows and glows. */
	accentRgb: string;
}

/** Everything the table app needs, derived from the hotel's accent and paper. */
export function tablePalette(accentHex: string, paperHex: string): TablePalette {
	const accent = ensureReadableOnWhite(accentHex);
	const bright = ensureReadableOnInk(brighten(accent));
	const gradEnd = ensureReadableOnWhite(mixOver(bright, accent, 0.55));
	const [r, g, b] = hexToRgb(accent);
	return {
		accent,
		accentDeep: rgbToHex(hexToRgb(accent).map((v) => v * 0.78) as RGB),
		bright,
		gradEnd,
		tint: mixOver(bright, paperHex, 0.1),
		tint2: mixOver(bright, paperHex, 0.2),
		line: mixOver(accent, paperHex, 0.16),
		page: mixOver(bright, paperHex, 0.045),
		accentRgb: `${r}, ${g}, ${b}`
	};
}
