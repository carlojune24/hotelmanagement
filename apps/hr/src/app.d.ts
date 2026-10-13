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

		interface Locals {
			user: SessionUser | null;
			sessionToken: string | null;
			/** Resolved capabilities for `user`, or null when signed out. */
			access: Access | null;
		}
	}
}

export {};
