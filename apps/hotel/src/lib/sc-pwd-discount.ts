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
