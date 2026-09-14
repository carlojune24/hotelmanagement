/** An error the `/api/v1/*` layer turns into `{ error: { message } }` with the
 *  given status, instead of SvelteKit's default HTML error page — these routes
 *  are machine consumers only. */
export class ApiError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}
