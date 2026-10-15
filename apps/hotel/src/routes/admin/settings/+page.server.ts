import { fail } from '@sveltejs/kit';
import { requirePlatformAdmin } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getPlatformLogo, removePlatformLogo, setPlatformLogo } from '$lib/server/platform-brand';
import { UploadValidationError } from '$lib/server/uploads';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ logoUrl: await getPlatformLogo() });

export const actions: Actions = {
	uploadLogo: async (event) => {
		requirePlatformAdmin(event.locals.user);
		const file = (await event.request.formData()).get('logo');
		if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'Choose an image to upload.' });
		try {
			await setPlatformLogo(file);
		} catch (e) {
			if (e instanceof UploadValidationError) return fail(400, { error: e.message });
			throw e;
		}
		await writeAudit({ actor: event.locals.user, action: 'platform.logo_set', entityType: 'platform_settings' });
		return { ok: 'Logo updated.' };
	},
	removeLogo: async (event) => {
		requirePlatformAdmin(event.locals.user);
		await removePlatformLogo();
		await writeAudit({ actor: event.locals.user, action: 'platform.logo_remove', entityType: 'platform_settings' });
		return { ok: 'Logo removed.' };
	}
};
