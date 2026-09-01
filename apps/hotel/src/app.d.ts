import type { MembershipRole } from '$lib/authz';
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
			/** The signed-in user's role at `locals.hotel`, else null. */
			role: MembershipRole | null;
		}

		interface PageData {
			user: SessionUser | null;
			hotel: HotelContext | null;
			role: MembershipRole | null;
		}

		// interface PageState {}
		// interface Platform {}
	}
}

export {};
