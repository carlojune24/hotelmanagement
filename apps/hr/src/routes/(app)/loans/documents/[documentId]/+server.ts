import { readFile } from 'node:fs/promises';
import { error } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { getOrganization } from '$lib/server/establishments';
import { LoanError, getDocument } from '$lib/server/hr/loans';
import { loanDocumentPath } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

/** A loan agreement or voucher — financial and personal, so payroll users only (not the public /uploads route). */
export const GET: RequestHandler = async ({ params, locals }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	const org = await getOrganization();
	let doc;
	try {
		doc = await getDocument(org.id, params.documentId);
	} catch (e) {
		if (e instanceof LoanError) error(404, 'Not found');
		throw e;
	}
	const filePath = loanDocumentPath(doc.storedName);
	if (!filePath) error(404, 'Not found');
	try {
		const bytes = await readFile(filePath);
		const safeName = doc.originalName.replace(/[^\w.\- ]+/g, '_');
		return new Response(bytes, {
			headers: {
				'content-type': doc.contentType,
				'content-disposition': `inline; filename="${safeName}"`,
				'cache-control': 'private, no-store',
				'x-content-type-options': 'nosniff'
			}
		});
	} catch {
		error(404, 'Not found');
	}
};
