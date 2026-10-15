import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { platformSettings } from '$lib/server/db/schema/index';
import { deleteUploadIfOwned, saveUpload } from '$lib/server/uploads';

const KEY = 'brand';
/** Upload bucket for platform-level files; the public /uploads route serves it like any hotel id. */
const BUCKET = 'platform';

export async function getPlatformLogo(): Promise<string | null> {
	const [row] = await db.select({ value: platformSettings.value }).from(platformSettings).where(eq(platformSettings.key, KEY));
	return (row?.value as { logoUrl?: string } | undefined)?.logoUrl ?? null;
}

async function store(logoUrl: string | null) {
	const value = { logoUrl };
	await db
		.insert(platformSettings)
		.values({ key: KEY, value })
		.onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: new Date() } });
}

/** Saves a new logo and removes the previous file. Throws `UploadValidationError` on a bad file. */
export async function setPlatformLogo(file: File) {
	const old = await getPlatformLogo();
	await store(await saveUpload(BUCKET, file));
	await deleteUploadIfOwned(old);
}

export async function removePlatformLogo() {
	const old = await getPlatformLogo();
	await store(null);
	await deleteUploadIfOwned(old);
}
