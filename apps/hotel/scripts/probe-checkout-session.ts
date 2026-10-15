/**
 * Read-only probe: what does GET /v1/checkout_sessions/{id} return for a paid session and for an unpaid / expired one?
 *   pnpm --filter @mm/hotel exec tsx scripts/probe-checkout-session.ts
 * Prints field names and a few non-sensitive values only (never the key, never customer details).
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
const [ps] = await sql<{ secret_key_enc: string; hotel_id: string }[]>`select secret_key_enc, hotel_id from paymongo_settings limit 1`;
const paid = await sql<{ sid: string }[]>`select paymongo_checkout_session_id sid from payments where status='paid' and paymongo_checkout_session_id is not null order by created_at desc limit 2`;
const unpaid = await sql<{ sid: string; status: string }[]>`select paymongo_checkout_session_id sid, status::text from orders where status in ('cancelled','pending_payment') and paymongo_checkout_session_id is not null order by created_at desc limit 3`;
await sql.end();
const auth = Buffer.from(`${decrypt(ps!.secret_key_enc)}:`).toString('base64');

async function show(label: string, id: string) {
	const res = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${id}`, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
	const body = (await res.json().catch(() => null)) as { data?: { id: string; attributes: Record<string, any> }; errors?: unknown[] } | null;
	console.log(`${label}  ${id}  -> HTTP ${res.status}`);
	const a = body?.data?.attributes;
	if (!a) { console.log('   ', JSON.stringify(body).slice(0, 200)); return; }
	console.log('   attribute names:', Object.keys(a).join(', '));
	console.log('   status:', a.status, '| paid_at:', a.paid_at, '| payment_intent id:', a.payment_intent?.id, '| payment_intent status:', a.payment_intent?.attributes?.status);
	console.log('   metadata:', JSON.stringify(a.metadata), '| expires_at/created_at:', a.expires_at, a.created_at, '| livemode:', a.livemode);
	const p = a.payments?.[0];
	console.log('   payments[]:', (a.payments ?? []).length, '| first:', p ? `${p.id} status=${p.attributes?.status} amount=${p.attributes?.amount} payment_intent_id=${p.attributes?.payment_intent_id}` : 'none');
	console.log('   payment_method_used:', a.payment_method_used, '| reference_number:', a.reference_number);
}
for (const r of paid) await show('PAID   ', r.sid);
for (const r of unpaid) await show(`order ${r.status}`.padEnd(7), r.sid);
