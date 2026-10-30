/**
 * Plain-language wording for audit entries, shared by the Audit log page, the dining trail and
 * the printed reports. Pure (no database), so the browser and the server read entries the same way.
 */

// The events an owner actually asks about get a plain-language label. Everything else falls back
// to a humanized version of its raw action string, which still reads fine
// (e.g. "finance.void_expense" becomes "Void expense").
export const ACTION_LABELS: Record<string, string> = {
	'booking.walk_in': 'Booked a walk-in room',
	'booking.ota': 'Keyed in an OTA booking',
	'booking.ota_cancel': 'Cancelled an OTA booking',
	'booking.ota_no_show': 'Marked an OTA booking no-show',
	'ota_channel.add': 'Added an OTA',
	'ota_channel.rename': 'Renamed an OTA',
	'ota_channel.turn_on': 'Turned an OTA on',
	'ota_channel.turn_off': 'Turned an OTA off',
	'hall_booking.walk_in': 'Booked a walk-in function hall',
	'payment.paymongo_confirmed': 'Guest paid online (PayMongo)',
	'booking.check_in': 'Checked in',
	'booking.id_photo_captured': 'Captured guest ID photo',
	'booking.check_out': 'Checked out',
	'booking.cancel': 'Cancelled a room booking',
	'hall_booking.cancel': 'Cancelled a hall booking',
	'booking.no_show': 'Marked as no-show',
	'booking.modify_stay': 'Modified stay dates',
	'booking.reinstate': 'Reinstated a booking',
	'hall_booking.reinstate': 'Reinstated a hall booking',
	'booking.order_expired': 'Order expired — hold released',
	'order.manual_confirm': 'Manually confirmed an order',
	'hall_booking.check_in': 'Function hall event checked in',
	'hall_booking.check_out': 'Function hall event checked out',
	'hall_booking.complete': 'Function hall event closed',
	'housekeeping.flag_hall': 'Hall flagged for housekeeping',
	'housekeeping.charge_damage': 'Damage charged to the bill',
	'housekeeping.dismiss_damage': 'Damage report dismissed',
	'folio.record_payment': 'Recorded a payment',
	'folio.refund_payment': 'Refunded a payment',
	'folio.void_payment': 'Voided a payment',
	'folio.add_item_charge': 'Added a charge to a folio',
	'folio.add_extension_fee': 'Added an extension fee',
	'folio.add_hall_overtime': 'Charged function hall overtime',
	'folio.void_charge': 'Voided a folio charge',
	'finance.open_shift': 'Opened a cashier shift',
	'finance.close_shift': 'Closed a cashier shift',
	'finance.shift_event': 'Recorded a drawer event',
	'finance.shift_chargeback': 'Charged a shift shortage back to a cashier',
	'finance.shift_chargeback_collected': 'Recovered a charged-back shortage',
	'finance.shift_chargeback_written_off': 'Wrote off a shift shortage',
	'finance.manual_cash_movement': 'Entered a manual cash movement',
	'finance.void_cash_movement': 'Voided a cash movement',
	'finance.day_close': 'Closed the business day',
	'finance.day_reopen': 'Reopened the business day',
	'finance.open_receivable': 'Opened a city-ledger receivable',
	'finance.settle_receivable': 'Collected a receivable',
	'finance.write_off_receivable': 'Wrote off a receivable',
	'finance.reopen_receivable': 'Reopened a receivable',
	'guest_message.cancellation_request': 'Guest requested a cancellation',
	'guest_message.decline_cancellation_request': "Declined a guest's cancellation request",
	'support_chat.start': 'Guest started a support chat',
	'support_chat.offline_message': 'Guest left a support message',
	'support_chat.message': 'Support chat message',
	'support_chat.assign': 'Support chat assigned',
	'support_chat.claim': 'Took a support chat',
	'support_chat.close': 'Support chat closed',
	'support_chat.availability': 'Changed support availability',
	'support_chat.faq_save': 'Saved a support FAQ',
	'support_chat.faq_delete': 'Deleted a support FAQ',
	'support_chat.canned_save': 'Saved a support canned reply',
	'support_chat.canned_delete': 'Deleted a support canned reply',
	'review.approve': 'Approved a guest review',
	'review.reject': 'Rejected a guest review',
	'hotel.invite_member': 'Invited a staff member',
	'hotel.remove_member': 'Removed a staff member',
	'hotel.change_role': "Changed a staff member's role",

	// BIR documents
	'bir.issue_official_receipt': 'Issued an official receipt',
	'bir.issue_invoice': 'Issued an invoice',
	'bir.cancel_document': 'Cancelled a receipt or invoice',
	'bir.spoil_serial': 'Spoiled a document serial number',

	// Dining orders
	'dining_order.create': 'Order placed',
	'dining_order.status': 'Order moved along the kitchen flow',
	'dining_order.station': 'Kitchen station updated the order',
	'dining_order.dispatch': 'Delivery sent out with a rider',
	'dining_order.cancel': 'Order cancelled',
	'dining_order.accept': 'Order accepted',
	'dining_order.decline': 'Order declined',
	'dining_order.paid': 'Payment taken at the cashier',
	'dining_order.void_payment': 'Payment voided',
	'dining_order.paymongo_paid': 'Online payment confirmed (PayMongo)',
	'dining_order.payment_failed': 'Online payment attempt failed',
	'dining_order.checkout_started': 'Online checkout link created',
	'dining_order.checkout_failed': 'Online checkout could not be created',
	'dining_order.checkout_expired': 'Earlier checkout link expired',
	'dining_order.expired': 'Order cancelled: online payment not completed in time',
	'dining_order.guest_cancel': 'Guest cancelled the order',
	'dining_order.cancel_requested': 'Guest asked to cancel a paid order',
	'dining_order.cancel_approved': 'Cancellation request approved',
	'dining_order.cancel_declined': 'Cancellation request declined',
	'dining_order.message': 'Message sent',
	'dining_order.refund': 'Refund recorded',
	'dining_order.room_charge': 'Charged to a room bill',
	'dining_order.undo_room_charge': 'Taken off the room bill',
	'dining_order.pre_order_attached': 'Pre-order placed on the table bill',
	'dining_order.pre_order_cancelled': 'Pre-order cancelled with its reservation',
	'dining_order.force_served': 'Marked served when the table was cleared',
	'dining_order.table_moved': 'Order moved to another table',

	// Table checks
	'dining_check.settle': 'Table bill settled',
	'dining_check.close': 'Table closed',
	'dining_check.force_clear': 'Table cleared by a manager',
	'dining_check.bill_requested': 'Bill requested',
	'dining_check.move_table': 'Guests moved to another table',
	'dining_check.merge': 'Table bill joined to another table',

	// Table reservations
	'dining_reservation.create': 'Table reserved',
	'dining_reservation.status': 'Reservation status changed',
	'dining_reservation.reassign': 'Reservation moved to other table(s)'
};

