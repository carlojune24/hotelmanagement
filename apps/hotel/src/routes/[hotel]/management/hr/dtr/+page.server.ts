import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { businessDateFor } from '$lib/server/finance/shared';
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
		[d.kind, d.timeIn?.t24, d.breakOut?.t24, d.breakIn?.t24, d.timeOut?.t24, d.lateMinutes, d.undertimeMinutes].join('|');
	return a.length === b.length && a.every((d, i) => sig(d) === sig(b[i]!));
}

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'dtr:*');
	const hotel = locals.hotel!;

	const monthParam = url.searchParams.get('month');
	const month =
		monthParam && monthSchema.safeParse(monthParam).success
			? monthParam
			: businessDateFor(hotel.timezone).slice(0, 7);
	const range = monthBounds(`${month}-01`);

	const all = await listEmployees(hotel.id);
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
		return { month, range, people, selected: null, preview: null, saved: null, savedState: 'none' as const };
	}

	const [generated, entries, roster] = await Promise.all([
		computeMonthDtr(hotel.id, month, selected.id),
		listDtrEntries(hotel.id, range.start, range.end),
		listSchedules(hotel.id, range.start, range.end)
	]);
	const mine = roster.filter((s) => s.employeeId === selected.id);
	const ofMonth = entries.filter((e) => e.employeeId === selected.id);

	const previewRecords = new Map<string, DayRecord>(
		generated.records.filter((r) => r.action !== 'keep_manual').map((r) => [r.date, recordFromGenerated(r)])
	);
	// A staff-entered DTR row speaks for its day in the preview too.
	for (const e of ofMonth) if (e.source === 'manual') previewRecords.set(e.date, recordFromSaved(e));
	const preview = buildDtrDays({ tz: hotel.timezone, range, roster: mine, records: previewRecords });
	const saved = buildDtrDays({
		tz: hotel.timezone,
		range,
		roster: mine,
		records: new Map(ofMonth.map((e) => [e.date, recordFromSaved(e)]))
	});

	const savedState =
		ofMonth.length === 0 ? ('none' as const) : sameDays(preview.days, saved.days) ? ('same' as const) : ('differs' as const);

	return { month, range, people, selected, preview, saved, savedState };
};

const addTimeSchema = z.object({
	employeeId: z.string().uuid(),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date.'),
	time: z.string().regex(/^\d{2}:\d{2}$/, 'Pick the time.'),
	note: z.string().trim().min(3, 'Say why the time is being added.').max(300)
});

function failure(e: unknown) {
	if (e instanceof DtrImportError) return fail(400, { error: e.message });
	throw e;
}

export const actions: Actions = {
	/** Saves the month for one employee, or everyone with a Biometric ID when `employeeId` is empty. */
	save: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dtr:*');
		try {
			const hotelId = event.locals.hotel!.id;
			const fd = await event.request.formData();
			const month = monthSchema.safeParse(fd.get('month'));
			if (!month.success) throw new DtrImportError('Pick a month.');
			const emp = fd.get('employeeId');
			const employeeId = typeof emp === 'string' && emp ? emp : undefined;
			const r = await saveMonthDtr(hotelId, month.data, employeeId);
			await writeAudit({
				hotelId,
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
		requireCap(event.locals.user, event.locals.role, 'dtr:*');
		try {
			const hotelId = event.locals.hotel!.id;
			const parsed = addTimeSchema.safeParse(Object.fromEntries(await event.request.formData()));
			if (!parsed.success) throw new DtrImportError(parsed.error.issues[0]!.message);
			const emp = (await listEmployees(hotelId)).find((e) => e.id === parsed.data.employeeId);
			if (!emp?.biometricEnrollId) throw new DtrImportError('That employee has no Biometric ID yet.');
			const p = await addManualPunch(
				hotelId,
				{
					enrollId: emp.biometricEnrollId,
					date: parsed.data.date,
					time: parsed.data.time,
					note: parsed.data.note
				},
				event.locals.user?.id ?? null
			);
			await writeAudit({
				hotelId,
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
	}
};
