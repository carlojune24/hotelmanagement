import { readFile } from 'node:fs/promises';
import { error } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { getOrganization } from '$lib/server/establishments';
import { ContractError, getContract } from '$lib/server/hr/contracts';
import { contractDocumentPath } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

/** The signed copy of a contract: personal and about pay, so Main HR only and never the public /uploads route. */
export const GET: RequestHandler = async ({ params, locals }) => {
	requireCap(locals.user, locals.access, 'employee:write');
	const org = await getOrganization();
	let c;
	try {
		c = await getContract(org.id, params.id);
	} catch (e) {
		if (e instanceof ContractError) error(404, 'Not found');
		throw e;
	}
	if (!c.storedName) error(404, 'Not found');
	const filePath = contractDocumentPath(c.storedName);
	if (!filePath) error(404, 'Not found');
	try {
		const bytes = await readFile(filePath);
		const safeName = (c.originalName ?? 'contract').replace(/[^\w.\- ]+/g, '_');
		return new Response(bytes, {
			headers: {
				'content-type': c.contentType ?? 'application/octet-stream',
				'content-disposition': `inline; filename="${safeName}"`,
				'cache-control': 'private, no-store',
				'x-content-type-options': 'nosniff'
			}
		});
	} catch {
		error(404, 'Not found');
	}
};
