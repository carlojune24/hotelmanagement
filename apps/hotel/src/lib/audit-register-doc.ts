/**
 * The filtered Audit log as a plain document, so the printed A4 register and the CSV come from one
 * model (same pattern as the other report sheets). Pure: no database, no SvelteKit.
 *
 * Only hotel admins can reach the Audit log, so IP address and browser are included here.
 */
import type { AuditLog } from '$lib/server/db/schema/index';
import type { DocColumn, ReportDoc } from '$lib/dining-report-doc';
import { actionLabel, actorOf, browserOf, detailOf, obj } from '$lib/audit-labels';
import { formatTrailTime } from '$lib/dining-trail-doc';

const T = (label: string): DocColumn => ({ label, kind: 'text' });

export function buildAuditRegisterDoc(
	entries: AuditLog[],
	ctx: { timezone: string; period: string; filters: string[]; truncatedAt: number | null }
): ReportDoc {
	const rows = entries.map((e) => {
		const a = actorOf(e);
		const who = a.kind === 'unknown' ? a.label : a.kind === 'staff' ? a.label : `${a.label} (${a.kind})`;
		const { detail } = detailOf(e.action, obj(e.before), obj(e.after));
		const entity = `${e.entityType.replace(/_/g, ' ')}${e.refCode ? ` ${e.refCode}` : e.entityId ? ` ${e.entityId.slice(0, 8)}` : ''}`;
		return [
			formatTrailTime(e.createdAt.toISOString(), ctx.timezone),
			who,
			actionLabel(e.action),
			entity,
			detail,
			[e.ipAddress, browserOf(e.userAgent)].filter(Boolean).join(' · ')
		];
	});
	const meta: [string, string][] = [['Entries', String(entries.length)]];
	meta.push(['Filters', ctx.filters.length ? ctx.filters.join(' · ') : 'None (every entry)']);
	const notes = [
		'Times are in the hotel’s timezone, oldest first.',
		'“Guest” is a visitor to the website; “System” is an automatic step (a payment confirmation, an expiry). An entry from before who-did-it was recorded reads “Guest or system (not recorded)”.',
		'The From column (IP address and browser) is personal data under the Data Privacy Act. It is for hotel administrators only and should not be shared.'
	];
	if (ctx.truncatedAt) notes.push(`Only the newest ${ctx.truncatedAt} matching entries are included. Narrow the filters to see the rest.`);
	return {
		title: 'Audit register',
		period: ctx.period,
		meta,
		summary: [{ label: 'Entries', value: entries.length, kind: 'int' }],
		sections: [
			{
				title: 'Entries',
				columns: [T('Date and time'), T('Who'), T('What'), T('Entity'), T('Details'), T('From')],
				rows,
				emptyText: 'No entries match these filters.'
			}
		],
		notes
	};
}
