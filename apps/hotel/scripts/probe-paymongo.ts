/**
 * Read-only probe: which PayMongo list / balance endpoints does a hotel's connected secret key reach?
 *
 *   pnpm --filter @mm/hotel exec tsx scripts/probe-paymongo.ts [hotelSlug]
 *
 * Only GET requests. Prints status codes and field NAMES (and a few non-sensitive values such as amounts and
 * statuses), never the key and never customer details. Decrypts the stored key itself because the app's
 * `secrets.ts` imports SvelteKit's `$env`, which a plain script cannot resolve.
 */
import 'dotenv/config';
import { createDecipheriv } from 'node:crypto';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
const master = process.env.APP_ENCRYPTION_KEY;
if (!url || !master) throw new Error('DATABASE_URL and APP_ENCRYPTION_KEY must be set');

function decrypt(stored: string): string {
	const [v, iv, tag, ct] = stored.split(':');
	if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unexpected secret format');
	const d = createDecipheriv('aes-256-gcm', Buffer.from(master!, 'base64'), Buffer.from(iv, 'base64'));
	d.setAuthTag(Buffer.from(tag, 'base64'));
	return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

const sql = postgres(url, { max: 1 });
const slug = process.argv[2];
const rows = await sql<{ hotel_id: string; mode: string; secret_key_enc: string; slug: string }[]>`
	select ps.hotel_id, ps.mode, ps.secret_key_enc, h.slug
	from paymongo_settings ps join hotels h on h.id = ps.hotel_id
	${slug ? sql`where h.slug = ${slug}` : sql``}
	limit 1`;
await sql.end();
const row = rows[0];
if (!row) throw new Error('No hotel with PayMongo connected');
const secretKey = decrypt(row.secret_key_enc);
console.log(`Hotel ${row.slug} · mode ${row.mode}\n`);

const auth = Buffer.from(`${secretKey}:`).toString('base64');
async function probe(label: string, path: string) {
	try {
		const res = await fetch(`https://api.paymongo.com${path}`, {
			headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' }
		});
		const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
		console.log(`${label}  GET ${path}  ->  HTTP ${res.status}`);
		if (!res.ok) {
			const errs = (body?.errors as { code?: string; detail?: string }[] | undefined) ?? [];
			console.log('   errors:', errs.map((e) => `${e.code}: ${e.detail}`).join(' | ') || JSON.stringify(body)?.slice(0, 200));
			return;
		}
		const data = body?.data;
		const list = Array.isArray(data) ? data : data ? [data] : [];
		console.log(`   top-level keys: ${Object.keys(body ?? {}).join(', ')} | items: ${list.length} | has_more: ${String(body?.has_more)}`);
		const first = list[0] as { id?: string; type?: string; attributes?: Record<string, unknown> } | undefined;
		if (first) {
			console.log(`   first: ${first.id} (${first.type})`);
			console.log(`   attribute names: ${Object.keys(first.attributes ?? {}).join(', ')}`);
			const a = first.attributes ?? {};
			const pick = ['amount', 'fee', 'net_amount', 'status', 'paid_at', 'available_at', 'credited_at', 'payout', 'balance_transaction_id', 'payout_status'];
			console.log('   sample values:', pick.filter((k) => k in a).map((k) => `${k}=${JSON.stringify(a[k])}`).join(' '));
		}
	} catch (e) {
		console.log(`${label}  GET ${path}  ->  FAILED: ${(e as Error).message}`);
	}
	console.log();
}

await probe('payments ', '/v1/payments?limit=3');
await probe('refunds  ', '/v1/refunds?limit=3');
await probe('payouts  ', '/v1/payouts?limit=3');
await probe('wallets  ', '/v1/wallets');
await probe('balance  ', '/v1/balance');
await probe('transfers', '/v1/transfers?limit=3');
