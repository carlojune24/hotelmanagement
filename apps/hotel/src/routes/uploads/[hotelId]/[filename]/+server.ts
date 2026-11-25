import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
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
 * Honors `Range` so the hero video can start before it is fully downloaded —
 * iOS Safari refuses to play a <video> at all without 206 responses.
 */
export const GET: RequestHandler = async ({ params, request }) => {
	const filePath = resolveUploadPath(params.hotelId, params.filename);
	if (!filePath) error(404, 'Not found');

	let size: number;
	try {
		size = (await stat(filePath)).size;
	} catch {
		error(404, 'Not found');
	}

	const ext = params.filename.split('.').pop()!;
	const headers: Record<string, string> = {
		'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
		'cache-control': 'public, max-age=31536000, immutable',
		'accept-ranges': 'bytes'
	};

	// Single range only ("bytes=a-b", "bytes=a-", "bytes=-n"); anything else gets the whole file.
	const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
	if (m && (m[1] || m[2])) {
		const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
		const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
		if (start >= size || start > end) {
			return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
		}
		return new Response(stream(filePath, start, end), {
			status: 206,
			headers: {
				...headers,
				'content-range': `bytes ${start}-${end}/${size}`,
				'content-length': String(end - start + 1)
			}
		});
	}

	return new Response(stream(filePath, 0, size - 1), {
		headers: { ...headers, 'content-length': String(size) }
	});
};

function stream(path: string, start: number, end: number) {
	return Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
}
