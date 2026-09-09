import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/index';
import { cashAccounts, financeSettings, type FinanceSettings } from '../db/schema/index';
import { writeAudit } from '../audit';
import type { SessionUser } from '../auth/session';

export const DEFAULT_FINANCE_SETTINGS = {
	defaultDrawerAccountId: null as string | null,
	defaultBankAccountId: null as string | null,
	undepositedAccountId: null as string | null,
	autoPostOnlinePayments: true,
	requireExpenseApproval: true,
	lockOnDayClose: true,
	requireOpenShiftForCashPayment: true
};

export type ResolvedFinanceSettings = typeof DEFAULT_FINANCE_SETTINGS;

/** The hotel's finance settings, falling back to the defaults above when the row
 *  doesn't exist yet (a hotel that has never opened the Finance settings page). */
export async function getFinanceSettings(hotelId: string): Promise<ResolvedFinanceSettings> {
	const [row] = await db
		.select()
		.from(financeSettings)
		.where(eq(financeSettings.hotelId, hotelId))
		.limit(1);
	if (!row) return { ...DEFAULT_FINANCE_SETTINGS };
	return {
		defaultDrawerAccountId: row.defaultDrawerAccountId,
		defaultBankAccountId: row.defaultBankAccountId,
		undepositedAccountId: row.undepositedAccountId,
		autoPostOnlinePayments: row.autoPostOnlinePayments,
		requireExpenseApproval: row.requireExpenseApproval,
		lockOnDayClose: row.lockOnDayClose,
		requireOpenShiftForCashPayment: row.requireOpenShiftForCashPayment
	};
}

/** Creates the settings row on first touch, pointing the default-account fields at
 *  whatever seeded accounts exist (drawer → first `cash_drawer`, bank → first `bank`,
 *  undeposited → the `undeposited` system account). Idempotent. */
export async function ensureFinanceSettings(hotelId: string): Promise<FinanceSettings> {
	const [existing] = await db
		.select()
		.from(financeSettings)
		.where(eq(financeSettings.hotelId, hotelId))
		.limit(1);
	if (existing) return existing;

	const accounts = await db
		.select()
		.from(cashAccounts)
		.where(and(eq(cashAccounts.hotelId, hotelId), eq(cashAccounts.isActive, true)))
		.orderBy(asc(cashAccounts.sortOrder));
	const byKind = (k: string) => accounts.find((a) => a.kind === k)?.id ?? null;

	const [row] = await db
		.insert(financeSettings)
		.values({
			hotelId,
			defaultDrawerAccountId: byKind('cash_drawer'),
			defaultBankAccountId: byKind('bank'),
			undepositedAccountId: byKind('undeposited')
		})
		.onConflictDoNothing()
		.returning();
	if (row) return row;
	const [again] = await db
		.select()
		.from(financeSettings)
		.where(eq(financeSettings.hotelId, hotelId))
		.limit(1);
	return again!;
}

export async function updateFinanceSettings(
	hotelId: string,
	patch: Partial<Omit<FinanceSettings, 'hotelId' | 'createdAt' | 'updatedAt'>>,
	actor: SessionUser | null
): Promise<void> {
	await ensureFinanceSettings(hotelId);
	await db
		.update(financeSettings)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(financeSettings.hotelId, hotelId));
	await writeAudit({
		hotelId,
		actor,
		action: 'finance.update_settings',
		entityType: 'finance_settings',
		entityId: hotelId,
		after: patch
	});
}
