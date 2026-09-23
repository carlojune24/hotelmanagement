import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from './db/index';
import {
	birSettings,
	bookings,
	folioCharges,
	scPwdDiscounts,
	type ScPwdDiscount
} from './db/schema/index';
import { writeAudit } from './audit';
import type { SessionUser } from './auth/session';
import { ensureFolio, voidFolioCharge } from './folio';
import { computeScPwdDiscount } from '$lib/sc-pwd-discount';
import type { Tx } from './finance/shared';

// Reads `bir_settings` directly (not `finance/documents.ts`'s `getBirSettings`) to avoid a
// module cycle — `documents.ts`'s `buildInvoiceSnapshot` needs this module's
// `getActiveScPwdClaim`, so this module can't import back from `documents.ts`.
async function scPwdDiscountBpsFor(hotelId: string): Promise<number> {
	const [row] = await db
		.select({ scPwdDiscountBps: birSettings.scPwdDiscountBps })
		.from(birSettings)
		.where(eq(birSettings.hotelId, hotelId))
		.limit(1);
	return row?.scPwdDiscountBps ?? 2000;
}

export class ScPwdDiscountError extends Error {}

export type ScPwdClaimantType = 'senior_citizen' | 'pwd';

const CLAIMANT_TYPE_LABEL: Record<ScPwdClaimantType, string> = {
	senior_citizen: 'Senior Citizen',
	pwd: 'PWD'
};

/** The active (never reversed) claim for a booking, or null if none. At most one active
 *  claim per booking (`sc_pwd_discounts_one_active_per_booking_idx`) — a correction is
 *  reverse-then-reapply, never an in-place edit. */
export async function getActiveScPwdClaim(
	hotelId: string,
	bookingId: string
): Promise<ScPwdDiscount | null> {
	const [row] = await db
		.select()
		.from(scPwdDiscounts)
		.where(
			and(
				eq(scPwdDiscounts.hotelId, hotelId),
				eq(scPwdDiscounts.bookingId, bookingId),
				isNull(scPwdDiscounts.reversedAt)
			)
		)
		.limit(1);
	return row ?? null;
}

/** Batched: the active claim of many bookings at once, for the front-desk occupant panel. */
export async function getActiveScPwdClaimsForBookings(
	bookingIds: string[]
): Promise<Map<string, ScPwdDiscount>> {
	const map = new Map<string, ScPwdDiscount>();
	const ids = [...new Set(bookingIds)];
	if (ids.length === 0) return map;
	const rows = await db
		.select()
		.from(scPwdDiscounts)
		.where(and(inArray(scPwdDiscounts.bookingId, ids), isNull(scPwdDiscounts.reversedAt)));
	for (const r of rows) map.set(r.bookingId, r);
	return map;
}

export interface ApplyScPwdDiscountInput {
	hotelId: string;
	bookingId: string;
	claimantType: ScPwdClaimantType;
	claimantName: string;
	idNumber: string;
	actor: SessionUser | null;
}

/**
 * Flags a room booking's base charge as a qualifying Senior Citizen / PWD sale and posts the
 * reduction to its folio in one negative charge line — see `lib/sc-pwd-discount.ts` for the
 * legal mechanics (the whole base charge becomes VAT-exempt, not just 20% off). Mirrors the
 * negative-charge precedent already used by `cancellation.ts`'s write-off lines: posted via a
 * direct `tx.insert(folioCharges)`, not `addAdHocCharge` (which rejects non-positive amounts).
 * Never blocks check-in when called from it — callers treat failures as best-effort.
 */
