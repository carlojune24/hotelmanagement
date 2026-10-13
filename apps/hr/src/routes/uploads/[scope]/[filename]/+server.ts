import { readFile } from 'node:fs/promises';
import { error } from '@sveltejs/kit';
import { resolveUploadPath } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

const CONTENT_TYPES: Record<string, string> = {
	jpg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	gif: 'image/gif'
};

/** Employee photos. Unlike the hotel's public branding images these are personal data, so a
 *  signed-in user is required (and the file name is an unguessable ULID). */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Sign in to view this file');
	const filePath = resolveUploadPath(params.scope, params.filename);
	if (!filePath) error(404, 'Not found');
	const ext = params.filename.split('.').pop()!;
	try {
		const bytes = await readFile(filePath);
		return new Response(bytes, {
			headers: {
				'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
				'cache-control': 'private, max-age=31536000, immutable'
			}
		});
	} catch {
		error(404, 'Not found');
	}
};
