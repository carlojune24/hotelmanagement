import { computeScPwdDiscount } from './sc-pwd-discount';

/**
 * Dining discounts taken at settle. Shared by the server (which applies them) and the Settle dialog
 * (which previews them), so both get the same centavos. Always worked out per order, then summed.
 *
 * - `sc_pwd`: Senior Citizen / PWD (RA 9994 / RA 10754). Only the qualifying diners' share of the
 *   order (`claimants` of `diners`) gets it: that share's VAT is removed (it becomes VAT-exempt) and
 *   the % is taken off the share's VAT-exclusive amount. See `lib/sc-pwd-discount.ts`.
 * - `staff`: a plain % off the whole order; the VAT inside it shrinks with it.
 */
export type DiningDiscountKind = 'sc_pwd' | 'staff';

export interface DiningClaimant {
	/** Same values as the hotel's `sc_pwd_claimant_type`. Older rows have none (reported as "Senior / PWD"). */
	type?: 'senior_citizen' | 'pwd';
	name: string;
	/** OSCA ID (senior) or PWD ID number. */
	idNumber: string;
}

export interface DiningDiscountResult {
	discountCentavos: number;
	vatRemovedCentavos: number;
	/** What the guest pays for the order now, VAT included. */
	netCentavos: number;
	/** The VAT still inside `netCentavos`. */
	netVatCentavos: number;
	/** SC/PWD only: the qualifying share's VAT-exclusive amount after the discount, a VAT-exempt sale. */
	vatExemptCentavos: number;
	/** SC/PWD only: the qualifying guests' share of the order before the discount, VAT included
	 *  (total × guests ÷ diners). Only this part is discounted. */
	shareCentavos: number;
}

export function computeDiningDiscount(
	order: { totalCentavos: number; vatCentavos: number },
	kind: DiningDiscountKind,
	bps: number,
	claimants = 1,
	diners = 1
): DiningDiscountResult {
	const total = order.totalCentavos;
	const vat = order.vatCentavos;
	if (kind === 'staff') {
		const discountCentavos = Math.round((total * bps) / 10000);
		const netCentavos = total - discountCentavos;
		const netVatCentavos = total > 0 ? Math.round((vat * netCentavos) / total) : 0;
		return { discountCentavos, vatRemovedCentavos: 0, netCentavos, netVatCentavos, vatExemptCentavos: 0, shareCentavos: 0 };
	}
	const n = Math.min(Math.max(claimants, 0), diners);
	const shareGross = Math.round((total * n) / diners);
	const shareVat = Math.round((vat * n) / diners);
	const r = computeScPwdDiscount({ subtotalCentavos: shareGross - shareVat, feesCentavos: 0, vatCentavos: shareVat, discountBps: bps });
	return {
		discountCentavos: r.discountCentavos,
		vatRemovedCentavos: r.vatRemovedCentavos,
		netCentavos: total - r.totalReductionCentavos,
		netVatCentavos: vat - shareVat,
		vatExemptCentavos: r.baseAmountCentavos - r.discountCentavos,
		shareCentavos: shareGross
	};
}
