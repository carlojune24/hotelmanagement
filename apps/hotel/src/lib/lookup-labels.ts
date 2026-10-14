/** What kind of thing a typed number turned out to be. Shared by the lookup server code and its page. */
export type LookupKind =
	| 'booking'
	| 'payment_ref'
	| 'deposit_ref'
	| 'dining_order'
	| 'dining_payment_ref'
	| 'dining_reservation'
	| 'document';

export const KIND_LABEL: Record<LookupKind, string> = {
	booking: 'Booking',
	payment_ref: 'Payment reference',
	deposit_ref: 'Security deposit reference',
	dining_order: 'Dining order',
	dining_payment_ref: 'Dining payment reference',
	dining_reservation: 'Table reservation',
	document: 'Receipt / invoice'
};
