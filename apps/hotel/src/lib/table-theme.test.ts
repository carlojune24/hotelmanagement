import { describe, expect, it } from 'vitest';
import { themeStyle } from './table-theme';

const theme = { accent: '#836819', accentLight: '#c0b48c', accentDeep: '#5b4711', patternUri: 'data:x', paper: '#ffffff', paperDeep: '#f7f7f7' };

describe('themeStyle', () => {
	it('carries the booking site variables and the table app palette', () => {
		const css = themeStyle(theme, {});
		for (const v of ['--hotel-accent', '--ledger-paper', '--ledger-font-display', '--tq-accent', '--tq-bright', '--tq-grad-end', '--tq-tint', '--tq-tint-2', '--tq-line', '--tq-page', '--tq-accent-rgb']) {
			expect(css).toContain(v + ':');
		}
		expect(css).toContain('--tq-accent-rgb: 131, 104, 25;');
	});
	it('follows the hotel: another accent gives another palette', () => {
		const a = themeStyle(theme, {});
		const b = themeStyle({ ...theme, accent: '#1a5f7a' }, {});
		expect(a).not.toBe(b);
		expect(b).toContain('--hotel-accent: #1a5f7a;');
	});
});
