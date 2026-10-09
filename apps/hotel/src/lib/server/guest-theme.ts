import { DEFAULT_ACCENT_COLOR, DEFAULT_PAPER_COLOR, parseBranding } from './branding';
import { darken, lighten, wovenPatternDataUri } from '../woven-pattern';

/**
 * The hotel's guest-facing look, computed from its saved branding: accent, paper and the woven
 * pattern. One source for every guest layout (the booking site and the table-ordering app) so a
 * hotel's colours can never drift between them.
 */
export function guestTheme(hotelConfig: Parameters<typeof parseBranding>[0]) {
	const branding = parseBranding(hotelConfig);
	const accent = branding.accentColor ?? DEFAULT_ACCENT_COLOR;
	const paper = branding.paperColor ?? DEFAULT_PAPER_COLOR;
	return {
		branding,
		theme: {
			accent,
			accentLight: lighten(accent, 0.55),
			accentDeep: darken(accent, 0.3),
			patternUri: wovenPatternDataUri(accent),
			paper,
			/** Section bands/zebra rows: a shade deeper than `paper`, computed from whatever paper tone the hotel picked. */
			paperDeep: darken(paper, 0.03)
		}
	};
}
