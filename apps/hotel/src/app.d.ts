import type { ResolvedRole } from '$lib/authz';
import type { SessionUser } from '$lib/server/auth/session';
import type { HotelContext } from '$lib/server/tenant';

declare global {
	namespace App {
		interface Error {
			message: string;
			code?: string;
		}

		interface Locals {
			/** Signed-in user, or null for anonymous requests. */
			user: SessionUser | null;
			/** Opaque session token from the cookie, if present. */
			sessionToken: string | null;
			/** Resolved hotel for `/{slug}/…` routes, else null. */
			hotel: HotelContext | null;
			/** The signed-in user's role (and resolved capability set) at `locals.hotel`, else
			 *  null. See `roleCan`/`requireCap` in `$lib/authz` for how this is checked. */
			role: ResolvedRole | null;
			/** True when this request arrived via `locals.hotel.customDomain` rather than the
			 *  platform's own `/{slug}/…` path — set by `hooks.server.ts` after tenant resolution. */
			isCustomDomain: boolean;
		}

		interface PageData {
			user: SessionUser | null;
			hotel: HotelContext | null;
			role: ResolvedRole | null;
		}

		// interface PageState {}
		// interface Platform {}
	}
}

export {};
