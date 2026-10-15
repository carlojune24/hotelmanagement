import { fail } from '@sveltejs/kit';
import { requirePlatformAdmin } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getPlatformBrand, removePlatformImage, setPlatformImage, type PlatformImage } from '$lib/server/platform-brand';
import { UploadValidationError } from '$lib/server/uploads';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ brand: await getPlatformBrand() });

const kindOf = (v: FormDataEntryValue | null): PlatformImage | null => (v === 'logo' || v === 'hero' ? v : null);

export const actions: Actions = {
	upload: async (event) => {
		requirePlatformAdmin(event.locals.user);
		const form = await event.request.formData();
		const kind = kindOf(form.get('kind'));
		const file = form.get('file');
		if (!kind) return fail(400, { error: 'Unknown image.' });
		if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'Choose an image to upload.' });
		try {
			await setPlatformImage(kind, file);
		} catch (e) {
			if (e instanceof UploadValidationError) return fail(400, { error: e.message });
			throw e;
		}
		await writeAudit({ actor: event.locals.user, action: `platform.${kind}_set`, entityType: 'platform_settings' });
		return { ok: kind === 'logo' ? 'Logo updated.' : 'Hero photo updated.' };
	},
	remove: async (event) => {
		requirePlatformAdmin(event.locals.user);
		const kind = kindOf((await event.request.formData()).get('kind'));
		if (!kind) return fail(400, { error: 'Unknown image.' });
		await removePlatformImage(kind);
		await writeAudit({ actor: event.locals.user, action: `platform.${kind}_remove`, entityType: 'platform_settings' });
		return { ok: kind === 'logo' ? 'Logo removed.' : 'Hero photo removed.' };
	}
};
