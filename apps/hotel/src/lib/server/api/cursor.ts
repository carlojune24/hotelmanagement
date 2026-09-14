/** Opaque keyset-pagination cursor: base64 of `{ updatedAt, id }`. Rows are ordered
 *  `updatedAt asc, id asc`; the next page asks for rows strictly after this pair. */
export interface Cursor {
	updatedAt: string;
	id: string;
}

export function encodeCursor(c: Cursor): string {
	return Buffer.from(JSON.stringify(c)).toString('base64url');
}

export function decodeCursor(raw: string | null): Cursor | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
		if (typeof parsed?.updatedAt === 'string' && typeof parsed?.id === 'string') return parsed;
	} catch {
		// fall through
	}
	return null;
}
