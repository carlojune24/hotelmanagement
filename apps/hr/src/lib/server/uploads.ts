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

// ---------------------------------------------------------------------------
// Loan documents — never reachable through the public /uploads route: the directory name has an
// underscore (that route's scope pattern rejects it) and they are served only to payroll users.
// ---------------------------------------------------------------------------

const LOAN_DOC_TYPES: Record<string, string> = {
	'application/pdf': 'pdf',
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp'
};
const LOAN_DOC_DIR = path.join(UPLOADS_DIR, '_loan-docs');
const LOAN_DOC_NAME_RE = /^[0-9A-Za-z]{20,30}\.(pdf|jpg|png|webp)$/;

export async function saveLoanDocument(file: File): Promise<{ storedName: string; contentType: string; sizeBytes: number }> {
	if (file.size === 0) throw new UploadValidationError('The file is empty.');
	if (file.size > MAX_UPLOAD_BYTES) throw new UploadValidationError('Documents must be 8 MB or smaller.');
	const ext = LOAN_DOC_TYPES[file.type];
	if (!ext) throw new UploadValidationError('Use a PDF, JPEG, PNG or WebP file.');
	await mkdir(LOAN_DOC_DIR, { recursive: true });
	const storedName = `${ulid()}.${ext}`;
	await writeFile(path.join(LOAN_DOC_DIR, storedName), Buffer.from(await file.arrayBuffer()));
	return { storedName, contentType: file.type, sizeBytes: file.size };
}

export function loanDocumentPath(storedName: string): string | null {
	return LOAN_DOC_NAME_RE.test(storedName) ? path.join(LOAN_DOC_DIR, storedName) : null;
}

export async function deleteLoanDocument(storedName: string): Promise<void> {
	const p = loanDocumentPath(storedName);
	if (!p) return;
	try {
		await unlink(p);
	} catch {
		// Already gone — fine either way.
	}
}

// ---------------------------------------------------------------------------
// Company logo — one public file under `_brand/`, served by /brand/<name> (the sign-in page shows it).
// SVG is not accepted: it can carry script.
// ---------------------------------------------------------------------------

const LOGO_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const LOGO_DIR = path.join(UPLOADS_DIR, '_brand');
const LOGO_NAME_RE = /^[0-9A-Za-z]{20,30}\.(png|jpg|webp)$/;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export async function saveLogoFile(file: File): Promise<string> {
	if (file.size === 0) throw new UploadValidationError('The file is empty.');
	if (file.size > MAX_LOGO_BYTES) throw new UploadValidationError('The logo must be 2 MB or smaller.');
	const ext = LOGO_TYPES[file.type];
	if (!ext) throw new UploadValidationError('Use a PNG, JPEG or WebP image.');
	await mkdir(LOGO_DIR, { recursive: true });
	const name = `${ulid()}.${ext}`;
	await writeFile(path.join(LOGO_DIR, name), Buffer.from(await file.arrayBuffer()));
	return name;
}

export function logoFilePath(name: string): string | null {
	return LOGO_NAME_RE.test(name) ? path.join(LOGO_DIR, name) : null;
}

export async function deleteLogoFile(name: string): Promise<void> {
	const p = logoFilePath(name);
	if (!p) return;
	try {
		await unlink(p);
	} catch {
		// Already gone — fine either way.
	}
}
