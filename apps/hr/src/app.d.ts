import type { Access } from '$lib/authz';
import type { SessionUser } from '$lib/server/auth/session';

declare global {
	namespace App {
		interface Error {
			message: string;
			code?: string;
			/** Short reference minted by `handleError` for an unexpected (5xx) failure. */
			ref?: string;
		}

		/** The establishment named by the `/{slug}/…` path, once the signed-in user is known
		 *  to be allowed to see it. */
		interface EstablishmentContext {
			id: string;
			slug: string;
			name: string;
			kind: 'hotel' | 'business';
			timezone: string;
			config: unknown;
		}

		interface Locals {
			user: SessionUser | null;
			sessionToken: string | null;
			/** Resolved capabilities for `user`, or null when signed out. */
			access: Access | null;
			/** Resolved for `/{slug}/…` and `/print/{slug}/…` routes, else null. */
			establishment: EstablishmentContext | null;
		}
	}
}

export {};
