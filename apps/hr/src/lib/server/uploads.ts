import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from 'ulid';

// Separate from the hotel app's uploads dir — never point both apps at the same directory.
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads'));

const ALLOWED_TYPES: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif'
};

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

// Matches exactly what saveUpload writes (`<establishmentId>/<ulid>.<ext>`) — anything else is
// ignored rather than resolved, so a malformed value can never walk outside UPLOADS_DIR.
const UPLOAD_PATH_RE = /^[0-9a-zA-Z-]+\/[0-9A-Za-z]{20,30}\.(jpg|png|webp|gif)$/;
const UPLOAD_FILENAME_RE = /^[0-9A-Za-z]{20,30}\.(jpg|png|webp|gif)$/;

export class UploadValidationError extends Error {}

/** Saves an employee photo under `<scopeId>/` and returns its `/uploads/…` URL. */
export async function saveUpload(scopeId: string, file: File): Promise<string> {
	if (file.size === 0) throw new UploadValidationError('The file is empty.');
	if (file.size > MAX_UPLOAD_BYTES) {
		throw new UploadValidationError('Images must be 8 MB or smaller.');
	}
	const ext = ALLOWED_TYPES[file.type];
	if (!ext) throw new UploadValidationError('Use a JPEG, PNG, WebP, or GIF image.');

	const dir = path.join(UPLOADS_DIR, scopeId);
	await mkdir(dir, { recursive: true });
	const filename = `${ulid()}.${ext}`;
	await writeFile(path.join(dir, filename), Buffer.from(await file.arrayBuffer()));
	return `/uploads/${scopeId}/${filename}`;
}

export async function deleteUploadIfOwned(url: string | undefined | null): Promise<void> {
	if (!url || !url.startsWith('/uploads/')) return;
	const relative = url.slice('/uploads/'.length);
	if (!UPLOAD_PATH_RE.test(relative)) return;
	try {
		await unlink(path.join(UPLOADS_DIR, relative));
	} catch {
		// Already gone — fine either way.
	}
}

export function resolveUploadPath(scopeId: string, filename: string): string | null {
	if (!/^[0-9a-zA-Z-]+$/.test(scopeId)) return null;
	if (!UPLOAD_FILENAME_RE.test(filename)) return null;
	return path.join(UPLOADS_DIR, scopeId, filename);
}
