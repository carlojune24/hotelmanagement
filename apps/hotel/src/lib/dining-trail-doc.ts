/**
 * The dining order trail as a plain document, so the printed sheet and the CSV are drawn from one
 * model (same pattern as the Sales and Cashflow reports). Pure: no database, no SvelteKit.
 *
 * IP address and browser are in the model only when the trail was built for a hotel admin; for
 * anyone else the trail never carries them, so they cannot reach the sheet or the CSV.
 */
import type { DiningTrail } from '$lib/server/dining-trail';
import type { DocColumn, ReportDoc } from '$lib/dining-report-doc';
import { browserOf } from '$lib/audit-labels';

const T = (label: string): DocColumn => ({ label, kind: 'text' });
const M = (label: string): DocColumn => ({ label, kind: 'money' });

const METHOD: Record<string, string> = {
	cash: 'Cash',
	card: 'Card',
	gcash: 'GCash',
	maya: 'Maya',
	paymongo: 'Online (PayMongo)',
	bank_transfer: 'Bank transfer',
	unknown: 'Unknown'
};
const words = (s: string) => {
	const w = s.replace(/_/g, ' ');
	return w.charAt(0).toUpperCase() + w.slice(1);
};

export function formatTrailTime(iso: string, timezone: string): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23'
	})
		.format(new Date(iso))
		.replace(',', '');
}

export function buildTrailDoc(trail: DiningTrail, ctx: { timezone: string }): ReportDoc {
	const when = (iso: string) => formatTrailTime(iso, ctx.timezone);
	const first = trail.orders[0];
	const res = trail.reservation;
	const multi = trail.orders.length > 1;

	const meta: [string, string][] = [
		['Number', trail.ref],
		['Type', trail.kind === 'reservation' ? 'Table reservation' : first ? words(first.orderType) + ' order' : 'Order'],
		['Venue', (res?.venue || first?.venue) ?? ''],
		['Guest', (res?.guestName || first?.guestName) ?? ''],
		[
			'Status',
			trail.kind === 'reservation' && res
				? words(res.status)
				: first
					? `${words(first.status)} · ${words(first.paymentStatus)}`
					: ''
		]
	];
	if (res && trail.kind === 'order') meta.push(['Reservation', `${res.code} · party of ${res.partySize}`]);
	if (trail.kind === 'reservation' && res) {
		meta.push(['Party', `${res.partySize}${res.tables.length ? ` · table ${res.tables.join(', ')}` : ''}`]);
		if (trail.orders.length) meta.push(['Orders', trail.orders.map((o) => o.code).join(', ')]);
	}

	const timelineColumns: DocColumn[] = [T('Date and time'), T('Who'), T('What')];
	if (multi) timelineColumns.push(T('Order'));
	timelineColumns.push(T('Details'), M('Amount'));
	if (trail.detailed) timelineColumns.push(T('From'));

	const timeline = trail.events.map((e) => {
		const who = e.actor.kind === 'unknown' ? e.actor.label : `${e.actor.label}${e.actor.kind === 'staff' ? '' : ` (${e.actor.kind})`}`;
		const row: (string | number)[] = [when(e.at), who, e.label];
		if (multi) row.push(e.code ?? '');
		row.push(e.detail, e.amountCentavos ?? 0);
		if (trail.detailed) row.push([e.ip, browserOf(e.userAgent)].filter(Boolean).join(' · '));
		return row;
	});

	const m = trail.money;
	const notes = [
		'Times are in the hotel’s timezone. Amounts are in Philippine pesos.',
		'Each step names who did it. “Guest” is a visitor to the website or a table QR code; “System” is an automatic step (an online payment confirmation, an expired checkout). A step older than this record-keeping reads “Not recorded” or “Guest or system” because who did it was not stored at the time.',
		'Steps marked from records come from the order, payment, kitchen and cash records themselves; they are listed only when no audit entry already describes the same step.'
	];
	if (trail.detailed) {
		notes.push('The From column (IP address and browser) is personal data under the Data Privacy Act. It is shown to hotel administrators only and should not be shared.');
	}

	return {
		title: trail.kind === 'reservation' ? 'Table reservation trail' : 'Dining order trail',
		period: trail.ref,
		periodLabel: 'Number',
		meta,
		summary: [
			{ label: 'Billed', value: m.billedCentavos, kind: 'money' },
			{ label: 'Collected', value: m.collectedCentavos, kind: 'money' },
			{ label: 'Refunded', value: m.refundedCentavos, kind: 'money' },
			{ label: 'Net', value: m.netCentavos, kind: 'money' },
			{ label: 'Steps recorded', value: trail.events.length, kind: 'int' }
		],
		sections: [
			{
				title: 'Who handled it',
				columns: [T('Role'), T('Who'), T('Date and time')],
				rows: trail.handled.map((h) => [h.role, h.who, h.at ? when(h.at) : '']),
				emptyText: 'Nothing recorded yet.'
			},
			{
				title: 'Money',
				columns: [T('Item'), M('Amount')],
				rows: [
					['Billed', m.billedCentavos],
					...m.byMethod.map((x): (string | number)[] => [`Collected by ${METHOD[x.method] ?? words(x.method)}`, x.centavos]),
					...(m.roomChargedCentavos ? [['Charged to a room bill', m.roomChargedCentavos] as (string | number)[]] : []),
					['Refunded', m.refundedCentavos]
				],
				total: ['Net collected', m.netCentavos]
			},
			{
				title: 'Receipts and invoices',
				columns: [T('Number'), T('Type'), T('Status'), T('Issued by'), T('Date and time')],
				rows: trail.documents.map((d) => [
					d.formattedNo,
					d.type === 'invoice' ? 'Invoice' : 'Official receipt',
					d.status === 'cancelled' && d.cancelReason ? `Cancelled: ${d.cancelReason}` : words(d.status),
					d.issuedBy ?? 'Not recorded',
					when(d.issuedAt)
				]),
				emptyText: 'No receipt or invoice issued.'
			},
			{
				title: 'Timeline',
				columns: timelineColumns,
				rows: timeline,
				emptyText: 'Nothing recorded yet.'
			}
		],
		notes
	};
}
