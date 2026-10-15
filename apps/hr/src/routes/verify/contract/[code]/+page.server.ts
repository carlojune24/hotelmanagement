import { publicContractByCode } from '$lib/server/hr/contracts';
import type { PageServerLoad } from './$types';

/**
 * Public: anyone holding the printed contract can scan its QR and see that it is genuine and whether it is still
 * in force. Found by an unguessable code; shows no pay, address or contact details, and a masked name.
 */
export const load: PageServerLoad = async ({ params, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
	return { contract: await publicContractByCode(params.code) };
};