export function actionLabel(action: string): string {
	if (ACTION_LABELS[action]) return ACTION_LABELS[action];
	const part = action.includes('.') ? action.slice(action.indexOf('.') + 1) : action;
	const words = part.replace(/_/g, ' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}

export type ActorKind = 'staff' | 'guest' | 'system';

export const ACTOR_KIND_LABEL: Record<ActorKind, string> = {
	staff: 'Staff',
	guest: 'Guest',
	system: 'System'
};

/**
 * Who an entry is attributed to. A signed-in user is always staff. A row from before
 * `actor_kind` existed has no user and no recorded origin, so it cannot be told apart: it is
 * shown honestly as "Guest or system (not recorded)" rather than guessed.
 */
export function actorOf(row: {
	actorUserId: string | null;
	actorLabel: string | null;
	actorKind: string;
	ipAddress: string | null;
	refCode: string | null;
}): { kind: ActorKind | 'unknown'; label: string } {
	const name = row.actorLabel ? row.actorLabel.split(' <')[0]! : null;
	if (row.actorUserId || (row.actorLabel && row.actorKind !== 'guest')) {
		return { kind: 'staff', label: name ?? 'Staff' };
	}
	if (row.actorKind === 'guest') return { kind: 'guest', label: 'Guest' };
	if (row.actorKind === 'system' && (row.ipAddress || row.refCode)) return { kind: 'system', label: 'System' };
	return { kind: 'unknown', label: 'Guest or system (not recorded)' };
}

/** A short, readable device name from a raw user-agent string (the full string stays available). */
export function browserOf(ua: string | null | undefined): string {
	if (!ua) return '';
	const os = /Windows/i.test(ua)
		? 'Windows'
		: /Android/i.test(ua)
			? 'Android'
			: /iPhone|iPad|iOS/i.test(ua)
				? 'iOS'
				: /Mac OS X|Macintosh/i.test(ua)
					? 'macOS'
					: /Linux/i.test(ua)
						? 'Linux'
						: '';
	const br = /Edg\//.test(ua)
		? 'Edge'
		: /OPR\/|Opera/.test(ua)
			? 'Opera'
			: /Chrome\//.test(ua)
				? 'Chrome'
				: /Firefox\//.test(ua)
					? 'Firefox'
					: /Safari\//.test(ua)
						? 'Safari'
						: '';
	return [br, os].filter(Boolean).join(' on ') || ua.slice(0, 60);
}

// ---------------------------------------------------------------------------
// One-line context for an entry, from the data it recorded
// ---------------------------------------------------------------------------

export type Json = Record<string, unknown>;
export const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
export const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const peso = (c: number) =>
	`₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const words = (s: string) => s.replace(/_/g, ' ');
const METHOD: Record<string, string> = {
	cash: 'cash',
	card: 'card',
	gcash: 'GCash',
	maya: 'Maya',
	paymongo: 'online (PayMongo)',
	bank_transfer: 'bank transfer',
	paymongo_dashboard: 'PayMongo dashboard',
	other: 'other'
};
export const method = (m: string | null) => (m ? (METHOD[m] ?? words(m)) : null);

/** The one-line context for an audit entry, from what it recorded. */
export function detailOf(action: string, before: Json, after: Json): { detail: string; amount: number | null } {
	const bits: string[] = [];
	let amount: number | null = null;
	const reason = str(after.reason);
	switch (action) {
		case 'dining_order.create': {
			const lines = Array.isArray(after.lineNames) ? (after.lineNames as string[]).join(', ') : null;
			bits.push(words(str(after.orderType) ?? 'order'));
			if (str(after.tableLabel)) bits.push(`table ${after.tableLabel}`);
			if (str(after.fulfilment) === 'delivery') bits.push('delivery');
			if (str(after.guestName)) bits.push(String(after.guestName));
			if (lines) bits.push(lines);
			amount = num(after.totalCentavos);
			break;
		}
		case 'dining_order.status':
		case 'dining_order.accept':
		case 'dining_order.force_served':
			if (str(before.status) && str(after.status)) bits.push(`${words(String(before.status))} → ${words(String(after.status))}`);
			else if (str(after.status)) bits.push(words(String(after.status)));
			if (reason) bits.push(reason);
			break;
		case 'dining_order.station':
			bits.push(`${str(after.station) === 'all' ? 'all stations' : `station ${str(after.station) ?? ''}`}: ${str(after.to) ?? ''}`.trim());
			if (str(after.status)) bits.push(`order now ${words(String(after.status))}`);
			break;
		case 'dining_order.dispatch':
			if (str(after.riderName)) bits.push(`rider ${after.riderName}`);
			break;
		case 'dining_order.paid':
			if (method(str(after.method))) bits.push(`by ${method(str(after.method))}`);
			if (num(after.tenderedCentavos) != null) bits.push(`tendered ${peso(num(after.tenderedCentavos)!)}`);
			if ((num(after.changeCentavos) ?? 0) > 0) bits.push(`change ${peso(num(after.changeCentavos)!)}`);
			amount = num(after.totalCentavos);
			break;
		case 'dining_order.void_payment': {
			const receipts = Array.isArray(before.receipts) ? (before.receipts as string[]) : [];
			if (reason) bits.push(reason);
			if (method(str(after.method))) bits.push(`was ${method(str(after.method))}`);
			if (receipts.length) bits.push(`cancelled receipt ${receipts.join(', ')}`);
			amount = num(after.amountCentavos);
			break;
		}
		case 'dining_order.paymongo_paid':
			if (after.needsRefund === true) bits.push('arrived after the order was closed: refund due');
			amount = num(after.amountCentavos);
			break;
		case 'dining_order.payment_failed':
		case 'dining_order.checkout_started':
			amount = num(after.amountCentavos);
			break;
		case 'dining_order.checkout_failed':
			if (str(after.error)) bits.push(String(after.error));
			amount = num(after.amountCentavos);
			break;
		case 'dining_order.checkout_expired':
			if (reason) bits.push(reason);
			break;
		case 'dining_order.cancel':
		case 'dining_order.decline':
		case 'dining_order.expired':
		case 'dining_order.guest_cancel':
		case 'dining_order.pre_order_cancelled':
			if (reason) bits.push(reason);
			if (after.refundDue === true) bits.push('already paid: refund due');
			break;
		case 'dining_order.cancel_requested':
			if (str(after.reason)) bits.push(String(after.reason));
			break;
		case 'dining_order.cancel_approved':
		case 'dining_order.cancel_declined':
			if (str(after.message)) bits.push(String(after.message));
			break;
		case 'dining_order.message':
			bits.push(`${str(after.direction) ?? ''}: ${str(after.preview) ?? ''}`);
			break;
		case 'dining_order.refund':
			if (method(str(after.method))) bits.push(`via ${method(str(after.method))}`);
			if (str(after.referenceNo)) bits.push(`ref ${after.referenceNo}`);
			if (after.fullyRefunded === true) bits.push('fully refunded');
			amount = num(after.amountCentavos);
			break;
		case 'dining_order.room_charge':
			if (str(after.room)) bits.push(`room ${after.room}`);
			if (str(after.bookingCode)) bits.push(`booking ${after.bookingCode}`);
			amount = num(after.totalCentavos);
			break;
		case 'dining_order.undo_room_charge':
			if (reason) bits.push(reason);
			break;
		case 'dining_order.pre_order_attached':
		case 'dining_order.table_moved':
			if (str(after.tableName) ?? str(after.tableLabel)) bits.push(`table ${str(after.tableName) ?? str(after.tableLabel)}`);
			if (str(before.tableName)) bits.push(`from table ${before.tableName}`);
			break;
		case 'hall_booking.check_out': {
			const hours = num(after.overtimeHours) ?? 0;
			if (hours > 0) {
				bits.push(`overtime ${hours} hour${hours === 1 ? '' : 's'}`);
				if (num(after.overtimeRateCentavos) != null) bits.push(`at ${peso(num(after.overtimeRateCentavos)!)} an hour`);
				amount = num(after.overtimeCentavos);
			} else {
				bits.push('on time, no overtime');
			}
			break;
		}
		case 'hall_booking.complete':
			if (after.cityLedger === true) bits.push('balance moved to the city ledger');
			break;
		case 'bir.issue_official_receipt':
		case 'bir.issue_invoice':
			if (str(after.formattedNo)) bits.push(String(after.formattedNo));
			break;
		case 'bir.cancel_document':
			if (str(after.formattedNo)) bits.push(String(after.formattedNo));
			if (reason) bits.push(reason);
			break;
		case 'finance.void_cash_movement':
			if (reason) bits.push(reason);
			amount = num(after.amountCentavos);
			break;
		case 'dining_check.settle': {
			const codes = Array.isArray(after.orderCodes) ? (after.orderCodes as string[]).join(', ') : '';
			if (method(str(after.method)) ?? str(after.method)) bits.push(`by ${method(str(after.method)) ?? after.method}`);
			if (codes) bits.push(codes);
			if (num(after.tenderedCentavos) != null) bits.push(`tendered ${peso(num(after.tenderedCentavos)!)}`);
			if ((num(after.changeCentavos) ?? 0) > 0) bits.push(`change ${peso(num(after.changeCentavos)!)}`);
			const docs = Array.isArray(after.documents) ? (after.documents as string[]) : [];
			if (docs.length) bits.push(`issued ${docs.join(', ')}`);
			amount = num(after.totalCentavos);
			break;
		}
		case 'dining_check.force_clear':
			if (reason) bits.push(reason);
			break;
		case 'dining_check.move_table':
		case 'dining_check.merge':
			if (str(before.tableName)) bits.push(`from table ${before.tableName}`);
			if (str(after.tableName) ?? str(after.intoTableName)) bits.push(`to table ${str(after.tableName) ?? str(after.intoTableName)}`);
			break;
		case 'dining_reservation.create':
			if (str(after.guestName)) bits.push(String(after.guestName));
			if (num(after.partySize) != null) bits.push(`party of ${after.partySize}`);
			if (Array.isArray(after.tables) && after.tables.length) bits.push(`table ${(after.tables as string[]).join(', ')}`);
			break;
		case 'dining_reservation.status':
			if (str(before.status) && str(after.status)) bits.push(`${words(String(before.status))} → ${words(String(after.status))}`);
			break;
		default:
			break;
	}
	return { detail: bits.join(' · '), amount };
}

