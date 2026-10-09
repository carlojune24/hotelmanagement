import { describe, expect, it } from 'vitest';
import { DOCUMENT_CHOICE_LABEL, batchPrintHref, parseBatchIds, thermalPadding, toPayDocuments } from './print-batch';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('batchPrintHref', () => {
	it('lists the ids and only adds the options that were asked for', () => {
		expect(batchPrintHref('inn', [A, B])).toBe(`/inn/print/batch?ids=${A}%2C${B}`);
		expect(batchPrintHref('inn', [A], { auto: true, format: 'a4' })).toBe(`/inn/print/batch?ids=${A}&auto=1&format=a4`);
		expect(batchPrintHref('inn', [A], { format: 'thermal' })).toBe(`/inn/print/batch?ids=${A}`);
	});
});

describe('parseBatchIds', () => {
	it('keeps valid ids once each and drops junk', () => {
		expect(parseBatchIds(`${A}, ${B},${A},nope,`)).toEqual([A, B]);
		expect(parseBatchIds(null)).toEqual([]);
		expect(parseBatchIds('')).toEqual([]);
	});
	it('caps the list', () => {
		const many = Array.from({ length: 60 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`).join(',');
		expect(parseBatchIds(many)).toHaveLength(40);
		expect(parseBatchIds(many, 5)).toHaveLength(5);
	});
});

describe('thermalPadding', () => {
	it('leaves more room on the right of an 80mm roll than the left, where the printer cannot reach', () => {
		expect(thermalPadding(80)).toBe('3mm 8mm 3mm 4mm');
		expect(thermalPadding(58)).toBe('3mm 5mm 3mm 3mm');
	});
});

describe('document choices', () => {
	it('shows Official Receipt, Invoice, then Normal Bill', () => {
		expect(Object.values(DOCUMENT_CHOICE_LABEL)).toEqual(['Official Receipt', 'Invoice', 'Normal Bill']);
	});
	it('a Normal Bill issues no document on the server', () => {
		expect(toPayDocuments('or')).toBe('or');
		expect(toPayDocuments('invoice')).toBe('invoice');
		expect(toPayDocuments('bill')).toBe('none');
		expect(toPayDocuments('none')).toBe('none');
	});
});
