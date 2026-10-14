import { logoUrlFor } from '$lib/server/brand';
import { getOrganization } from '$lib/server/establishments';
import type { LayoutServerLoad } from './$types';

/** Every print page can show the company logo in its header. */
export const load: LayoutServerLoad = async () => {
	const org = await getOrganization().catch(() => null);
	return { logoUrl: logoUrlFor(org?.config) };
};
