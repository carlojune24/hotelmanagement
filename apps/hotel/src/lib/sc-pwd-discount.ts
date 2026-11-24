/**
 * BIR Senior Citizen (RA 9994) / PWD (RA 10754) discount math. A qualifying sale isn't just
 * "20% off" — the whole base charge becomes VAT-exempt, and the discount itself is computed
 * on the VAT-exclusive amount:
 *
 *   baseAmount = subtotal + fees (pre-VAT)
 *   vatRemoved = the VAT that would have applied — zeroed out, the sale is now exempt
 *   discount   = round(baseAmount * discountBps / 10000)
 *
 * The folio is reduced by `vatRemoved + discount` in one line — see
 * `lib/server/sc-pwd-discount.ts`'s `applyScPwdDiscount`.
 */
export interface ScPwdDiscountInput {
	subtotalCentavos: number;
	feesCentavos: number;
	vatCentavos: number;
	discountBps: number;
}

export interface ScPwdDiscountResult {
	baseAmountCentavos: number;
	vatRemovedCentavos: number;
	discountCentavos: number;
	totalReductionCentavos: number;
}

export function computeScPwdDiscount(input: ScPwdDiscountInput): ScPwdDiscountResult {
	const baseAmountCentavos = input.subtotalCentavos + input.feesCentavos;
	const vatRemovedCentavos = input.vatCentavos;
	const discountCentavos = Math.round((baseAmountCentavos * input.discountBps) / 10000);
	return {
		baseAmountCentavos,
		vatRemovedCentavos,
		discountCentavos,
		totalReductionCentavos: vatRemovedCentavos + discountCentavos
	};
}

/**
 * Per-head SC/PWD discount on chosen charges (RA 9994 / RR 7-2010, RA 10754). Room nights are
 * shared by everyone in the room, so only the qualifying guests' share (claimants ÷ guests) is
 * VAT-exempt and discounted; the rest stays a regular VATable sale. A charge that is the
 * claimant's own (their extra bed, food they ate) counts in full. Same math as dining
 * (`lib/dining-discount.ts`), so both give the same centavos.
 */
export interface ScPwdChargeOption {
	/** 'room', 'extra_bed' (both parts of the folio's base charge) or 'charge:<folio charge id>'. */
	key: string;
	label: string;
	/** VAT-inclusive. */
	amountCentavos: number;
	/** The VAT inside `amountCentavos`. */
	vatCentavos: number;
	/** True: split by headcount. False: the claimant's own, counted in full. */
	perHead: boolean;
	/** Ticked when the form opens. */
	defaultOn: boolean;
}

export interface ScPwdShareLine {
	key: string;
	label: string;
	perHead: boolean;
	amountCentavos: number;
	vatCentavos: number;
	/** The qualifying share of `amountCentavos`, VAT-inclusive, before the discount. */
	shareCentavos: number;
	/** The VAT inside that share, removed because the share is VAT-exempt. */
	shareVatCentavos: number;
}

export interface ScPwdShareResult {
	lines: ScPwdShareLine[];
	shareCentavos: number;
	/** VAT-exclusive share: the VAT-exempt sale the discount is worked out on. */
	baseAmountCentavos: number;
	vatRemovedCentavos: number;
	discountCentavos: number;
	totalReductionCentavos: number;
}

export function computeScPwdShare(input: {
	lines: Pick<ScPwdChargeOption, 'key' | 'label' | 'amountCentavos' | 'vatCentavos' | 'perHead'>[];
	claimants: number;
	guests: number;
	discountBps: number;
}): ScPwdShareResult {
	const guests = Math.max(1, Math.floor(input.guests));
	const n = Math.min(Math.max(0, Math.floor(input.claimants)), guests);
	const lines = input.lines.map((l) => ({
		key: l.key,
		label: l.label,
		perHead: l.perHead,
		amountCentavos: l.amountCentavos,
		vatCentavos: l.vatCentavos,
		shareCentavos: l.perHead ? Math.round((l.amountCentavos * n) / guests) : n > 0 ? l.amountCentavos : 0,
		shareVatCentavos: l.perHead ? Math.round((l.vatCentavos * n) / guests) : n > 0 ? l.vatCentavos : 0
	}));
	const shareCentavos = lines.reduce((s, l) => s + l.shareCentavos, 0);
	const vatRemovedCentavos = lines.reduce((s, l) => s + l.shareVatCentavos, 0);
	const baseAmountCentavos = shareCentavos - vatRemovedCentavos;
	const discountCentavos = Math.round((baseAmountCentavos * input.discountBps) / 10000);
	return {
		lines,
		shareCentavos,
		baseAmountCentavos,
		vatRemovedCentavos,
		discountCentavos,
		totalReductionCentavos: vatRemovedCentavos + discountCentavos
	};
}

/**
 * A room booking's base folio charge bundles room nights + fees + VAT. Splits out the parts the
 * SC/PWD discount can cover: room nights (per head, ticked by default) and the extra bed (the
 * claimant's own, unticked). Other fees (service charge etc.) are never offered. VAT is shared
 * out in proportion, since the booking stores it as one figure.
 */
export function roomChargeOptions(b: {
	subtotalCentavos: number;
	feesCentavos: number;
	vatCentavos: number;
	/** Extra beds × the rate plan's per-bed fee; 0 when none. */
	extraBedCentavos: number;
}): ScPwdChargeOption[] {
	const net = b.subtotalCentavos + b.feesCentavos;
	const vatOf = (part: number) => (net > 0 ? Math.round((b.vatCentavos * part) / net) : 0);
	const out: ScPwdChargeOption[] = [
		{
			key: 'room',
			label: 'Room nights',
			amountCentavos: b.subtotalCentavos + vatOf(b.subtotalCentavos),
			vatCentavos: vatOf(b.subtotalCentavos),
			perHead: true,
			defaultOn: true
		}
	];
	const bed = Math.min(b.extraBedCentavos, b.feesCentavos);
	if (bed > 0) {
		out.push({
			key: 'extra_bed',
			label: 'Extra bed (for the Senior/PWD guest)',
			amountCentavos: bed + vatOf(bed),
			vatCentavos: vatOf(bed),
			perHead: false,
			defaultOn: false
		});
	}
	return out;
}
