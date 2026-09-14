import { json, type RequestEvent } from '@sveltejs/kit';
import { MM_STANDARD_VERSION, MM_STANDARD_VERSION_HEADER } from '@mm/integration';
import { requireApiKey, assertHotelsInScope, type ApiKeyAuth } from '../auth/api-key';
import { FinanceError } from '../finance/shared';
import { ApiError } from './api-error';

const HEADERS = { [MM_STANDARD_VERSION_HEADER]: MM_STANDARD_VERSION };

/**
 * Wraps a `GET /api/v1/finance/*` handler with API-key auth + hotel-scope
 * checking, stamps `X-MM-Standard-Version`, and formats every error as
 * `{ error: { message } }` JSON (not SvelteKit's default HTML error page) — these
 * routes are machine consumers only.
 */
export async function withApiKey(
	event: RequestEvent,
	handler: (auth: ApiKeyAuth, hotelIds: string[]) => Promise<unknown>
): Promise<Response> {
	try {
		const auth = await requireApiKey(event);
		const requested = event.url.searchParams.getAll('hotel_id');
		const hotelIds = assertHotelsInScope(requested, auth.hotelIds);
		const data = await handler(auth, hotelIds);
		return json(data, { headers: HEADERS });
	} catch (e) {
		if (e instanceof ApiError) {
			return json({ error: { message: e.message } }, { status: e.status, headers: HEADERS });
		}
		if (e instanceof FinanceError) {
			return json({ error: { message: e.message } }, { status: 400, headers: HEADERS });
		}
		throw e;
	}
}
