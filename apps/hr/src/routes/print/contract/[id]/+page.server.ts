import { error } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { requireCap, requireUser } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getOrganization } from '$lib/server/establishments';
import { ContractError, ensureVerifyCode, fingerprintOf, getContract, splitSignatures } from '$lib/server/hr/contracts';
import type { PageServerLoad } from './$types';

/** A contract as issued, for signing. Main HR only (it states pay); every print is audited. */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireUser(locals.user, url.pathname);
	requireCap(locals.user, locals.access, 'employee:write');
	const org = await getOrganization();
	let c;
	try {
		c = await getContract(org.id, params.id);
	} catch (e) {
		if (e instanceof ContractError) error(404, 'Not found');
		throw e;
	}
	await writeAudit({ actor: locals.user, action: 'contract.print', entityType: 'employee_contract', entityId: c.id });
	// A QR to the public verify page, so a printed copy can be checked against the record.
	const code = await ensureVerifyCode(org.id, c.id);
	const verifyUrl = `${url.origin}/verify/contract/${code}`;
	const qr = await QRCode.toString(verifyUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
	const parts = splitSignatures(c.body);
	return {
		body: parts?.text ?? c.body,
		signatures: parts?.blocks ?? [],
		status: c.status,
		employeeName: c.employeeName,
		issuedOn: c.issuedOn,
		qr,
		verifyUrl,
		fingerprint: fingerprintOf(c.body)
	};
};
