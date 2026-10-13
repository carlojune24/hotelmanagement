/** Only a same-origin relative path is a safe post-login redirect target — never an
 *  absolute URL or a protocol-relative `//host/...` one, which would silently redirect
 *  off-site. */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
	return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}
