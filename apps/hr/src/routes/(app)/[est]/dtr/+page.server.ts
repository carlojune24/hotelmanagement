import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { businessDateFor } from '$lib/server/time';
import { listDtrEntries } from '$lib/server/hr/dtr';
import {
	DtrImportError,
	addManualPunch,
	computeMonthDtr,
	monthSchema,
	saveMonthDtr
} from '$lib/server/hr/dtr-import';
import {
	buildDtrDays,
	recordFromGenerated,
	recordFromSaved,
	type DayRecord,
	type DtrDay
} from '$lib/server/hr/dtr-view';
import { listEmployees } from '$lib/server/hr/employees';
import { listSchedules } from '$lib/server/hr/schedules';
import { monthBounds } from '$lib/roster';
import type { Actions, PageServerLoad } from './$types';

/** Cheap check that what was saved still matches what the punches say now. */
function sameDays(a: DtrDay[], b: DtrDay[]): boolean {
	const sig = (d: DtrDay) =>
		[d.kind, d.timeIn?.t24, d.breakOut?.t24, d.breakIn?.t24, d.timeOut?.t24, d.lateMinutes, d.undertimeMinutes, d.otMinutes, d.hasLeave].join('|');
	return a.length === b.length && a.every((d, i) => sig(d) === sig(b[i]!));
}

import { canAt } from '$lib/authz';
import {
DtrSubmissionError,
getHandoff,
handoffWarnings,
receiveDtr,
returnDtr,
returnHistory,
submitDtr
} from '$lib/server/hr/dtr-submissions';

/** Main HR may still correct a cutoff it is holding; a manager may not. */
const isApprover = (locals: App.Locals) =>
	locals.user!.isSystemAdmin || canAt(locals.access!, 'approval:*', locals.establishment!.id);

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.access, 'dtr:*', locals.establishment!.id);
	const establishment = locals.establishment!;

	const monthParam = url.searchParams.get('month');
	const month =
		monthParam && monthSchema.safeParse(monthParam).success
			? monthParam
			: businessDateFor(establishment.timezone).slice(0, 7);
	const range = monthBounds(`${month}-01`);

	// Hand-off state travels with every return below, including the "nobody has a device ID" one.
	const canApprove = isApprover(locals);
	const [handoff, warnings] = await Promise.all([
		getHandoff(establishment.id, month),
		handoffWarnings(establishment.id, month)
	]);
	const handoffInfo = {
		handoff,
		warnings,
canApprove,
locked: !canApprove && (handoff.status === 'submitted' || handoff.status === 'received'),
/** Earlier "please correct" notes, shown to Main HR before it sends the month back again. */
returnHistory: canApprove && handoff.id ? await returnHistory(handoff.id) : []
};

	const all = await listEmployees(establishment.id);
	const people = all
		.filter((e) => e.biometricEnrollId)
		.map((e) => ({
			id: e.id,
			name: `${e.lastName}, ${e.firstName}`,
			enrollId: e.biometricEnrollId!,
			position: e.position
		}))
		.sort((a, b) => a.name.localeCompare(b.name));

	const requested = url.searchParams.get('employee');
	const selected = people.find((p) => p.id === requested) ?? people[0] ?? null;

	if (!selected) {
		return {
			month,
			range,
			people,
			unsavedCount: people.length,
			selected: null,
			preview: null,
			saved: null,
			savedState: 'none' as const,
			...handoffInfo
		};
	}

	const [generated, entries, roster] = await Promise.all([
		computeMonthDtr(establishment.id, month, selected.id),
		listDtrEntries(establishment.id, range.start, range.end),
		listSchedules(establishment.id, range.start, range.end)
	]);
	const mine = roster.filter((s) => s.employeeId === selected.id);
	const ofMonth = entries.filter((e) => e.employeeId === selected.id);

	const previewRecords = new Map<string, DayRecord>(
		generated.records.filter((r) => r.action !== 'keep_manual').map((r) => [r.date, recordFromGenerated(r)])
	);
	// A staff-entered DTR row speaks for its day in the preview too.
	for (const e of ofMonth) if (e.source === 'manual') previewRecords.set(e.date, recordFromSaved(e));
	const preview = buildDtrDays({ tz: establishment.timezone, range, roster: mine, records: previewRecords });
	const saved = buildDtrDays({
		tz: establishment.timezone,
		range,
		roster: mine,
		records: new Map(ofMonth.map((e) => [e.date, recordFromSaved(e)]))
	});

	const savedState =
		ofMonth.length === 0 ? ('none' as const) : sameDays(preview.days, saved.days) ? ('same' as const) : ('differs' as const);

	const savedIds = new Set(entries.map((e) => e.employeeId));
	const unsavedCount = people.filter((p) => !savedIds.has(p.id)).length;

	return { month, range, people, unsavedCount, selected, preview, saved, savedState, ...handoffInfo };
};

const addTimeSchema = z.object({
	employeeId: z.string().uuid(),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date.'),
	time: z.string().regex(/^\d{2}:\d{2}$/, 'Pick the time.'),
	note: z.string().trim().min(3, 'Say why the time is being added.').max(300)
});

function failure(e: unknown) {
	if (e instanceof DtrImportError || e instanceof DtrSubmissionError) return fail(400, { error: e.message });
	throw e;
}

