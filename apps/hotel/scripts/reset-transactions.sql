-- Wipes every transaction so a hotel can open on live money, and keeps the setup it was configured with.
--
-- Kept: hotels, users, staff, roles, memberships, sessions, rooms and room types, rates, amenities, taxes,
-- promo codes, policies, cash accounts, chart of accounts, expense categories, vendors, recurring expenses,
-- the dining menu and its areas/tables, function halls, every settings row (PayMongo, BIR, email, finance),
-- and the document series (its counter is wound back to the first serial).
--
-- Removed: bookings, hall bookings, orders, folios and charges, payments and their PayMongo mirror,
-- cash movements, shifts, day closes, Z-readings, expenses, receivables, documents, journal entries,
-- guests, reviews, promo redemptions, dining orders and reservations, standalone sales, housekeeping
-- records, and the audit / email / error logs.
--
--   psql "$DATABASE_URL" -f scripts/reset-transactions.sql
--
-- Runs as one transaction: any error rolls the whole thing back. Take a dump first.

BEGIN;

-- The reconciliation trail refuses updates, deletes and truncates so nobody can quietly rewrite it. Clearing it
-- is exactly the move it guards against, so the guard comes off only here, inside this transaction.
ALTER TABLE payment_reconciliation_events DISABLE TRIGGER USER;

TRUNCATE TABLE
	bookings,
	booking_rooms,
	booking_status_history,
	hall_bookings,
	hall_booking_status_history,
	orders,
	order_status_history,
	payments,
	payment_allocations,
	payment_attempts,
	payment_reconciliation_events,
	paymongo_ledger,
	paymongo_sync_state,
	folios,
	folio_charges,
	sc_pwd_discounts,
	security_deposits,
	cash_movements,
	cashier_shifts,
	shift_events,
	day_closes,
	z_readings,
	expenses,
	receivables,
	receivable_entries,
	documents,
	journal_entries,
	journal_lines,
	guests,
	guest_messages,
	reviews,
	promo_redemptions,
	dining_orders,
	dining_order_items,
	dining_order_item_addons,
	dining_order_messages,
	dining_payments,
	dining_reservations,
	dining_reservation_tables,
	dining_table_checks,
	standalone_sales,
	standalone_sale_items,
	housekeeping_damage_reports,
	housekeeping_inspections,
	housekeeping_status,
	room_assignments,
	support_conversations,
	support_messages,
	support_agent_presence,
	audit_log,
	email_log,
	error_log
RESTART IDENTITY;

ALTER TABLE payment_reconciliation_events ENABLE TRIGGER USER;

-- The balance on a cash account is cached, not derived, so it has to be wound back by hand.
UPDATE cash_accounts SET current_balance_centavos = opening_balance_centavos, updated_at = now();

-- BIR serials start again at the first number of each series.
UPDATE document_series SET next_serial = serial_from, updated_at = now();

COMMIT;
