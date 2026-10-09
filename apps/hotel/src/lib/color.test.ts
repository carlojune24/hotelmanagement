import { describe, expect, it } from 'vitest';
import { ACCENT_LIGHTNESS, ACCENT_PALETTE, ACCENT_SATURATION, DEFAULT_ACCENT_COLOR, DEFAULT_PAPER_COLOR } from './branding';
import {
	INK,
	MIN_CONTRAST,
	WHITE,
	brighten,
	contrastRatio,
	ensureReadableOnInk,
	ensureReadableOnWhite,
	hexToRgb,
	hslToRgb,
	mixOver,
	rgbToHex,
	rgbToHsl,
	tablePalette
} from './color';

/** Every accent a hotel can pick with the colour picker: the curated hues at the locked saturation/lightness. */
const PICKABLE = ACCENT_PALETTE.map((p) => rgbToHex(hslToRgb([p.hue, ACCENT_SATURATION / 100, ACCENT_LIGHTNESS / 100])));
const EDGE_CASES = ['#ffd400', '#ffffff', '#000000', '#00ff00', '#ff0000', '#7a7a7a'];

describe('colour basics', () => {
	it('converts hex and hsl both ways', () => {
		expect(hexToRgb('#836819')).toEqual([131, 104, 25]);
		expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
		expect(rgbToHex([131, 104, 25])).toBe('#836819');
		const back = rgbToHex(hslToRgb(rgbToHsl(hexToRgb('#3366cc'))));
		expect(back).toBe('#3366cc');
	});
	it('mixes a colour over another by an amount', () => {
		expect(mixOver('#000000', '#ffffff', 0)).toBe('#ffffff');
		expect(mixOver('#000000', '#ffffff', 1)).toBe('#000000');
		expect(mixOver('#000000', '#ffffff', 0.5)).toBe('#808080');
	});
	it('measures contrast the WCAG way', () => {
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
		expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
		expect(contrastRatio('#777777', '#ffffff')).toBeGreaterThan(4.4);
	});
});

describe('readability guards', () => {
	it('leaves a colour alone when white text on it is already readable, and darkens it when not', () => {
		expect(ensureReadableOnWhite(DEFAULT_ACCENT_COLOR)).toBe(DEFAULT_ACCENT_COLOR);
		const fixed = ensureReadableOnWhite('#ffd400');
		expect(fixed).not.toBe('#ffd400');
		expect(contrastRatio(fixed, WHITE)).toBeGreaterThanOrEqual(MIN_CONTRAST);
		expect(contrastRatio(ensureReadableOnWhite('#ffffff'), WHITE)).toBeGreaterThanOrEqual(MIN_CONTRAST);
	});
	it('lightens a colour until dark text on it is readable', () => {
		const fixed = ensureReadableOnInk('#1d4ed8');
		expect(contrastRatio(fixed, INK)).toBeGreaterThanOrEqual(MIN_CONTRAST);
		expect(contrastRatio(ensureReadableOnInk('#000000'), INK)).toBeGreaterThanOrEqual(MIN_CONTRAST);
	});
	it('brightening keeps the hue and makes the colour livelier, not darker', () => {
		const [h0, s0, l0] = rgbToHsl(hexToRgb(DEFAULT_ACCENT_COLOR));
		const [h1, s1, l1] = rgbToHsl(hexToRgb(brighten(DEFAULT_ACCENT_COLOR)));
		expect(Math.abs(h1 - h0)).toBeLessThan(4);
		expect(s1).toBeGreaterThan(s0);
		expect(l1).toBeGreaterThan(l0);
	});
});

describe('tablePalette', () => {
	for (const accent of [DEFAULT_ACCENT_COLOR, ...PICKABLE, ...EDGE_CASES]) {
		it(`stays readable for the accent ${accent}`, () => {
			const p = tablePalette(accent, DEFAULT_PAPER_COLOR);
			// White text on the button colour and on both ends of its gradient.
			expect(contrastRatio(p.accent, WHITE)).toBeGreaterThanOrEqual(MIN_CONTRAST);
			expect(contrastRatio(p.gradEnd, WHITE)).toBeGreaterThanOrEqual(MIN_CONTRAST);
			expect(contrastRatio(p.accentDeep, WHITE)).toBeGreaterThanOrEqual(MIN_CONTRAST);
			// Dark text on the lively colour and on the soft washes.
			expect(contrastRatio(p.bright, INK)).toBeGreaterThanOrEqual(MIN_CONTRAST);
			for (const wash of [p.tint, p.tint2, p.page]) expect(contrastRatio(wash, INK)).toBeGreaterThanOrEqual(10);
			// Accent as text on a card.
			expect(contrastRatio(p.accent, '#ffffff')).toBeGreaterThanOrEqual(MIN_CONTRAST);
		});
	}
	it('gives the default gold a warm, livelier second colour', () => {
		const p = tablePalette(DEFAULT_ACCENT_COLOR, DEFAULT_PAPER_COLOR);
		const [, sAccent] = rgbToHsl(hexToRgb(p.accent));
		const [, sBright, lBright] = rgbToHsl(hexToRgb(p.bright));
		expect(sBright).toBeGreaterThan(sAccent);
		expect(lBright).toBeGreaterThan(0.45);
		expect(p.accentRgb).toBe('131, 104, 25');
	});
	it('tints are lighter than the accent and sit on the paper', () => {
		const p = tablePalette(DEFAULT_ACCENT_COLOR, '#fffdf8');
		expect(contrastRatio(p.tint, '#fffdf8')).toBeLessThan(1.3);
		expect(contrastRatio(p.tint2, '#fffdf8')).toBeGreaterThan(contrastRatio(p.tint, '#fffdf8'));
	});
});
