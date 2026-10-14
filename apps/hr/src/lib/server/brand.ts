import { eq } from 'drizzle-orm';
import { db } from './db';
import { organizations } from './db/schema';
import { deleteLogoFile, saveLogoFile } from './uploads';

/** The company logo is one file named in org config (`logoFile`), served publicly from `/brand/<name>`. */
export function logoUrlFor(config: unknown): string | null {
	const name = (config as { logoFile?: unknown } | null | undefined)?.logoFile;
	return typeof name === 'string' ? `/brand/${name}` : null;
}

async function writeConfig(org: { id: string; config: unknown }, logoFile: string | null) {
	const { logoFile: _old, ...rest } = (org.config ?? {}) as Record<string, unknown>;
	await db
		.update(organizations)
		.set({ config: logoFile ? { ...rest, logoFile } : rest, updatedAt: new Date() })
		.where(eq(organizations.id, org.id));
}

export async function setLogo(org: { id: string; config: unknown }, file: File) {
	const previous = (org.config as { logoFile?: string } | null)?.logoFile;
	const name = await saveLogoFile(file);
	await writeConfig(org, name);
	if (previous) await deleteLogoFile(previous);
}

export async function removeLogo(org: { id: string; config: unknown }) {
	const previous = (org.config as { logoFile?: string } | null)?.logoFile;
	await writeConfig(org, null);
	if (previous) await deleteLogoFile(previous);
}
