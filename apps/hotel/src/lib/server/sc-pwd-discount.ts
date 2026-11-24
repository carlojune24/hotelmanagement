import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { db } from './db/index';
import {
	birSettings,
	bookingRooms,
	bookings,
	folioCharges,
	folios,
	ratePlans,
	scPwdDiscounts,
	type ScPwdDiscount
} from './db/schema/index';
import { writeAudit } from './audit';
import type { SessionUser } from './auth/session';
import { ensureFolio, voidFolioCharge } from './folio';
import { computeScPwdShare, roomChargeOptions, type ScPwdChargeOption } from '$lib/sc-pwd-discount';
import type { Tx } from './finance/shared';

// Reads/writes `bir_settings.sc_pwd_discount_bps` directly (not `finance/documents.ts`'s
// `getBirSettings`/`upsertBirSettings`) to avoid a module cycle — `documents.ts`'s
// `buildInvoiceSnapshot` needs this module's `getActiveScPwdClaim`, so this module can't
// import back from `documents.ts`. Also kept deliberately separate from the rest of BIR
// Setup's form (the "Discounts" field lives on the Hotel details card in Finance Settings
// instead) — the `onConflictDoUpdate` below only ever touches this one column, so saving it
// never resets any other `bir_settings` field, and vice versa.
export async function getScPwdDiscountBps(hotelId: string, exec: Pick<typeof db, 'select'> = db): Promise<number> {
	const [row] = await exec
		.select({ scPwdDiscountBps: birSettings.scPwdDiscountBps })
		.from(birSettings)
		.where(eq(birSettings.hotelId, hotelId))
		.limit(1);
	return row?.scPwdDiscountBps ?? 2000;
}

