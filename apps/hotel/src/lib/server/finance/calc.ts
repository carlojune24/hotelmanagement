/**
 * Pure money/date helpers for the Finance module — no database, no side effects,
 * so they can be unit-tested in isolation and reused wherever needed.
 */

/** VAT-inclusive input-VAT portion of a gross amount: `gross * rate / (10000 + rate)`
 *  (e.g. 1200 bps → `gross * 12 / 112`). */
export function inputVatOf(grossCentavos: number, vatRateBps: number): number {
	if (vatRateBps <= 0) return 0;
	return Math.round((grossCentavos * vatRateBps) / (10_000 + vatRateBps));
}

/** Expected physical cash in a drawer at shift close. */
export function expectedShiftCash(
	openingFloatCentavos: number,
	cashInCentavos: number,
	cashOutCentavos: number
): number {
	return openingFloatCentavos + cashInCentavos - cashOutCentavos;
}

/** Whole hours a shift has been open, and whether that outlives the hotel's overdue
 *  threshold. Hours (not a date change) because an overnight shift legitimately crosses midnight. */
export function shiftAge(openedAt: Date, now: Date, staleAfterHours: number) {
	const hoursOpen = Math.max(0, Math.floor((now.getTime() - openedAt.getTime()) / 3_600_000));
	return { hoursOpen, stale: hoursOpen >= staleAfterHours };
}

/** A shift closed by someone other than the person who opened it must say why — the count
 *  still happens and the variance stays with the opener. An unknown opener (deleted user) can't
 *  be closed "on behalf of" anyone. */
export function isClosedOnBehalf(openerId: string | null, closerId: string | null | undefined) {
	return !!openerId && openerId !== closerId;
}

/** Drawer cash that landed on a business date other than the one the shift opened on — an
 *  overnight shift's after-midnight takings. Those belong to *that* day's Z-reading, not the
 *  opening day's, so the shift page calls them out. Oldest date first; empty for a same-day shift. */
export function cashOnOtherDays(
	movements: { businessDate: string; direction: string; amountCentavos: number }[],
	shiftBusinessDate: string
): { businessDate: string; cashInCentavos: number; cashOutCentavos: number }[] {
	const byDate = new Map<string, { cashInCentavos: number; cashOutCentavos: number }>();
	for (const m of movements) {
		if (m.businessDate === shiftBusinessDate) continue;
		const cur = byDate.get(m.businessDate) ?? { cashInCentavos: 0, cashOutCentavos: 0 };
		if (m.direction === 'in') cur.cashInCentavos += m.amountCentavos;
		else cur.cashOutCentavos += m.amountCentavos;
		byDate.set(m.businessDate, cur);
	}
	return [...byDate.entries()]
		.map(([businessDate, v]) => ({ businessDate, ...v }))
		.sort((a, b) => a.businessDate.localeCompare(b.businessDate));
}

/** Journal lines that put a cash account's opening balance on the books: debit the cash
 *  account's ledger account, credit Owner's Equity (the reverse for a negative — overdrawn —
 *  opening). Empty for zero: nothing to post. */
export function openingBalanceLines(
	cashLedgerAccountId: string,
	equityAccountId: string,
	openingCentavos: number
): { accountId: string; debitCentavos: number; creditCentavos: number }[] {
	if (openingCentavos === 0) return [];
	const amount = Math.abs(openingCentavos);
	const cash = openingCentavos > 0 ? { debitCentavos: amount, creditCentavos: 0 } : { debitCentavos: 0, creditCentavos: amount };
	const equity = openingCentavos > 0 ? { debitCentavos: 0, creditCentavos: amount } : { debitCentavos: amount, creditCentavos: 0 };
	return [
		{ accountId: cashLedgerAccountId, ...cash },
		{ accountId: equityAccountId, ...equity }
	];
}

/** One cash account's balance measured three independent ways — see `explainTieOut`. */
export interface TieOutInput {
	openingCentavos: number;
	/** `cash_accounts.current_balance_centavos` — the denormalized running total. */
	storedCentavos: number;
	/** Debits − credits on the account's chart-of-accounts leaf. */
	ledgerCentavos: number;
	/** Net of every live (non-voided) cash movement on the account: in − out. */
	movementNetCentavos: number;
	/** The part of `movementNetCentavos` whose movements never got a journal entry. */
	unpostedNetCentavos: number;
	/** The account has no chart-of-accounts link, so nothing can post to the ledger. */
	noCoaLink: boolean;
}

