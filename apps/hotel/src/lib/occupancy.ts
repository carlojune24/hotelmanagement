import { MAX_ROOMS_PER_LINE } from '$lib/pricing-utils';

/**
 * Client-safe (no DB, no server import) occupancy/extra-bed solver — same reason
 * `pricing-utils.ts` exists separately from `$lib/server/pricing.ts`: this needs to
 * run from both front-desk's walk-in dialog and the guest booking flow's Dates step,
 * neither of which can import `$lib/server/*` at runtime.
 *
 * A single shared decision: does a party of `occupancy` guests fit in `roomCount`
 * rooms of a type, and if not, does adding extra beds (up to the type's own limit)
 * cover it, and if *that* still isn't enough, how many rooms would.
 */

export interface RoomTypeOccupancyPolicy {
	/** Guests one room holds with no extra bed. */
	maxOccupancy: number;
	extraBedAllowed: boolean;
	/** Extra beds allowed *per room* of this type. */
	maxExtraBeds: number;
	/** Additional guests one extra bed accommodates — usually 1. */
	extraBedCapacity: number;
}

export interface OccupancyPlan {
	/** Fits on base occupancy alone — no extra bed needed. */
	fitsBase: boolean;
	/** True if the party fits at all (on base occupancy, or with extra beds within the type's limit). */
	fits: boolean;
	/** Extra beds needed across `roomCount` rooms — 0 when `fitsBase`, meaningless when `!fits`. */
	extraBedsNeeded: number;
	/** Smallest room count above the one asked for that would fit the party on base
	 *  occupancy alone (no extra bed needed) — offered whether or not extra beds
	 *  already solved it, since adding a room is also how a guest sheds an extra bed
	 *  they'd rather not have. Null if no room count up to `maxRoomCount` would help,
	 *  or if the current room count already fits without needing to suggest more. */
	suggestedRoomCount: number | null;
	/** Set only when the party doesn't fit even with the maximum extra beds allowed. */
	blockingReason: string | null;
}

/** Works out whether `occupancy` guests fit in `roomCount` rooms of a type, and what
 *  to offer (extra beds, or more rooms) when they don't fit on base occupancy alone. */
export function resolveOccupancyPlan(
	policy: RoomTypeOccupancyPolicy,
	occupancy: number,
	roomCount: number,
	maxRoomCount: number = MAX_ROOMS_PER_LINE
): OccupancyPlan {
	const baseCapacity = policy.maxOccupancy * roomCount;

	const suggestedRoomCount = (() => {
		if (occupancy <= baseCapacity) return null; // already fits without adding a room
		for (let rc = roomCount + 1; rc <= maxRoomCount; rc++) {
			if (policy.maxOccupancy * rc >= occupancy) return rc;
		}
		return null;
	})();

	if (occupancy <= baseCapacity) {
		return { fitsBase: true, fits: true, extraBedsNeeded: 0, suggestedRoomCount: null, blockingReason: null };
	}

	const shortfall = occupancy - baseCapacity;
	const perBedCapacity = Math.max(policy.extraBedCapacity, 1);
	const maxBedsTotal = policy.extraBedAllowed ? Math.max(policy.maxExtraBeds, 0) * roomCount : 0;
	const extraBedsNeeded = Math.ceil(shortfall / perBedCapacity);
	const fitsWithExtraBeds = policy.extraBedAllowed && extraBedsNeeded <= maxBedsTotal;

	if (fitsWithExtraBeds) {
		return {
			fitsBase: false,
			fits: true,
			extraBedsNeeded,
			suggestedRoomCount,
			blockingReason: null
		};
	}

	return {
		fitsBase: false,
		fits: false,
		extraBedsNeeded: 0,
		suggestedRoomCount,
		blockingReason: suggestedRoomCount
			? `Doesn't fit even with extra beds — try ${suggestedRoomCount} rooms instead.`
			: `This room type can't fit ${occupancy} guests, even with extra beds and more rooms.`
	};
}
