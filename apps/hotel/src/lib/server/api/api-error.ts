/** An error the `/api/v1/*` layer turns into `{ error: { message } }` with the
 *  given status, instead of SvelteKit's default HTML error page — these routes
 *  are machine consumers only. Optional `headers` are merged onto the response
 *  (e.g. `Retry-After` on a 429). */
export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
		public headers?: Record<string, string>
	) {
		super(message);
	}
}
