import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { establishments } from '$lib/server/db/schema/index';
import { verifyApiKey } from '$lib/server/auth/api-key';
import { RateLimiter } from '$lib/server/auth/rate-limit';
import { MAX_REFS, assignedToEstablishment, peopleByRef } from '$lib/server/hr/api';
import type { RequestHandler } from './$types';

// Per key, per minute. Process-local like the sign-in limiter; plenty for a Team screen + a poller.
const limiter = new RateLimiter({ max: 120, windowMs: 60_000 });

const unauthorized = () =>
	json({ error: 'unauthorized' }, { status: 401, headers: { 'www-authenticate': 'Bearer' } });

/**
 * `GET /api/v1/hr/employees`
 *   (no query)              the people currently assigned to the key's establishment
 *   `?person_refs=a,b,c`    those people's state (status + whether still assigned) — for sync
 *
 * Server-to-server only: a per-establishment bearer key issued in HR → Settings. Nothing but the
 * identity/post fields in `ApiEmployee` ever leaves.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const m = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '');
	if (!m) return unauthorized();
	const key = await verifyApiKey(m[1]!);
	if (!key || !key.scopes.includes('employees:read')) return unauthorized();

	const wait = limiter.retryAfter(key.establishmentId);
	if (wait) {
		return json({ error: 'rate_limited' }, { status: 429, headers: { 'retry-after': String(wait) } });
	}
	limiter.consume(key.establishmentId);

	const est = await db
		.select({ orgRef: establishments.orgRef, name: establishments.name })
		.from(establishments)
		.where(eq(establishments.id, key.establishmentId))
		.then((r) => r.at(0));
	if (!est) return unauthorized();

	const refsParam = url.searchParams.get('person_refs');
	if (refsParam !== null) {
		const refs = refsParam.split(',');
		if (refs.length > MAX_REFS) {
			return json({ error: 'too_many_refs', max: MAX_REFS }, { status: 400 });
		}
		return json({
			establishment: { org_ref: est.orgRef, name: est.name },
			employees: await peopleByRef(key.establishmentId, refs)
		});
	}
	return json({
		establishment: { org_ref: est.orgRef, name: est.name },
		employees: await assignedToEstablishment(key.establishmentId)
	});
};
