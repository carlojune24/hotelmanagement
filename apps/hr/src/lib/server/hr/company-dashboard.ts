import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import {
	employeeAssignments,
	employees,
	establishments,
	leaveRequests,
	payrollBatches,
	payrollRunLines,
	payrollRuns,
	schedulePeriods
} from '$lib/server/db/schema/index';
import { addDays } from '$lib/roster';
import { pendingApprovalCount } from './approvals';
import { listBatches } from './bonuses';
import { effectiveCalendar } from './calendar';
import { getHandoff } from './dtr-submissions';
import { listLoans, monthsAfter, scheduleStatus, skipMonthsByLoan } from './loans';
import { getDayFactor } from './payroll';
import { getOverview, getRemittanceSettings } from './remittance';
import { listSeparations } from './separations';
import { contractsDue } from './contracts';

/** One row of the "needs attention" list. Ordered overdue → soon → info. */
export interface AttentionItem {
	key: string;
	tone: 'overdue' | 'soon' | 'info';
	text: string;
	href: string;
}

export interface UpcomingItem {
	date: string;
	label: string;
	href: string;
}

export interface CutoffStep {
	label: string;
	done: number;
	of: number;
	href: string;
}

export interface CompanyDashboard {
	today: string;
	attention: AttentionItem[];
	cutoff: {
		runId: string;
		cutoffStart: string;
		cutoffEnd: string;
		payDate: string;
		steps: CutoffStep[];
		ratesConfirmed: boolean;
	} | null;
	upcoming: UpcomingItem[];
	establishments: Array<{
		id: string;
		name: string;
		slug: string;
		staff: number;
		onLeave: number;
		rosterWaiting: number;
		dtr: 'received' | 'submitted' | 'returned' | 'draft';
		batch: 'none' | 'draft' | 'generated' | 'locked' | 'released';
	}>;
	figures: { headcount: number; onLeaveToday: number; loansOutstanding: number; lastRunNet: number | null };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const peso = (c: number) =>
	new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(c / 100);
const daysBetween = (a: string, b: string) =>
	Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const monthOf = (d: string) => d.slice(0, 7);

/** A cutoff's months as `YYYY-MM`, in order. */
function monthsOfCutoff(start: string, end: string): string[] {
	const out: string[] = [];
	for (let m = monthOf(start); m <= monthOf(end); m = monthsAfter(m, 1)) out.push(m);
	return out;
}

/**
 * Everything Main HR needs to see company-wide on one page. Read-only: it never writes, and a source
 * that has nothing to say contributes no row at all.
 */
export async function getCompanyDashboard(
	organizationId: string,
	today: string,
	opts: { approver: boolean }
): Promise<CompanyDashboard> {
	const attention: AttentionItem[] = [];
	const upcoming: UpcomingItem[] = [];
	const horizon = addDays(today, 30);
	const ests = await db
		.select({ id: establishments.id, name: establishments.name, slug: establishments.slug })
		.from(establishments)
		.where(
			and(eq(establishments.organizationId, organizationId), isNull(establishments.deletedAt), eq(establishments.status, 'active'))
		)
		.orderBy(asc(establishments.name));
	const estIds = ests.map((e) => e.id);

	// ---- approvals
	if (opts.approver) {
		const n = await pendingApprovalCount();
		if (n > 0) attention.push({ key: 'approvals', tone: 'info', text: `${plural(n, 'request')} waiting for your decision`, href: '/approvals' });
	}

	// ---- payroll: the newest run that is not fully released yet
	const runs = await db
		.select()
		.from(payrollRuns)
		.where(eq(payrollRuns.organizationId, organizationId))
		.orderBy(desc(payrollRuns.cutoffStart))
		.limit(6);
	const batchRows = runs.length
		? await db
				.select({ runId: payrollBatches.runId, establishmentId: payrollBatches.establishmentId, status: payrollBatches.status, generatedAt: payrollBatches.generatedAt })
				.from(payrollBatches)
				.where(inArray(payrollBatches.runId, runs.map((r) => r.id)))
		: [];
	const unfinished = runs.find((r) => {
		const mine = batchRows.filter((b) => b.runId === r.id);
		return mine.length === 0 || mine.some((b) => b.status !== 'released');
	});
	let cutoff: CompanyDashboard['cutoff'] = null;
	const batchOf = new Map<string, CompanyDashboard['establishments'][number]['batch']>();
	const monthHandoffs = new Map<string, 'received' | 'submitted' | 'returned' | 'draft'>();
	const handoff = async (estId: string, month: string) => {
		const key = `${estId}|${month}`;
		if (!monthHandoffs.has(key)) {
			const s = (await getHandoff(estId, month)).status;
			monthHandoffs.set(key, s === 'received' || s === 'submitted' || s === 'returned' ? s : 'draft');
		}
		return monthHandoffs.get(key)!;
	};
	if (unfinished) {
		const mine = batchRows.filter((b) => b.runId === unfinished.id);
		const months = monthsOfCutoff(unfinished.cutoffStart, unfinished.cutoffEnd);
		let received = 0;
		for (const e of ests) {
			const all = await Promise.all(months.map((m) => handoff(e.id, m)));
			if (all.every((s) => s === 'received')) received += 1;
		}
		for (const b of mine) {
			batchOf.set(
				b.establishmentId,
				b.status === 'released' ? 'released' : b.status === 'locked' ? 'locked' : b.generatedAt ? 'generated' : 'draft'
			);
		}
		const total = ests.length;
		const generated = mine.filter((b) => b.generatedAt || b.status !== 'draft').length;
		const locked = mine.filter((b) => b.status === 'locked' || b.status === 'released').length;
		const released = mine.filter((b) => b.status === 'released').length;
		const run = `/payroll/${unfinished.id}`;
		cutoff = {
			runId: unfinished.id,
			cutoffStart: unfinished.cutoffStart,
			cutoffEnd: unfinished.cutoffEnd,
			payDate: unfinished.payDate,
			ratesConfirmed: !!unfinished.ratesCheckedAt,
			steps: [
				{ label: 'DTRs received', done: received, of: total, href: '/approvals' },
				{ label: 'Payroll generated', done: generated, of: total, href: run },
				{ label: 'Locked', done: locked, of: total, href: run },
				{ label: 'Released', done: released, of: total, href: run }
			]
		};
		const label = `${unfinished.cutoffStart} → ${unfinished.cutoffEnd}`;
		if (generated > 0 && !unfinished.ratesCheckedAt && locked < total) {
			attention.push({ key: 'rates', tone: 'soon', text: `Confirm the statutory rates for the ${label} run before locking`, href: run });
		}
		if (locked > released && locked === total) {
			attention.push({ key: 'release', tone: 'info', text: `${label}: all batches are locked, ready to release`, href: run });
		}
		if (received < total && unfinished.payDate <= addDays(today, 7)) {
			attention.push({
				key: 'dtr-late',
				tone: unfinished.payDate < today ? 'overdue' : 'soon',
				text: `${plural(total - received, 'establishment')} still to send a DTR for the run paid ${unfinished.payDate}`,
				href: '/approvals'
			});
		}
		if (unfinished.payDate >= today && unfinished.payDate <= horizon) {
			upcoming.push({ date: unfinished.payDate, label: `Pay date · ${label}`, href: run });
		}
	}

	// ---- setup gaps
	const [dayFactor, settings] = await Promise.all([getDayFactor(organizationId), getRemittanceSettings(organizationId)]);
	if (!dayFactor) attention.push({ key: 'factor', tone: 'soon', text: 'Choose the working-day factor so payroll can be created', href: '/settings?tab=payroll' });
	if (Object.values(settings.dueDay).every((d) => d == null)) {
		attention.push({ key: 'due-days', tone: 'info', text: 'No remittance due days are set, so no deadline can be shown', href: '/settings?tab=remittances' });
	}

	// ---- remittances: this month and the two before
	for (const period of [monthOf(today), monthsAfter(monthOf(today), -1), monthsAfter(monthOf(today), -2)]) {
		const o = await getOverview(organizationId, period, today);
		for (const a of o.agencies) {
			if (a.status === 'remitted' || a.amount <= 0 || !a.dueDate) continue;
			const href = `/remittances/${a.agency}/${period}`;
			const left = daysBetween(today, a.dueDate);
			if (left < 0) {
				attention.push({ key: `rem-${a.agency}-${period}`, tone: 'overdue', text: `${a.label} for ${period} was due ${a.dueDate} · ${peso(a.amount)}`, href });
			} else if (left <= 7) {
				attention.push({ key: `rem-${a.agency}-${period}`, tone: 'soon', text: `${a.label} for ${period} is due in ${plural(left, 'day')} · ${peso(a.amount)}`, href });
			}
			if (left >= 0 && a.dueDate <= horizon) upcoming.push({ date: a.dueDate, label: `${a.label} due · ${period}`, href });
		}
	}

	// ---- 13th month: December 24
	const year = Number(today.slice(0, 4));
	const decDue = `${year}-12-24`;
	const daysToDec = daysBetween(today, decDue);
	if (daysToDec <= 60) {
		const issued = new Set(
			(await listBatches(organizationId, year)).filter((b) => b.kind === 'thirteenth_year_end' && b.status === 'issued').map((b) => b.establishmentId)
		);
		const missing = ests.filter((e) => !issued.has(e.id));
		if (missing.length > 0) {
			attention.push({
				key: 'thirteenth',
				tone: daysToDec < 0 ? 'overdue' : daysToDec <= 14 ? 'soon' : 'info',
				text:
					daysToDec < 0
						? `13th month was due ${decDue}; not issued for ${missing.map((e) => e.name).join(', ')}`
						: `13th month is due ${decDue} (${plural(daysToDec, 'day')} left); not issued for ${missing.map((e) => e.name).join(', ')}`,
				href: `/bonuses?year=${year}`
			});
		}
		if (daysToDec >= 0 && daysToDec <= 30) upcoming.push({ date: decDue, label: '13th month pay deadline', href: `/bonuses?year=${year}` });
	}

	// ---- loans (only those still being deducted)
	const live = await listLoans(organizationId, { statuses: ['active', 'paused'] });
	const thisMonth = monthOf(today);
	const skips = await skipMonthsByLoan(live.map((l) => l.id));
	let behindCount = 0;
	let behindAmount = 0;
	let endingSoon = 0;
	for (const l of live) {
		if (l.status !== 'active') continue;
		const s = scheduleStatus({
			principal: l.principalCentavos,
			alreadyPaid: l.alreadyPaidCentavos,
			amortization: l.amortizationCentavos,
			startPeriod: l.startPeriod,
			thisMonth,
			skips: skips.get(l.id) ?? new Set(),
			paidSince: l.deductedCentavos + l.paidOutsideCentavos
		});
		if (s.behind > 0) {
			behindCount += 1;
			behindAmount += s.behind;
		}
		if (s.expectedEnd && s.expectedEnd <= monthsAfter(thisMonth, 2)) endingSoon += 1;
	}
	if (behindCount > 0) {
		attention.push({ key: 'loans-behind', tone: 'soon', text: `${plural(behindCount, 'loan')} behind schedule · ${peso(behindAmount)}`, href: '/loans' });
	}
	const leftOwing = live.filter((l) => l.employeeStatus === 'separated' && l.balanceCentavos > 0);
	if (leftOwing.length > 0) {
		attention.push({
			key: 'loans-separated',
			tone: 'soon',
			text: `${plural(leftOwing.length, 'loan')} belong to employees who left · ${peso(leftOwing.reduce((t, l) => t + l.balanceCentavos, 0))} still owed`,
			href: '/separations'
		});
	}
	if (endingSoon > 0) attention.push({ key: 'loans-ending', tone: 'info', text: `${plural(endingSoon, 'loan')} finishing within 3 months`, href: '/loans' });

	// ---- separations in process
	const seps = (await listSeparations(organizationId)).filter((s) => s.status === 'in_process');
	if (seps.length > 0) {
		const owing = seps.filter((s) => s.stillOwed > 0);
		attention.push({
			key: 'separations',
			tone: 'info',
			text: `${plural(seps.length, 'separation')} in process${owing.length ? `, ${owing.length} with money still owed` : ''}`,
			href: '/separations'
		});
	}

	// ---- contracts and probations ending
	const ending = await contractsDue(organizationId, today, 30);
	if (ending.length > 0) {
		const overdue = ending.filter((c) => c.overdue).length;
		const soon = ending.filter((c) => !c.overdue && c.daysLeft <= 14).length;
		attention.push({
			key: 'contracts',
			tone: overdue > 0 ? 'overdue' : soon > 0 ? 'soon' : 'info',
			text:
				overdue > 0
					? `${plural(overdue, 'contract')} ended and not renewed or replaced${ending.length > overdue ? `, ${ending.length - overdue} more ending within 30 days` : ''}`
					: `${plural(ending.length, 'contract')} or probation ending within 30 days`,
			href: '/contracts'
		});
		for (const c of ending.filter((x) => !x.overdue)) {
			upcoming.push({ date: c.endDate!, label: `${c.employeeName} · ${c.kind.replace('_', '-')} ends`, href: `/contracts/${c.id}` });
		}
	}

	// ---- holidays in the next 30 days
	const holidays = [
		...new Map(
			(await effectiveCalendar(estIds, today, horizon))
				.filter((d) => ['regular_holiday', 'special_holiday', 'local_holiday'].includes(d.kind))
				.map((d) => [`${d.date}|${d.name}`, { date: d.date, name: d.name }])
		).values()
	];
	for (const h of holidays) upcoming.push({ date: h.date, label: `Holiday · ${h.name}`, href: '/reports/attendance' });
	upcoming.sort((a, b) => a.date.localeCompare(b.date));

	// ---- per establishment: staff, who is out today, rosters waiting
	const [staffRows, leaveRows, waiting] = estIds.length
		? await Promise.all([
				db
					.select({ establishmentId: employeeAssignments.establishmentId, n: sql<number>`count(distinct ${employeeAssignments.employeeId})::int` })
					.from(employeeAssignments)
					.innerJoin(employees, eq(employees.id, employeeAssignments.employeeId))
					.where(
						and(
							inArray(employeeAssignments.establishmentId, estIds),
							lte(employeeAssignments.startDate, today),
							sql`(${employeeAssignments.endDate} is null or ${employeeAssignments.endDate} >= ${today})`,
							isNull(employees.deletedAt),
							sql`${employees.status} <> 'separated'`
						)
					)
					.groupBy(employeeAssignments.establishmentId),
				db
					.select({ establishmentId: leaveRequests.establishmentId, n: sql<number>`count(distinct ${leaveRequests.employeeId})::int` })
					.from(leaveRequests)
					.where(
						and(
							inArray(leaveRequests.establishmentId, estIds),
							eq(leaveRequests.status, 'approved'),
							lte(leaveRequests.startDate, today),
							gte(leaveRequests.endDate, today)
						)
					)
					.groupBy(leaveRequests.establishmentId),
				db
					.select({ establishmentId: schedulePeriods.establishmentId, n: sql<number>`count(*)::int` })
					.from(schedulePeriods)
					.where(and(inArray(schedulePeriods.establishmentId, estIds), eq(schedulePeriods.status, 'submitted')))
					.groupBy(schedulePeriods.establishmentId)
			])
		: [[], [], []];
	const staffOf = new Map(staffRows.map((r) => [r.establishmentId, r.n]));
	const leaveOf = new Map(leaveRows.map((r) => [r.establishmentId, r.n]));
	const waitOf = new Map(waiting.map((r) => [r.establishmentId, r.n]));
	const dtrMonth = monthOf(today);
	const establishmentsOut: CompanyDashboard['establishments'] = [];
	for (const e of ests) {
		establishmentsOut.push({
			id: e.id,
			name: e.name,
			slug: e.slug,
			staff: staffOf.get(e.id) ?? 0,
			onLeave: leaveOf.get(e.id) ?? 0,
			rosterWaiting: waitOf.get(e.id) ?? 0,
			dtr: await handoff(e.id, dtrMonth),
			batch: batchOf.get(e.id) ?? 'none'
		});
	}

	// ---- a few quiet figures
	const headcountRow = estIds.length
		? await db
				.select({ n: sql<number>`count(distinct ${employeeAssignments.employeeId})::int` })
				.from(employeeAssignments)
				.innerJoin(employees, eq(employees.id, employeeAssignments.employeeId))
				.where(
					and(
						inArray(employeeAssignments.establishmentId, estIds),
						lte(employeeAssignments.startDate, today),
						sql`(${employeeAssignments.endDate} is null or ${employeeAssignments.endDate} >= ${today})`,
						isNull(employees.deletedAt),
						sql`${employees.status} <> 'separated'`
					)
				)
		: [];
	let lastRunNet: number | null = null;
	const finished = runs.find((r) => batchRows.some((b) => b.runId === r.id && (b.status === 'locked' || b.status === 'released')));
	if (finished) {
		const [row] = await db
			.select({ net: sql<number>`coalesce(sum(${payrollRunLines.netPayCentavos}), 0)::bigint` })
			.from(payrollRunLines)
			.innerJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
			.where(and(eq(payrollRunLines.runId, finished.id), inArray(payrollBatches.status, ['locked', 'released'])));
		lastRunNet = Number(row?.net ?? 0);
	}
	const order = { overdue: 0, soon: 1, info: 2 } as const;
	attention.sort((a, b) => order[a.tone] - order[b.tone]);

	return {
		today,
		attention,
		cutoff,
		upcoming,
		establishments: establishmentsOut,
		figures: {
			headcount: headcountRow[0]?.n ?? 0,
			onLeaveToday: leaveRows.reduce((t, r) => t + r.n, 0),
			loansOutstanding: live.reduce((t, l) => t + l.balanceCentavos, 0),
			lastRunNet
		}
	};
}
