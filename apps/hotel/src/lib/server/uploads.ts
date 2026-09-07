import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from 'ulid';

/**
 * Local-disk storage for admin-uploaded branding images (logo, hero, gallery).
 * Deliberately simple — this app runs behind `adapter-node` as a persistent
 * server (not serverless), so a plain directory on the server's own disk is a
 * real, durable option with no external account to set up. If this app ever
 * moves to ephemeral/serverless hosting, swap this module for an object-store
 * client; nothing outside it needs to change (`branding.ts` and every
 * consumer just see a URL string either way).
 *
 * Override the directory with `UPLOADS_DIR` (e.g. a mounted volume in
 * production). Defaults to `<cwd>/uploads`.
 */
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads'));

/** Allowlisted image types → the extension we write to disk. Never trust the client's filename. */
const ALLOWED_TYPES: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif'
};

/** Allowlisted video types, for the hero backdrop only — see `saveUpload`'s `kind` param. */
const ALLOWED_VIDEO_TYPES: Record<string, string> = {
	'video/mp4': 'mp4',
	'video/webm': 'webm'
};

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB
/** Video is much heavier than a photo but this still runs on local disk with no CDN in
    front of it — 50 MB is generous for a short, muted, looping backdrop clip without
    letting an upload balloon disk usage or request time unreasonably. */
export const MAX_VIDEO_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

// Matches exactly what saveUpload writes (`<hotelId>/<ulid>.<ext>`) — anything else is
// ignored rather than resolved, so a malformed/legacy value can never walk outside
// UPLOADS_DIR. Shared by deleteUploadIfOwned and resolveUploadPath.
const UPLOAD_PATH_RE = /^[0-9a-zA-Z-]+\/[0-9A-Za-z]{20,30}\.(jpg|png|webp|gif|mp4|webm)$/;
const UPLOAD_FILENAME_RE = /^[0-9A-Za-z]{20,30}\.(jpg|png|webp|gif|mp4|webm)$/;

export class UploadValidationError extends Error {}

/**
 * Saves an uploaded image (or, with `kind: 'video'`, the hero backdrop clip) for a
 * hotel and returns the URL it's served at (`/uploads/<hotelId>/<file>`, handled by
 * `routes/uploads/[hotelId]/[filename]`). The on-disk filename is always generated
 * here (a ULID plus an extension derived from the validated MIME type) — the
 * browser's original filename is never used for anything beyond display.
 */
export async function saveUpload(
	hotelId: string,
	file: File,
	kind: 'image' | 'video' = 'image'
): Promise<string> {
	if (file.size === 0) throw new UploadValidationError('The file is empty.');

	if (kind === 'video') {
		if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
			throw new UploadValidationError('Videos must be 50 MB or smaller.');
		}
		const ext = ALLOWED_VIDEO_TYPES[file.type];
		if (!ext) throw new UploadValidationError('Use an MP4 or WebM video.');
		return writeUpload(hotelId, file, ext);
	}

	if (file.size > MAX_UPLOAD_BYTES) {
		throw new UploadValidationError('Images must be 8 MB or smaller.');
	}
	const ext = ALLOWED_TYPES[file.type];
	if (!ext) {
		throw new UploadValidationError('Use a JPEG, PNG, WebP, or GIF image.');
	}
	return writeUpload(hotelId, file, ext);
}

async function writeUpload(hotelId: string, file: File, ext: string): Promise<string> {
	const dir = path.join(UPLOADS_DIR, hotelId);
	await mkdir(dir, { recursive: true });

	const filename = `${ulid()}.${ext}`;
	const bytes = Buffer.from(await file.arrayBuffer());
	await writeFile(path.join(dir, filename), bytes);

	return `/uploads/${hotelId}/${filename}`;
}

/** Deletes a previously uploaded file if `url` points at our own upload store; a no-op for external URLs. */
export async function deleteUploadIfOwned(url: string | undefined | null): Promise<void> {
	if (!url || !url.startsWith('/uploads/')) return;
	const relative = url.slice('/uploads/'.length);
	if (!UPLOAD_PATH_RE.test(relative)) return;
	try {
		await unlink(path.join(UPLOADS_DIR, relative));
	} catch {
		// Already gone, or never existed — fine either way.
	}
}

export function resolveUploadPath(hotelId: string, filename: string): string | null {
	if (!/^[0-9a-zA-Z-]+$/.test(hotelId)) return null;
	if (!UPLOAD_FILENAME_RE.test(filename)) return null;
	return path.join(UPLOADS_DIR, hotelId, filename);
}