export const actions: Actions = {
	/** Saves the month for one employee, or everyone with a Biometric ID when `employeeId` is empty. */
	save: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'dtr:*', event.locals.establishment!.id);
		try {
			const establishmentId = event.locals.establishment!.id;
			const fd = await event.request.formData();
			const month = monthSchema.safeParse(fd.get('month'));
			if (!month.success) throw new DtrImportError('Pick a month.');
			const emp = fd.get('employeeId');
			const employeeId = typeof emp === 'string' && emp ? emp : undefined;
			const r = await saveMonthDtr(establishmentId, month.data, employeeId, {
				approver: isApprover(event.locals)
			});
			await writeAudit({
				establishmentId,
				actor: event.locals.user,
				action: 'dtr.generate',
				entityType: 'dtr_entry',
				entityId: null,
				after: { month: month.data, employeeId: employeeId ?? null, saved: r.saved, absent: r.absent, keptManual: r.keptManual }
			});
			const who = employeeId ? '' : ` for ${r.month.employeeCount} employee${r.month.employeeCount === 1 ? '' : 's'}`;
			return {
				ok: `Saved ${r.saved} day${r.saved === 1 ? '' : 's'}${who}${r.absent ? ` (${r.absent} absent)` : ''}${r.keptManual ? `; ${r.keptManual} staff-entered kept` : ''}.`
			};
		} catch (e) {
			return failure(e);
		}
	},

	/** A forgotten punch, proven present: stored as a manual punch against the employee's Biometric ID. */
	addTime: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'dtr:*', event.locals.establishment!.id);
		try {
			const establishmentId = event.locals.establishment!.id;
			const parsed = addTimeSchema.safeParse(Object.fromEntries(await event.request.formData()));
			if (!parsed.success) throw new DtrImportError(parsed.error.issues[0]!.message);
			const emp = (await listEmployees(establishmentId)).find((e) => e.id === parsed.data.employeeId);
			if (!emp?.biometricEnrollId) throw new DtrImportError('That employee has no Biometric ID yet.');
			const p = await addManualPunch(
				establishmentId,
				{
					enrollId: emp.biometricEnrollId,
					date: parsed.data.date,
					time: parsed.data.time,
					note: parsed.data.note
				},
				event.locals.user?.id ?? null,
				{ approver: isApprover(event.locals) }
			);
			await writeAudit({
				establishmentId,
				actor: event.locals.user,
				action: 'dtr.add_punch',
				entityType: 'biometric_punch',
				entityId: p.id,
				after: { employeeId: emp.id, date: parsed.data.date, time: parsed.data.time, note: parsed.data.note }
			});
			return { ok: 'Time added.' };
		} catch (e) {
			return failure(e);
		}
	},

	/** Main HR, from the establishment's own DTR: receive what was sent. */
	receiveMonth: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'approval:*');
		try {
			const establishmentId = event.locals.establishment!.id;
			const month = monthSchema.safeParse((await event.request.formData()).get('month'));
			if (!month.success) throw new DtrSubmissionError('Pick a month.');
			const { id } = await getHandoff(establishmentId, month.data);
			if (!id) throw new DtrSubmissionError('This month has not been sent yet.');
			const row = await receiveDtr(id, event.locals.user!.id);
			await writeAudit({
				actor: event.locals.user,
				establishmentId,
				action: 'dtr.received',
				entityType: 'dtr_submission',
				entityId: row.id,
				after: { cutoffStart: row.cutoffStart, note: '' }
			});
			return { ok: 'DTR received. It stays locked for the establishment.' };
		} catch (e) {
			return failure(e);
		}
	},

	/** Main HR, from the establishment's own DTR: send it back with what needs correcting. */
	returnMonth: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'approval:*');
		try {
			const establishmentId = event.locals.establishment!.id;
			const fd = await event.request.formData();
			const month = monthSchema.safeParse(fd.get('month'));
			if (!month.success) throw new DtrSubmissionError('Pick a month.');
			const { id } = await getHandoff(establishmentId, month.data);
			if (!id) throw new DtrSubmissionError('This month has not been sent yet.');
			const note = String(fd.get('note') ?? '');
			const row = await returnDtr(id, note, event.locals.user!.id);
			await writeAudit({
				actor: event.locals.user,
				establishmentId,
				action: 'dtr.returned',
				entityType: 'dtr_submission',
				entityId: row.id,
				after: { cutoffStart: row.cutoffStart, note: note.trim() }
			});
			return { ok: 'DTR sent back to the establishment with your note.' };
		} catch (e) {
			return failure(e);
		}
	},

	/** Manager → Main HR: send this month's saved DTR. Locks it until Main HR receives or returns it. */
	submitMonth: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'dtr:*', event.locals.establishment!.id);
		try {
			const establishmentId = event.locals.establishment!.id;
			const month = monthSchema.safeParse((await event.request.formData()).get('month'));
			if (!month.success) throw new DtrSubmissionError('Pick a month.');
			await submitDtr(establishmentId, month.data, event.locals.user?.id ?? null);
			await writeAudit({
				establishmentId,
				actor: event.locals.user,
				action: 'dtr.submit',
				entityType: 'dtr_submission',
				entityId: month.data,
				after: { month: month.data }
			});
			return { ok: 'DTR sent to Main HR. It is locked until they receive or return it.' };
		} catch (e) {
			return failure(e);
		}
	}
};
