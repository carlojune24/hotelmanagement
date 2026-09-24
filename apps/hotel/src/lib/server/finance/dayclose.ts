import { and, asc, desc, eq, gte, lt, min, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '../db/index';
import { cashMovements, cashierShifts, dayCloses, hotels, zReadings } from '../db/schema/index';
import { writeAudit } from '../audit';
import type { SessionUser } from '../auth/session';
import { FinanceError, businessDateFor, currentTimeOfDayFor } from './shared';
import { findUnresolvedDays, unresolvedDayMessage, type UnresolvedDay } from './calc';
import { getFinanceSettings } from './settings';

/** Aggregates for `businessDate` used both in the day-close snapshot and the
 *  dashboard's "today" tiles. Reads only non-voided `cash_movements`. */
export async function daySnapshot(hotelId: string, businessDate: string) {
	const rows = await db
		.select({
			direction: cashMovements.direction,
			category: cashMovements.category,
			amountCentavos: cashMovements.amountCentavos
		})
		.from(cashMovements)
		.where(
			and(
				eq(cashMovements.hotelId, hotelId),
				eq(cashMovements.businessDate, businessDate),
				sql`${cashMovements.voidedAt} is null`
			)
		);

	let cashIn = 0;
	let cashOut = 0;
	const byCategory: Record<string, number> = {};
	for (const r of rows) {
		if (r.direction === 'in') cashIn += r.amountCentavos;
		else cashOut += r.amountCentavos;
		const key = `${r.direction}:${r.category}`;
		byCategory[key] = (byCategory[key] ?? 0) + r.amountCentavos;
	}

	const revenueCats = new Set([
		'room_revenue',
		'hall_revenue',
		'incidental_sale',
		'other_revenue',
		'deposit'
	]);
	let grossRevenue = 0;
	for (const r of rows)
		if (r.direction === 'in' && revenueCats.has(r.category)) grossRevenue += r.amountCentavos;

	return {
		businessDate,
		cashInCentavos: cashIn,
		cashOutCentavos: cashOut,
		netCentavos: cashIn - cashOut,
		grossRevenueCentavos: grossRevenue,
		byCategory
	};
}

export async function getDayCloseStatus(hotelId: string, businessDate: string) {
	const [row] = await db
		.select()
		.from(dayCloses)
		.where(and(eq(dayCloses.hotelId, hotelId), eq(dayCloses.businessDate, businessDate)))
		.limit(1);
	return {
		closed: !!row && !row.reopenedAt,
		everClosed: !!row,
		reopened: !!row?.reopenedAt,
		row: row ?? null
	};
}

/** Earlier business dates (before `before`) that still have to be closed — or, if closed, have
 *  their Z-reading issued — oldest first. See `findUnresolvedDays` for why order matters.
 *
 *  Empty for a hotel that has never closed a day: one that doesn't run day close at all
 *  shouldn't be nagged, or blocked, over days it never closed. */
export async function listUnresolvedDays(hotelId: string, before: string): Promise<UnresolvedDay[]> {
	const [anchorRow] = await db
		.select({ anchor: min(dayCloses.businessDate) })
		.from(dayCloses)
		.where(eq(dayCloses.hotelId, hotelId));
	const anchor = anchorRow?.anchor ?? null;
	if (!anchor) return [];

	const inRange = (col: AnyPgColumn) => and(gte(col, anchor), lt(col, before));
	const [moves, shifts, closes, zs] = await Promise.all([
		db
			.selectDistinct({ d: cashMovements.businessDate })
			.from(cashMovements)
			.where(
				and(
					eq(cashMovements.hotelId, hotelId),
					sql`${cashMovements.voidedAt} is null`,
					inRange(cashMovements.businessDate)
				)
			),
		db
			.selectDistinct({ d: cashierShifts.businessDate })
			.from(cashierShifts)
			.where(and(eq(cashierShifts.hotelId, hotelId), inRange(cashierShifts.businessDate))),
		db
			.select({ d: dayCloses.businessDate, reopenedAt: dayCloses.reopenedAt })
			.from(dayCloses)
			.where(and(eq(dayCloses.hotelId, hotelId), inRange(dayCloses.businessDate)))
			.orderBy(asc(dayCloses.businessDate)),
		db
			.selectDistinct({ d: zReadings.businessDate })
			.from(zReadings)
			.where(eq(zReadings.hotelId, hotelId))
	]);

	return findUnresolvedDays({
		anchor,
		before,
		activityDates: [...moves, ...shifts].map((r) => r.d),
		closedDates: closes.filter((c) => !c.reopenedAt).map((c) => c.d),
		zDates: zs.map((r) => r.d)
	});
}

export async function runDayClose(
	hotelId: string,
	businessDate: string,
	actor: SessionUser | null
): Promise<void> {
	const status = await getDayCloseStatus(hotelId, businessDate);
	if (status.closed) throw new FinanceError(`${businessDate} is already closed.`);

	// Days are closed oldest-first: the Z-reading counter is issued in call order, so closing a
	// later day first would give it the lower number.
	const [holdingUp] = await listUnresolvedDays(hotelId, businessDate);
	if (holdingUp) throw new FinanceError(unresolvedDayMessage(holdingUp, businessDate));

	// Safety cutoff: only meaningful for *today's* business date — a past date's
	// cutoff time has, by definition, already passed, so this never blocks closing
	// yesterday (or catching up on an older backlog) regardless of the clock now.
	const [hotel] = await db
		.select({ timezone: hotels.timezone })
		.from(hotels)
		.where(eq(hotels.id, hotelId))
		.limit(1);
	const timezone = hotel?.timezone ?? 'Asia/Manila';
	if (businessDate === businessDateFor(timezone)) {
		const { dayCloseCutoffTime } = await getFinanceSettings(hotelId);
		if (dayCloseCutoffTime && currentTimeOfDayFor(timezone) < dayCloseCutoffTime) {
			throw new FinanceError(
				`${businessDate} can't be closed before ${dayCloseCutoffTime} yet.`
			);
		}
	}

	const openShifts = await db
		.select({ id: cashierShifts.id })
		.from(cashierShifts)
		.where(
			and(
				eq(cashierShifts.hotelId, hotelId),
				eq(cashierShifts.businessDate, businessDate),
				eq(cashierShifts.status, 'open')
			)
		);
	if (openShifts.length > 0) {
		throw new FinanceError(
			`Close all ${openShifts.length} open cashier shift(s) for ${businessDate} first.`
		);
	}

	const snapshot = await daySnapshot(hotelId, businessDate);
	const shiftRows = await db
		.select({ id: cashierShifts.id, varianceCentavos: cashierShifts.varianceCentavos })
		.from(cashierShifts)
		.where(and(eq(cashierShifts.hotelId, hotelId), eq(cashierShifts.businessDate, businessDate)));
	const totalVariance = shiftRows.reduce((s, r) => s + (r.varianceCentavos ?? 0), 0);

	let dayCloseId: string | null = null;
	if (status.everClosed) {
		// Re-closing a previously reopened day.
		const [row] = await db
			.update(dayCloses)
			.set({
				closedByUserId: actor?.id ?? null,
				closedAt: new Date(),
				totals: { ...snapshot, shiftCount: shiftRows.length, shiftVarianceCentavos: totalVariance },
				reopenedByUserId: null,
				reopenedAt: null
			})
			.where(and(eq(dayCloses.hotelId, hotelId), eq(dayCloses.businessDate, businessDate)))
			.returning({ id: dayCloses.id });
		dayCloseId = row?.id ?? null;
	} else {
		const [row] = await db
			.insert(dayCloses)
			.values({
				hotelId,
				businessDate,
				closedByUserId: actor?.id ?? null,
				totals: { ...snapshot, shiftCount: shiftRows.length, shiftVarianceCentavos: totalVariance }
			})
			.returning({ id: dayCloses.id });
		dayCloseId = row?.id ?? null;
	}

	// Lock the day's sales into a Z-reading (next per-hotel counter, running grand
	// total). Re-closing a reopened day issues a fresh Z — BIR keeps every one.
	// Non-fatal: the day is closed regardless; the Z can be regenerated from the
	// Readings tab if this fails.
	try {
		const { issueZReading } = await import('./readings');
		await issueZReading(hotelId, businessDate, dayCloseId, actor);
	} catch (e) {
		console.error('runDayClose: could not issue Z-reading', businessDate, e);
	}

	await writeAudit({
		hotelId,
		actor,
		action: 'finance.day_close',
		entityType: 'day_close',
		entityId: businessDate,
		after: { netCentavos: snapshot.netCentavos, shiftVarianceCentavos: totalVariance }
	});
}

export async function reopenDayClose(
	hotelId: string,
	businessDate: string,
	actor: SessionUser | null
): Promise<void> {
	const status = await getDayCloseStatus(hotelId, businessDate);
	if (!status.closed) throw new FinanceError(`${businessDate} is not closed.`);
	await db
		.update(dayCloses)
		.set({ reopenedByUserId: actor?.id ?? null, reopenedAt: new Date() })
		.where(and(eq(dayCloses.hotelId, hotelId), eq(dayCloses.businessDate, businessDate)));
	await writeAudit({
		hotelId,
		actor,
		action: 'finance.day_reopen',
		entityType: 'day_close',
		entityId: businessDate
	});
}

export async function listDayCloses(hotelId: string, limit = 60) {
	return db
		.select()
		.from(dayCloses)
		.where(eq(dayCloses.hotelId, hotelId))
		.orderBy(desc(dayCloses.businessDate))
		.limit(limit);
}
