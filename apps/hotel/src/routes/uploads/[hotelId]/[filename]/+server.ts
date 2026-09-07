import { readFile } from 'node:fs/promises';
import { error } from '@sveltejs/kit';
import { resolveUploadPath } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

const CONTENT_TYPES: Record<string, string> = {
	jpg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	gif: 'image/gif',
	mp4: 'video/mp4',
	webm: 'video/webm'
};

/**
 * Serves admin-uploaded branding images from local disk (see `lib/server/uploads.ts`).
 * Public/unauthenticated — these are marketing images meant to appear on the
 * public booking page, same trust level as an externally hosted photo URL.
 */
export const GET: RequestHandler = async ({ params }) => {
	const filePath = resolveUploadPath(params.hotelId, params.filename);
	if (!filePath) error(404, 'Not found');

	const ext = params.filename.split('.').pop()!;
	try {
		const bytes = await readFile(filePath);
		return new Response(bytes, {
			headers: {
				'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
				'cache-control': 'public, max-age=31536000, immutable'
			}
		});
	} catch {
		error(404, 'Not found');
	}
};
