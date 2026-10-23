import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import {
	employeeAssignments,
	employees,
	leaveAdjustments,
	leaveRequests,
	leaveTypes,
	users
} from '$lib/server/db/schema/index';
import { balanceFor, listLeaveTypes } from './leave';

export type CardEntry = {
	kind: 'leave' | 'adjustment';
	/** Start date (leave) or the day the adjustment was entered. */
	date: string;
	endDate: string | null;
	halfDay: 'am' | 'pm' | null;
	particulars: string;
	/** Days taken (leave) or added/removed (adjustment, signed). */
	days: number;
	paid: boolean | null;
	/** 'approved' | 'submitted' (still waiting). */
	status: string;
	approvedBy: string | null;
	balance: number;
};

export type CardBlock = {
	type: { id: string; code: string; name: string; daysPerYear: number };
	entitled: number;
	carried: number;
	adjusted: number;
	used: number;
	remaining: number;
	entries: CardEntry[];
};

export type LeaveCard = {
	year: number;
	employee: { id: string; name: string; no: string; position: string; hiredOn: string; status: string };
	blocks: CardBlock[];
};

/**
 * One employee's leave card for a year: per leave type the grant (entitled + carried over + adjustments),
 * then every approved or waiting request and adjustment in date order with the running balance, which ends
 * at the same `remaining` the Balances tab shows. Information only; nothing here writes.
 */
export async function leaveCard(establishmentId: string, employeeId: string, year: number): Promise<LeaveCard | null> {
	const [emp] = await db
		.select({
			id: employees.id,
			first: employees.firstName,
			last: employees.lastName,
			no: employees.employeeNo,
			hiredOn: employees.hiredOn,
			status: employees.status
		})
		.from(employees)
		.where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)));
	if (!emp) return null;

	const [assignment] = await db
		.select({ position: employeeAssignments.position })
		.from(employeeAssignments)
		.where(and(eq(employeeAssignments.employeeId, employeeId), eq(employeeAssignments.establishmentId, establishmentId)))
		.orderBy(sql`${employeeAssignments.startDate} desc`)
		.limit(1);

	const from = `${year}-01-01`;
	const to = `${year}-12-31`;
	const [types, requests, adjustments] = await Promise.all([
		listLeaveTypes(establishmentId).then((t) => t.filter((x) => x.active)),
		db
			.select()
			.from(leaveRequests)
			.where(
				and(
					eq(leaveRequests.establishmentId, establishmentId),
					eq(leaveRequests.employeeId, employeeId),
					inArray(leaveRequests.status, ['approved', 'submitted']),
					gte(leaveRequests.startDate, from),
					lte(leaveRequests.startDate, to)
				)
			)
			.orderBy(asc(leaveRequests.startDate)),
		db
			.select()
			.from(leaveAdjustments)
			.where(
				and(
					eq(leaveAdjustments.establishmentId, establishmentId),
					eq(leaveAdjustments.employeeId, employeeId),
					eq(leaveAdjustments.year, year)
				)
			)
			.orderBy(asc(leaveAdjustments.createdAt))
	]);

	// Names of whoever approved (or, for on-the-spot approvals, filed) each request.
	const ids = [...new Set(requests.flatMap((r) => [r.decidedByUserId, r.filedByUserId]).filter((x): x is string => !!x))];
	const people = ids.length
		? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))
		: [];
	const nameOf = new Map(people.map((p) => [p.id, p.name]));

	const blocks: CardBlock[] = [];
	for (const t of types) {
		const b = await balanceFor(establishmentId, employeeId, t, year);
		const mine = requests.filter((r) => r.leaveTypeId === t.id);
		const adj = adjustments.filter((a) => a.leaveTypeId === t.id);
		// Nothing granted and nothing taken: not worth a block on the card.
		if (t.daysPerYear === 0 && b.carried === 0 && mine.length === 0 && adj.length === 0) continue;

		const entries: Omit<CardEntry, 'balance'>[] = [
			...mine.map((r) => ({
				kind: 'leave' as const,
				date: r.startDate,
				endDate: r.endDate !== r.startDate ? r.endDate : null,
				halfDay: (r.halfDay as 'am' | 'pm' | null) ?? null,
				particulars: r.reason?.trim() || t.name,
				days: r.days,
				paid: r.paid,
				status: r.status,
				approvedBy: r.status === 'approved' ? (nameOf.get(r.decidedByUserId ?? r.filedByUserId ?? '') ?? null) : null
			})),
			...adj.map((a) => ({
				kind: 'adjustment' as const,
				date: a.createdAt.toISOString().slice(0, 10),
				endDate: null,
				halfDay: null,
				particulars: `Adjustment: ${a.reason}`,
				days: a.days,
				paid: null,
				status: 'approved',
				approvedBy: null
			}))
		].sort((x, y) => x.date.localeCompare(y.date) || (x.kind === 'adjustment' ? -1 : 1));

		// Running balance, starting from the grant before adjustments (which arrive as entries).
		let running = b.entitled + b.carried;
		blocks.push({
			type: { id: t.id, code: t.code, name: t.name, daysPerYear: t.daysPerYear },
			...b,
			entries: entries.map((e) => {
				running += e.kind === 'adjustment' ? e.days : -e.days;
				return { ...e, balance: Math.round(running * 100) / 100 };
			})
		});
	}

	return {
		year,
		employee: {
			id: emp.id,
			name: `${emp.last}, ${emp.first}`,
			no: emp.no,
			position: assignment?.position ?? '',
			hiredOn: emp.hiredOn,
			status: emp.status
		},
		blocks
	};
}

/** One leave request with who filed and decided it, and the type's balance before and after it. */
export async function leaveForm(establishmentId: string, requestId: string) {
	const [r] = await db
		.select({
			req: leaveRequests,
			typeName: leaveTypes.name,
			typeCode: leaveTypes.code
		})
		.from(leaveRequests)
		.innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
		.where(and(eq(leaveRequests.id, requestId), eq(leaveRequests.establishmentId, establishmentId)));
	if (!r) return null;

	const ids = [r.req.filedByUserId, r.req.decidedByUserId].filter((x): x is string => !!x);
	const people = ids.length
		? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))
		: [];
	const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;

	const year = Number(r.req.startDate.slice(0, 4));
	const card = await leaveCard(establishmentId, r.req.employeeId, year);
	const block = card?.blocks.find((b) => b.type.id === r.req.leaveTypeId) ?? null;
	// A request that counts (approved or waiting) is already inside the running balance.
	const counts = r.req.status === 'approved' || r.req.status === 'submitted';
	const after = block ? block.remaining : null;
	const before = after === null ? null : counts ? Math.round((after + r.req.days) * 100) / 100 : after;

	return {
		request: r.req,
		typeName: r.typeName,
		typeCode: r.typeCode,
		filedBy: nameOf(r.req.filedByUserId),
		decidedBy: nameOf(r.req.decidedByUserId),
		employee: card?.employee ?? null,
		before,
		after
	};
}