const peso = (c: number) =>
	`₱${(Math.abs(c) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Why a cash account's stored balance and its ledger balance disagree — or `[]` when they tie.
 *
 *  Three numbers must agree: the stored running balance, `opening + live movements`, and the
 *  ledger. So there are two independent ways to be wrong, and naming which one keeps a mismatch
 *  from being a shrug:
 *   - **drift** = stored − (opening + movements): the stored balance no longer matches its own
 *     movements (rows edited or deleted by hand, or a code path that skipped `recordCashMovement`).
 *   - **ledger gap** = (opening + movements) − ledger: the ledger is missing money the movements
 *     have — movements never posted, an opening balance never posted, or (negative) money still in
 *     the ledger that no live movement explains, e.g. a void that never got its reversing entry. */
export function explainTieOut(r: TieOutInput): string[] {
	const reasons: string[] = [];
	if (r.noCoaLink) reasons.push('Not linked to a chart-of-accounts account, so nothing posts to the ledger.');

	const drift = r.storedCentavos - (r.openingCentavos + r.movementNetCentavos);
	if (drift !== 0) {
		reasons.push(
			`Stored balance is ${peso(drift)} ${drift > 0 ? 'above' : 'below'} what its own movements add up to — rows edited or deleted by hand, or a change that bypassed the cash choke point.`
		);
	}

	const ledgerGap = r.openingCentavos + r.movementNetCentavos - r.ledgerCentavos;
	let residual = ledgerGap;
	if (r.unpostedNetCentavos !== 0) {
		reasons.push(`${peso(r.unpostedNetCentavos)} of movements have no journal entry (posted before the ledger existed, or never posted).`);
		residual -= r.unpostedNetCentavos;
	}
	if (residual !== 0 && residual === r.openingCentavos) {
		reasons.push(`The ${peso(r.openingCentavos)} opening balance isn't in the ledger yet.`);
		residual = 0;
	}
	if (residual !== 0) {
		reasons.push(
			`${peso(residual)} ${residual > 0 ? 'missing from' : 'extra in'} the ledger that no live movement explains — e.g. a voided movement whose reversal was never posted.`
		);
	}
	return reasons;
}

export type UnresolvedDay = { businessDate: string; kind: 'unclosed' | 'no_z' };

/** Business dates before `before` that must be finished before a later day may be closed, oldest
 *  first. Z-reading numbers come from a per-hotel counter in issue order, so closing day N+1
 *  while day N is still open would hand N+1 the lower number — BIR wants them in date order.
 *
 *  A day is "unresolved" when it has activity (or a close row) but is not closed (`unclosed`,
 *  which includes a reopened day nobody re-closed), or is closed but its Z-reading never got
 *  issued (`no_z`, since Z issuance at close is non-fatal). Days before `anchor` — the hotel's
 *  first-ever close — pre-date day close and never block; a hotel that never closed has no anchor.
 *  A dark day (no movements, no shifts, never closed) doesn't need closing. */
export function findUnresolvedDays(input: {
	anchor: string | null;
	before: string;
	/** Dates with cash movements or cashier shifts. */
	activityDates: string[];
	/** Dates with a live (not reopened) close. */
	closedDates: string[];
	/** Dates that have at least one Z-reading. */
	zDates: string[];
}): UnresolvedDay[] {
	if (!input.anchor) return [];
	const closed = new Set(input.closedDates);
	const withZ = new Set(input.zDates);
	const candidates = new Set([...input.activityDates, ...input.closedDates]);
	const out: UnresolvedDay[] = [];
	for (const d of [...candidates].sort()) {
		if (d < input.anchor || d >= input.before) continue;
		if (!closed.has(d)) out.push({ businessDate: d, kind: 'unclosed' });
		else if (!withZ.has(d)) out.push({ businessDate: d, kind: 'no_z' });
	}
	return out;
}

/** Why closing `target` is refused while `day` is unresolved — names the day holding it up. */
export function unresolvedDayMessage(day: UnresolvedDay, target: string): string {
	return day.kind === 'unclosed'
		? `Close ${day.businessDate} first — days are closed in order so the Z-reading numbers follow the calendar.`
		: `${day.businessDate} is closed but has no Z-reading yet. Issue it (Finance → BIR → Readings) before closing ${target}, so the Z-reading numbers stay in date order.`;
}

/** Change owed on a cash tender (never negative — caller rejects a short tender). */
export function changeFor(tenderedCentavos: number, amountCentavos: number): number {
	return Math.max(0, tenderedCentavos - amountCentavos);
}

/** Advance a recurring template's due date by its cadence, pinning monthly-ish
 *  cadences to `anchorDay` (clamped to the target month's length). */
export function advanceDueDate(dateStr: string, cadence: string, anchorDay: number): string {
	const d = new Date(`${dateStr}T00:00:00Z`);
	if (cadence === 'weekly') {
		d.setUTCDate(d.getUTCDate() + 7);
		return d.toISOString().slice(0, 10);
	}
	const step = cadence === 'quarterly' ? 3 : cadence === 'annually' ? 12 : 1;
	// Compute the target month explicitly so a short month can't spill into the next
	// one before the anchor-day clamp runs.
	const targetMonthIndex = d.getUTCMonth() + step;
	const year = d.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
	const month = ((targetMonthIndex % 12) + 12) % 12;
	const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	const day = Math.min(Math.max(1, anchorDay), lastDay);
	return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** RFC-4180-ish CSV from a header row + rows of scalars. */
export function toCsv(headers: (string | number)[], rows: (string | number)[][]): string {
	const esc = (v: string | number) => {
		const s = String(v ?? '');
		return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
}