export async function applyScPwdDiscount(
	input: ApplyScPwdDiscountInput
): Promise<{ scPwdDiscountId: string }> {
	const claimantName = input.claimantName.trim();
	const idNumber = input.idNumber.trim();
	if (!claimantName) throw new ScPwdDiscountError("Enter the claimant's name.");
	if (!idNumber) throw new ScPwdDiscountError('Enter the OSCA/PWD ID number.');

	const [booking] = await db
		.select()
		.from(bookings)
		.where(eq(bookings.id, input.bookingId))
		.limit(1);
	if (!booking || booking.hotelId !== input.hotelId) {
		throw new ScPwdDiscountError('Booking not found.');
	}
	if (booking.status !== 'confirmed' && booking.status !== 'checked_in') {
		throw new ScPwdDiscountError('Only a confirmed or checked-in booking can carry this discount.');
	}

	const existing = await getActiveScPwdClaim(input.hotelId, input.bookingId);
	if (existing) {
		throw new ScPwdDiscountError('A Senior Citizen/PWD discount is already applied to this booking.');
	}

	const discountBps = await scPwdDiscountBpsFor(input.hotelId);
	const calc = computeScPwdDiscount({
		subtotalCentavos: booking.subtotalCentavos,
		feesCentavos: booking.feesCentavos,
		vatCentavos: booking.vatCentavos,
		discountBps
	});

	const pctLabel = (discountBps / 100).toFixed(discountBps % 100 === 0 ? 0 : 2);
	const typeLabel = CLAIMANT_TYPE_LABEL[input.claimantType];

	const scPwdDiscountId = await db.transaction(async (tx: Tx) => {
		const folioId = await ensureFolio(tx, input.hotelId, { kind: 'room', bookingId: input.bookingId });

		let folioChargeId: string | null = null;
		if (calc.totalReductionCentavos > 0) {
			const [charge] = await tx
				.insert(folioCharges)
				.values({
					folioId,
					description: `SC/PWD discount (${pctLabel}%) — ${typeLabel}, ID ${idNumber} — ${claimantName}`,
					quantity: 1,
					unitPriceCentavos: -calc.totalReductionCentavos,
					taxCentavos: 0,
					totalCentavos: -calc.totalReductionCentavos,
					addedByUserId: input.actor?.id ?? null
				})
				.returning({ id: folioCharges.id });
			folioChargeId = charge!.id;
		}

		const [row] = await tx
			.insert(scPwdDiscounts)
			.values({
				hotelId: input.hotelId,
				bookingId: input.bookingId,
				claimantType: input.claimantType,
				claimantName,
				idNumber,
				discountBps,
				baseAmountCentavos: calc.baseAmountCentavos,
				vatRemovedCentavos: calc.vatRemovedCentavos,
				discountCentavos: calc.discountCentavos,
				folioChargeId,
				appliedByUserId: input.actor?.id ?? null
			})
			.returning({ id: scPwdDiscounts.id });
		return row!.id;
	});

	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: 'sc_pwd.apply',
		entityType: 'booking',
		entityId: input.bookingId,
		after: {
			scPwdDiscountId,
			claimantType: input.claimantType,
			discountBps,
			totalReductionCentavos: calc.totalReductionCentavos
		}
	});

	return { scPwdDiscountId };
}

/** Undoes an active claim — voids its folio charge (never `isBaseCharge`, so `voidFolioCharge`
 *  needs no change) and marks the claim row reversed. The correction path for a mis-typed ID
 *  or a wrongly-flagged guest; also how a post-discount stay modification is handled — reverse
 *  then reapply recomputes against the booking's now-current totals. */
export async function reverseScPwdDiscount(
	hotelId: string,
	bookingId: string,
	reason: string | null,
	actor: SessionUser | null
): Promise<void> {
	const claim = await getActiveScPwdClaim(hotelId, bookingId);
	if (!claim) throw new ScPwdDiscountError('No active Senior Citizen/PWD discount on this booking.');

	if (claim.folioChargeId) {
		await voidFolioCharge(
			hotelId,
			{ kind: 'room', bookingId },
			claim.folioChargeId,
			reason?.trim() || 'SC/PWD discount reversed',
			actor
		);
	}

	await db
		.update(scPwdDiscounts)
		.set({
			reversedAt: new Date(),
			reversedByUserId: actor?.id ?? null,
			reversedReason: reason?.trim() || null,
			updatedAt: new Date()
		})
		.where(eq(scPwdDiscounts.id, claim.id));

	await writeAudit({
		hotelId,
		actor,
		action: 'sc_pwd.reverse',
		entityType: 'booking',
		entityId: bookingId,
		after: { scPwdDiscountId: claim.id, reason: reason || null }
	});
}