export async function setScPwdDiscountBps(
	hotelId: string,
	discountBps: number,
	actor: SessionUser | null
): Promise<void> {
	const clamped = Math.min(10000, Math.max(0, Math.round(discountBps)));
	await db
		.insert(birSettings)
		.values({ hotelId, scPwdDiscountBps: clamped })
		.onConflictDoUpdate({
			target: birSettings.hotelId,
			set: { scPwdDiscountBps: clamped, updatedAt: new Date() }
		});
	await writeAudit({
		hotelId,
		actor,
		action: 'sc_pwd.update_rate',
		entityType: 'hotel',
		entityId: hotelId,
		after: { scPwdDiscountBps: clamped }
	});
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

export interface ScPwdClaimant {
	type: ScPwdClaimantType;
	name: string;
	idNumber: string;
}

export interface ApplyScPwdDiscountInput {
	hotelId: string;
	bookingId: string;
	/** One per qualifying guest in the room. */
	claimants: ScPwdClaimant[];
	/** Everyone staying in the room; null = the booking's own guest count. */
	guestCount: number | null;
	/** Keys from `loadScPwdOptions` to cover; null = the defaults (room nights only). */
	chargeKeys: string[] | null;
	actor: SessionUser | null;
}

/** Reads the SC/PWD fields posted by `sc-pwd-fields.svelte`: `scPwdClaimants` (JSON),
 *  `scPwdGuests` and one `scPwdCharge` per ticked charge (`scPwdChargesSent` marks that the
 *  list was shown, so an empty list means "none ticked", not "use the defaults"). */
export function parseScPwdForm(form: FormData): Pick<ApplyScPwdDiscountInput, 'claimants' | 'guestCount' | 'chargeKeys'> {
	let raw: unknown = [];
	try {
		raw = JSON.parse(String(form.get('scPwdClaimants') ?? '[]'));
	} catch {
		raw = [];
	}
	const claimants = (Array.isArray(raw) ? raw : []).slice(0, 20).map((c) => ({
		type: (c?.type === 'pwd' ? 'pwd' : 'senior_citizen') as ScPwdClaimantType,
		name: String(c?.name ?? '').slice(0, 160),
		idNumber: String(c?.idNumber ?? '').slice(0, 60)
	}));
	const guests = Math.floor(Number(form.get('scPwdGuests')));
	return {
		claimants,
		guestCount: Number.isFinite(guests) && guests > 0 ? guests : null,
		chargeKeys: form.has('scPwdChargesSent') ? form.getAll('scPwdCharge').map(String) : null
	};
}

type Exec = Pick<typeof db, 'select'>;

/** What the SC/PWD discount can cover on a room booking: its room nights (per head), its extra
 *  bed, and any other live positive charge on its folio (the claimant's own, in full). Amounts
 *  come from the booking/folio here, never from the form. `promoCentavos` is the booking's promo
 *  discount, which SC/PWD replaces rather than stacks on. */
export async function loadScPwdOptions(
	hotelId: string,
	bookingId: string,
	exec: Exec = db
): Promise<{ options: ScPwdChargeOption[]; guestCount: number; promoCentavos: number; discountBps: number } | null> {
	const [b] = await exec.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
	if (!b || b.hotelId !== hotelId) return null;
	const beds = await exec
		.select({ n: bookingRooms.extraBeds, fee: ratePlans.extraBedFeeCentavos })
		.from(bookingRooms)
		.innerJoin(ratePlans, eq(ratePlans.id, bookingRooms.ratePlanId))
		.where(eq(bookingRooms.bookingId, bookingId));
	// shortcut: priced at the rate plan's current per-bed fee (the booking keeps fees as one sum),
	// capped at the booking's fees in roomChargeOptions; store the bed fee on the booking if rates drift.
	const extraBedCentavos = beds.reduce((s, r) => s + r.n * (r.fee ?? 0), 0);
	const options = roomChargeOptions({
		subtotalCentavos: b.subtotalCentavos,
		feesCentavos: b.feesCentavos,
		vatCentavos: b.vatCentavos,
		extraBedCentavos
	});
	const charges = await exec
		.select({
			id: folioCharges.id,
			description: folioCharges.description,
			total: folioCharges.totalCentavos,
			tax: folioCharges.taxCentavos
		})
		.from(folioCharges)
		.innerJoin(folios, eq(folios.id, folioCharges.folioId))
		.where(
			and(
				eq(folios.bookingId, bookingId),
				eq(folios.hotelId, hotelId),
				eq(folioCharges.isBaseCharge, false),
				isNull(folioCharges.voidedAt),
				gt(folioCharges.totalCentavos, 0)
			)
		)
		.orderBy(asc(folioCharges.createdAt));
	for (const c of charges) {
		options.push({
			key: `charge:${c.id}`,
			label: c.description,
			amountCentavos: c.total,
			vatCentavos: c.tax,
			perHead: false,
			defaultOn: false
		});
	}
	return {
		options,
		guestCount: b.occupancy,
		promoCentavos: b.discountCentavos ?? 0,
		discountBps: await getScPwdDiscountBps(hotelId, exec)
	};
}

/**
 * Flags a room booking as a qualifying Senior Citizen / PWD sale: the qualifying guests' share of
 * the chosen charges becomes VAT-exempt and gets the % off (see `lib/sc-pwd-discount.ts`'s
 * `computeScPwdShare`), posted as one negative folio line. A promo and SC/PWD don't stack — the
 * guest gets the lower price: if the promo is lower this refuses; if SC/PWD is lower the promo's
 * amount is added back on its own line. Negative lines go in by direct insert, like
 * `cancellation.ts`'s write-offs (`addAdHocCharge` rejects them). Check-in callers treat failures
 * as best-effort.
 */
export async function applyScPwdDiscount(
	input: ApplyScPwdDiscountInput
): Promise<{ scPwdDiscountId: string }> {
	const { scPwdDiscountId, totalReductionCentavos, discountBps } = await db.transaction((tx: Tx) =>
		applyScPwdDiscountTx(tx, input)
	);
	await auditScPwdApply(input, scPwdDiscountId, discountBps, totalReductionCentavos);
	return { scPwdDiscountId };
}

/** Audit entry for an applied discount — call after the transaction that applied it commits. */
export async function auditScPwdApply(
	input: Pick<ApplyScPwdDiscountInput, 'hotelId' | 'bookingId' | 'claimants' | 'guestCount' | 'actor'>,
	scPwdDiscountId: string,
	discountBps: number,
	totalReductionCentavos: number
) {
	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: 'sc_pwd.apply',
		entityType: 'booking',
		entityId: input.bookingId,
		after: {
			scPwdDiscountId,
			claimants: input.claimants.map((c) => ({ type: c.type, idNumber: c.idNumber })),
			guestCount: input.guestCount,
			discountBps,
			totalReductionCentavos
		}
	});
}

