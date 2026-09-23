import { roleCan } from '$lib/server/auth/rbac';
import { getRoomStatusGrid } from '$lib/server/front-desk';
import { getCashPosition } from '$lib/server/finance/cash';
import { revenueBySourceReport } from '$lib/server/finance/reports';
import { listShifts } from '$lib/server/finance/shifts';
import { getDayCloseStatus, hotelUsesDayClose } from '$lib/server/finance/dayclose';
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

	const [grid, cash, collected, shifts, usesDayClose, yesterdayClose, pendingDamage] =
		await Promise.all([
			canRooms
				? getRoomStatusGrid(hotel.id, today, hotel.checkOutTime, hotel.timezone, hotel.checkInTime)
				: null,
			canFinance ? getCashPosition(hotel.id) : null,
			canFinance ? revenueBySourceReport(hotel.id, monthStart, today) : null,
			canFinance ? listShifts(hotel.id, 100) : null,
			canDayClose ? hotelUsesDayClose(hotel.id) : false,
			canDayClose ? getDayCloseStatus(hotel.id, yesterday) : null,
			canSeeDamage ? countPendingDamageReports(hotel.id) : null
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
			openShifts: shifts ? shifts.filter((s) => s.status === 'open').length : null,
			// Only nag about day close for a hotel that actually runs it.
			yesterdayNotClosed: usesDayClose && yesterdayClose ? !yesterdayClose.closed : false,
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
