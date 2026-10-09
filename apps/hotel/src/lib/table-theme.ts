import { DEFAULT_DISPLAY_FONT, DISPLAY_FONTS } from './branding';
import { tablePalette } from './color';

/**
 * The hotel's colours and display font as CSS variables, for the table app's root and for portalled
 * sheets (which render outside it). The `--ledger-*` / `--hotel-*` ones are the booking site's own;
 * the `--tq-*` ones are the table app's lively palette, derived from the same accent (`tablePalette`).
 */
export function themeStyle(
	theme: { accent: string; accentLight: string; accentDeep: string; patternUri: string; paper: string; paperDeep: string },
	branding: { fontDisplay?: keyof typeof DISPLAY_FONTS | null }
): string {
	const family = DISPLAY_FONTS[branding.fontDisplay ?? DEFAULT_DISPLAY_FONT].family;
	const p = tablePalette(theme.accent, theme.paper);
	return (
		`--hotel-accent: ${theme.accent}; ` +
		`--hotel-accent-light: ${theme.accentLight}; ` +
		`--hotel-accent-deep: ${theme.accentDeep}; ` +
		`--hotel-woven-pattern: url("${theme.patternUri}"); ` +
		`--ledger-paper: ${theme.paper}; ` +
		`--ledger-paper-2: ${theme.paperDeep}; ` +
		`--ledger-page-bg: var(--ledger-paper); ` +
		`--ledger-font-display: ${family}; ` +
		`--tq-accent: ${p.accent}; ` +
		`--tq-accent-deep: ${p.accentDeep}; ` +
		`--tq-bright: ${p.bright}; ` +
		`--tq-grad-end: ${p.gradEnd}; ` +
		`--tq-tint: ${p.tint}; ` +
		`--tq-tint-2: ${p.tint2}; ` +
		`--tq-line: ${p.line}; ` +
		`--tq-page: ${p.page}; ` +
		`--tq-accent-rgb: ${p.accentRgb};`
	);
}
