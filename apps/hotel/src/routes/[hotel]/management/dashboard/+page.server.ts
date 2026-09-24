import { roleCan } from '$lib/server/auth/rbac';
import { getRoomStatusGrid } from '$lib/server/front-desk';
import { getCashPosition } from '$lib/server/finance/cash';
import { revenueBySourceReport } from '$lib/server/finance/reports';
import { listOpenShiftAlerts } from '$lib/server/finance/shifts';
import { listUnresolvedDays } from '$lib/server/finance/dayclose';
import { cashLedgerTieOut } from '$lib/server/finance/tieout';
import { db } from '$lib/server/db/index';
import { businessDateFor } from '$lib/server/finance/shared';
import { countPendingDamageReports } from '$lib/server/housekeeping';
import { addDays } from '$lib/finance-range';
import { summarizeRooms } from '$lib/room-summary';
import type { PageServerLoad } from './$types';

/**
 * The post-login landing page: today's rooms, money at a glance, and what needs doing —
 * every figure already computed elsewhere (front-desk grid, Finance), just gathered here.
 * Each section is loaded only when the viewer's role may see it, and left out otherwise.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const hotel = locals.hotel!;
	const can = (cap: string) =>
		(locals.user?.isPlatformAdmin ?? false) ||
		(locals.role ? roleCan(locals.role.capabilities, cap) : false);

	const canRooms = can('booking:read') || can('room:read');
	const canFinance = can('finance:read');
	const canDayClose = can('dayclose:run');
	const canChargeDamage = can('booking:write');
	const canSeeDamage = canChargeDamage || can('housekeeping:read');

	const today = businessDateFor(hotel.timezone);
	const yesterday = addDays(today, -1);
	const monthStart = `${today.slice(0, 8)}01`;

	// The Trial balance page (where the reasons are) needs `reports:read`, so only nag those who can open it.
	const canSeeLedgerHealth = can('reports:read');

	const [grid, cash, collected, shifts, unclosedDays, pendingDamage, ledgerTieOut] =
		await Promise.all([
			canRooms
				? getRoomStatusGrid(hotel.id, today, hotel.checkOutTime, hotel.timezone, hotel.checkInTime)
				: null,
			canFinance ? getCashPosition(hotel.id) : null,
			canFinance ? revenueBySourceReport(hotel.id, monthStart, today) : null,
			canFinance ? listOpenShiftAlerts(hotel.id) : null,
			// Empty for a hotel that has never closed a day, so it isn't nagged about days it doesn't run.
			canDayClose ? listUnresolvedDays(hotel.id, today) : [],
			canSeeDamage ? countPendingDamageReports(hotel.id) : null,
			canSeeLedgerHealth ? cashLedgerTieOut(db, hotel.id) : null
		]);

	return {
		today,
		yesterday,
		monthStart,
		rooms: grid
			? {
					total: grid.cells.length,
					arrivals: grid.arrivals.length,
					departures: grid.departures.length,
					overdue: grid.departures.filter((d) => d.checkOut < today).length,
					...summarizeRooms(grid.cells)
				}
			: null,
		money:
			cash && collected
				? {
						cashOnHandCentavos: cash.reduce((s, a) => s + a.closingCentavos, 0),
						collectedThisMonthCentavos: collected.totalCentavos
					}
				: null,
		attention: {
			openShifts: shifts ? shifts.length : null,
			// Overdue = open past the hotel's stale-shift threshold; oldest first, so index 0 is the worst.
			staleShifts: shifts ? shifts.filter((s) => s.stale).length : null,
			oldestStaleHours: shifts?.find((s) => s.stale)?.hoursOpen ?? null,
			// Earlier days still to close (or missing their Z), oldest first — the oldest is what
			// blocks every later close, so it's the one named.
			unclosedDays,
			// Cash accounts whose stored balance disagrees with the ledger (0 when all tie out, or the
			// viewer can't open the Trial balance page that explains why).
			ledgerMismatches: ledgerTieOut ? ledgerTieOut.filter((t) => !t.ok).length : 0,
			pendingDamage,
			damageHref: canChargeDamage ? 'front-desk' : 'housekeeping'
		},
		// Housekeeping sees the Rooms board via `room:read` but can't open front desk.
		roomsHref: can('booking:read') ? 'front-desk' : 'housekeeping',
		// Room/rate setup lives under Settings, which is hotel-admin only.
		canSetup: can('hotel:admin'),
		canHr: can('hr:read')
	};
};