const peso = (c: number) =>
	`₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The same discount inside the caller's transaction — a walk-in applies it to the booking it just
 *  created, so the guest pays the discounted amount instead of being refunded afterwards. The caller
 *  audits via `auditScPwdApply` once the transaction commits. */
export async function applyScPwdDiscountTx(
	tx: Tx,
	input: ApplyScPwdDiscountInput
): Promise<{ scPwdDiscountId: string; totalReductionCentavos: number; discountBps: number }> {
	const claimants = input.claimants.map((c) => ({
		type: c.type,
		name: c.name.trim(),
		idNumber: c.idNumber.trim()
	}));
	if (claimants.length === 0) throw new ScPwdDiscountError('Add at least one Senior Citizen/PWD guest.');
	for (const c of claimants) {
		if (!c.name) throw new ScPwdDiscountError("Enter each Senior/PWD guest's name.");
		if (!c.idNumber) throw new ScPwdDiscountError(`Enter the OSCA/PWD ID number for ${c.name}.`);
	}

	const [booking] = await tx.select().from(bookings).where(eq(bookings.id, input.bookingId)).limit(1);
	if (!booking || booking.hotelId !== input.hotelId) {
		throw new ScPwdDiscountError('Booking not found.');
	}
	if (booking.status !== 'confirmed' && booking.status !== 'checked_in') {
		throw new ScPwdDiscountError('Only a confirmed or checked-in booking can carry this discount.');
	}

	const [existing] = await tx
		.select({ id: scPwdDiscounts.id })
		.from(scPwdDiscounts)
		.where(and(eq(scPwdDiscounts.bookingId, input.bookingId), isNull(scPwdDiscounts.reversedAt)))
		.limit(1);
	if (existing) {
		throw new ScPwdDiscountError('A Senior Citizen/PWD discount is already applied to this booking.');
	}

	// On `tx`, not `db`: a second pooled connection inside a transaction can deadlock the pool.
	const loaded = await loadScPwdOptions(input.hotelId, input.bookingId, tx);
	if (!loaded) throw new ScPwdDiscountError('Booking not found.');
	const { discountBps } = loaded;
	const picked = loaded.options.filter((o) =>
		input.chargeKeys ? input.chargeKeys.includes(o.key) : o.defaultOn
	);
	if (picked.length === 0) throw new ScPwdDiscountError('Tick at least one charge the discount covers.');
	const guestCount = input.guestCount ?? loaded.guestCount;
	if (guestCount < claimants.length) {
		throw new ScPwdDiscountError(
			`Guests in the room (${guestCount}) can't be fewer than the Senior/PWD guests (${claimants.length}).`
		);
	}

	const calc = computeScPwdShare({ lines: picked, claimants: claimants.length, guests: guestCount, discountBps });
	const promo = loaded.promoCentavos;
	if (promo > 0 && calc.totalReductionCentavos <= promo) {
		throw new ScPwdDiscountError(
			`The promo already gives a lower price (${peso(promo)} off vs ${peso(calc.totalReductionCentavos)} for Senior/PWD). They can't be combined, so the promo stays.`
		);
	}

	const pctLabel = (discountBps / 100).toFixed(discountBps % 100 === 0 ? 0 : 2);
	const who = claimants.map((c) => `${CLAIMANT_TYPE_LABEL[c.type]} ${c.name}, ID ${c.idNumber}`).join('; ');
	const folioId = await ensureFolio(tx, input.hotelId, { kind: 'room', bookingId: input.bookingId });
	const actorId = input.actor?.id ?? null;

	let promoDroppedChargeId: string | null = null;
	if (promo > 0) {
		const [c] = await tx
			.insert(folioCharges)
			.values({
				folioId,
				description: "Promo removed: Senior/PWD discount is the lower price (they can't be combined)",
				quantity: 1,
				unitPriceCentavos: promo,
				taxCentavos: 0,
				totalCentavos: promo,
				source: 'sc_pwd',
				addedByUserId: actorId
			})
			.returning({ id: folioCharges.id });
		promoDroppedChargeId = c!.id;
	}

	let folioChargeId: string | null = null;
	if (calc.totalReductionCentavos > 0) {
		const [charge] = await tx
			.insert(folioCharges)
			.values({
				folioId,
				description: `SC/PWD discount (${pctLabel}%, ${claimants.length} of ${guestCount} guests) — ${who}`,
				quantity: 1,
				unitPriceCentavos: -calc.totalReductionCentavos,
				taxCentavos: 0,
				totalCentavos: -calc.totalReductionCentavos,
				source: 'sc_pwd',
				addedByUserId: actorId
			})
			.returning({ id: folioCharges.id });
		folioChargeId = charge!.id;
	}

	const [row] = await tx
		.insert(scPwdDiscounts)
		.values({
			hotelId: input.hotelId,
			bookingId: input.bookingId,
			claimantType: claimants[0]!.type,
			claimantName: claimants[0]!.name,
			idNumber: claimants[0]!.idNumber,
			claimants,
			guestCount,
			lines: calc.lines,
			discountBps,
			baseAmountCentavos: calc.baseAmountCentavos,
			vatRemovedCentavos: calc.vatRemovedCentavos,
			discountCentavos: calc.discountCentavos,
			folioChargeId,
			promoDroppedChargeId,
			appliedByUserId: actorId
		})
		.returning({ id: scPwdDiscounts.id });

	// Net effect on the folio: promo added back, SC/PWD taken off.
	return {
		scPwdDiscountId: row!.id,
		totalReductionCentavos: calc.totalReductionCentavos - promo,
		discountBps
	};
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

	for (const chargeId of [claim.folioChargeId, claim.promoDroppedChargeId]) {
		if (!chargeId) continue;
		await voidFolioCharge(
			hotelId,
			{ kind: 'room', bookingId },
			chargeId,
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
