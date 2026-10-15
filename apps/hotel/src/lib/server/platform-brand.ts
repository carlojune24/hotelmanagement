import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { platformSettings } from '$lib/server/db/schema/index';
import { deleteUploadIfOwned, saveResizedImage, saveUpload } from '$lib/server/uploads';

const KEY = 'brand';
/** Upload bucket for platform-level files; the public /uploads route serves it like any hotel id. */
const BUCKET = 'platform';

export type PlatformImage = 'logo' | 'hero';
export interface PlatformBrand {
	logoUrl: string | null;
	heroImageUrl: string | null;
}

export async function getPlatformBrand(): Promise<PlatformBrand> {
	const [row] = await db.select({ value: platformSettings.value }).from(platformSettings).where(eq(platformSettings.key, KEY));
	const v = (row?.value ?? {}) as Partial<PlatformBrand>;
	return { logoUrl: v.logoUrl ?? null, heroImageUrl: v.heroImageUrl ?? null };
}

async function store(brand: PlatformBrand) {
	await db
		.insert(platformSettings)
		.values({ key: KEY, value: brand })
		.onConflictDoUpdate({ target: platformSettings.key, set: { value: brand, updatedAt: new Date() } });
}

const FIELD = { logo: 'logoUrl', hero: 'heroImageUrl' } as const;

/** Replaces one image and removes its previous file. Throws `UploadValidationError` on a bad file. */
export async function setPlatformImage(kind: PlatformImage, file: File) {
	const brand = await getPlatformBrand();
	const old = brand[FIELD[kind]];
	// The hero is a big photo: re-encode so a phone original never reaches a visitor.
	brand[FIELD[kind]] = kind === 'hero' ? await saveResizedImage(BUCKET, file, 2400) : await saveUpload(BUCKET, file);
	await store(brand);
	await deleteUploadIfOwned(old);
}

export async function removePlatformImage(kind: PlatformImage) {
	const brand = await getPlatformBrand();
	const old = brand[FIELD[kind]];
	brand[FIELD[kind]] = null;
	await store(brand);
	await deleteUploadIfOwned(old);
}
