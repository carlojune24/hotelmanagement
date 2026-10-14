import { readFile } from 'node:fs/promises';
import { error } from '@sveltejs/kit';
import { logoFilePath } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

const CONTENT_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

/** The company logo. Public on purpose: the sign-in page shows it before anyone is signed in. */
export const GET: RequestHandler = async ({ params }) => {
	const filePath = logoFilePath(params.filename);
	if (!filePath) error(404, 'Not found');
	try {
		return new Response(await readFile(filePath), {
			headers: {
				'content-type': CONTENT_TYPES[params.filename.split('.').pop()!] ?? 'application/octet-stream',
				'cache-control': 'public, max-age=31536000, immutable'
			}
		});
	} catch {
		error(404, 'Not found');
	}
};
