/**
 * The Woven Ledger world's signature device (see apps/hotel/DESIGN.md): a hotel's
 * accent color rendered as a real repeating diamond step-weave pattern, never a
 * flat swatch. Colors are baked into the returned data URI per call — callers
 * always pass the *current* hotel's resolved accent, never a hardcoded value.
 */

function hexToRgb(hex: string): [number, number, number] {
	const clean = hex.replace('#', '');
	const num = parseInt(clean, 16);
	return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
	return (
		'#' +
		[r, g, b]
			.map((v) =>
				Math.round(Math.max(0, Math.min(255, v)))
					.toString(16)
					.padStart(2, '0')
			)
			.join('')
	);
}

function mix(hex: string, target: [number, number, number], amount: number): string {
	const [r, g, b] = hexToRgb(hex);
	const [tr, tg, tb] = target;
	return rgbToHex([r + (tr - r) * amount, g + (tg - g) * amount, b + (tb - b) * amount]);
}

export const lighten = (hex: string, amount: number) => mix(hex, [255, 255, 255], amount);
export const darken = (hex: string, amount: number) => mix(hex, [0, 0, 0], amount);

/** Builds the repeating diamond step-weave tile (28×28) for a given accent hex, as a CSS `background-image` data URI. */
export function wovenPatternDataUri(accentHex: string, tile = 28): string {
	const deep = darken(accentHex, 0.35);
	const light = lighten(accentHex, 0.4);
	const half = tile / 2;
	const inset = half * 0.32;
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}" viewBox="0 0 ${tile} ${tile}">` +
		`<path d="M${half} 0 L${tile} ${half} L${half} ${tile} L0 ${half} Z" fill="none" stroke="${deep}" stroke-width="1.75"/>` +
		`<path d="M${half} ${inset} L${tile - inset} ${half} L${half} ${tile - inset} L${inset} ${half} Z" fill="${light}" opacity="0.85"/>` +
		`</svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
