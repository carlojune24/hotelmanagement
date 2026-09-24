import { sql, type SQLWrapper } from 'drizzle-orm';

/** `coalesce(sum(col), 0)` of a centavos column, as a JS number.
 *
 *  Never cast a money sum to `::int`: that is a 32-bit integer, so it errors ("integer out of
 *  range") once a sum passes 2,147,483,647 centavos (₱21,474,836.47) — reached in months by a
 *  busy hotel's all-time balance-sheet or trial-balance sum. Cast to `bigint` instead, and
 *  `mapWith(Number)` because the Postgres driver hands a `bigint` back as a string. Safe for
 *  sums up to 2^53 centavos (≈ ₱90 trillion). */
export function sumCentavos(column: SQLWrapper) {
	return sql<number>`coalesce(sum(${column}), 0)::bigint`.mapWith(Number);
}
