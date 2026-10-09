import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { contrastRatio } from './color';
import { ALL_CATEGORIES, STATUS_COLORS, STEPS, billTotal, buildMenuSections, categoryChips, effectiveCategory, visibleSections, inProgressLabel, isLive, liveCount, statusLabel, statusShort, statusTone, stepIndex, summaryLine } from './dining-qr-ui';

const o = (status: string, paymentStatus = 'unpaid', totalCentavos = 10_000) => ({ status, paymentStatus, totalCentavos });

describe('statusLabel and stepIndex', () => {
	it('words every status the guest can see', () => {
		for (const s of ['pending_acceptance', 'new', 'accepted', 'preparing', 'ready', 'served', 'cancelled']) {
			expect(statusLabel(s)).not.toBe(s);
		}
		expect(statusLabel('mystery')).toBe('mystery');
	});
	it('puts an order on one of four steps, and none when it was not accepted', () => {
		expect(STEPS).toEqual(['Sent', 'Preparing', 'Ready', 'Served']);
		expect(['pending_acceptance', 'new', 'accepted'].map(stepIndex)).toEqual([0, 0, 0]);
		expect(stepIndex('preparing')).toBe(1);
		expect(stepIndex('ready')).toBe(2);
		expect(stepIndex('served')).toBe(3);
		expect(stepIndex('cancelled')).toBe(-1);
		expect(stepIndex('unknown')).toBe(-1);
	});
});

describe('statusTone and statusShort', () => {
	it('gives every status a colour family and a word', () => {
		expect(['pending_acceptance', 'new', 'accepted'].map(statusTone)).toEqual(['sent', 'sent', 'sent']);
		expect(statusTone('preparing')).toBe('preparing');
		expect(statusTone('ready')).toBe('ready');
		expect(statusTone('served')).toBe('served');
		expect(statusTone('cancelled')).toBe('bad');
		expect(statusTone('weird')).toBe('bad');
		for (const s of ['pending_acceptance', 'new', 'accepted', 'preparing', 'ready', 'served', 'cancelled']) expect(statusShort(s).length).toBeGreaterThan(0);
		expect(statusShort('preparing')).toBe('Preparing');
		expect(statusShort('x')).toBe('x');
	});
});

describe('status colours', () => {
	it('are readable: every status text on its own soft background reaches 4.5:1', () => {
		for (const [tone, c] of Object.entries(STATUS_COLORS)) {
			expect(contrastRatio(c.fg, c.bg), tone).toBeGreaterThanOrEqual(4.5);
		}
	});
	it('match the stylesheet, so the page and the tests cannot drift apart', () => {
		const css = readFileSync(new URL('../routes/[hotel]/(table)/table-ordering.css', import.meta.url), 'utf8').toLowerCase();
		const names: Record<string, string> = { sent: 'sent', preparing: 'preparing', ready: 'ready', served: 'served', bad: 'bad' };
		for (const [tone, c] of Object.entries(STATUS_COLORS)) {
			expect(css, tone).toContain(`--tq-${names[tone]}: ${c.fg};`);
			expect(css, tone).toContain(`--tq-${names[tone]}-bg: ${c.bg};`);
		}
	});
});

describe('menu categories', () => {
	const cats = [
		{ id: 'fried', name: 'Fried' },
		{ id: 'soup', name: 'Soup' },
		{ id: 'coffee', name: 'Coffee' },
		{ id: 'empty', name: 'Desserts' }
	];
	const dish = (id: string, categoryId: string | null) => ({ id, categoryId });
	const items = [dish('a', 'fried'), dish('b', 'soup'), dish('c', 'soup'), dish('d', 'coffee'), dish('e', null), dish('f', 'gone')];

	it('keeps the restaurant\'s order, drops empty categories and gathers loose dishes under Also', () => {
		const sections = buildMenuSections(cats, items);
		expect(sections.map((s) => [s.id, s.name, s.items.length])).toEqual([
			['fried', 'Fried', 1],
			['soup', 'Soup', 2],
			['coffee', 'Coffee', 1],
			['other', 'Also', 2]
		]);
	});
	it('has no heading when nothing is categorised', () => {
		expect(buildMenuSections([], [dish('a', null)])).toEqual([{ id: 'other', name: '', items: [dish('a', null)] }]);
		expect(buildMenuSections([], [])).toEqual([]);
	});
	it('offers All first, then every named category; nothing to choose from one section', () => {
		const chips = categoryChips(buildMenuSections(cats, items));
		expect(chips.map((c) => c.name)).toEqual(['All', 'Fried', 'Soup', 'Coffee', 'Also']);
		expect(chips[0]!.id).toBe(ALL_CATEGORIES);
		expect(categoryChips(buildMenuSections(cats.slice(0, 1), [dish('a', 'fried')]))).toEqual([]);
		expect(categoryChips(buildMenuSections([], [dish('a', null)]))).toEqual([]);
	});
	it('shows everything for All and only the chosen category otherwise', () => {
		const sections = buildMenuSections(cats, items);
		expect(visibleSections(sections, ALL_CATEGORIES)).toHaveLength(4);
		expect(visibleSections(sections, 'soup').map((s) => s.id)).toEqual(['soup']);
		expect(visibleSections(sections, 'soup')[0]!.items.map((i) => i.id)).toEqual(['b', 'c']);
	});
	it('falls back to All when the chosen category has left the menu', () => {
		const sections = buildMenuSections(cats, items);
		expect(effectiveCategory(sections, 'vanished')).toBe(ALL_CATEGORIES);
		expect(effectiveCategory(sections, 'coffee')).toBe('coffee');
		expect(visibleSections(sections, 'vanished')).toHaveLength(4);
	});
});

describe('live orders', () => {
	it('counts the ones still on their way', () => {
		const orders = [o('pending_acceptance'), o('preparing'), o('served'), o('cancelled')];
		expect(liveCount(orders)).toBe(2);
		expect(isLive('served')).toBe(false);
		expect(isLive('ready')).toBe(true);
	});
	it('reads well for one and many', () => {
		expect(inProgressLabel(1)).toBe('1 order in progress');
		expect(inProgressLabel(3)).toBe('3 orders in progress');
		expect(inProgressLabel(0)).toBe('0 orders in progress');
	});
});

describe('billTotal', () => {
	it('adds what is unpaid and not cancelled', () => {
		expect(billTotal([o('served', 'unpaid', 10_000), o('preparing', 'unpaid', 5_000), o('cancelled', 'unpaid', 99_000), o('served', 'paid', 7_000)])).toBe(15_000);
		expect(billTotal([])).toBe(0);
	});
});

describe('summaryLine', () => {
	it('says what is happening now', () => {
		expect(summaryLine([])).toBe('');
		expect(summaryLine([o('served'), o('cancelled')])).toBe('Everything has been served');
		expect(summaryLine([o('pending_acceptance')])).toBe('Waiting for the restaurant to confirm');
		expect(summaryLine([o('preparing')])).toBe('1 order being prepared');
		expect(summaryLine([o('preparing'), o('new')])).toBe('2 orders in progress');
		expect(summaryLine([o('ready'), o('preparing')])).toBe('Your food is on its way');
		expect(summaryLine([o('new')])).toBe('1 order sent to the kitchen');
	});
});
