import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getOrganization } from '$lib/server/establishments';
import { ContractError, attachSigned, getContract, splitSignatures, voidContract } from '$lib/server/hr/contracts';
import { UploadValidationError } from '$lib/server/uploads';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.access, 'employee:write');
	const org = await getOrganization();
	try {
		const c = await getContract(org.id, params.id);
		return {
			contract: {
				id: c.id,
				employeeId: c.employeeId,
				employeeName: c.employeeName,
				employeeNo: c.employeeNo,
				kind: c.kind,
				position: c.position,
				payBasis: c.payBasis,
				baseRateCentavos: c.baseRateCentavos,
				startDate: c.startDate,
				endDate: c.endDate,
				body: splitSignatures(c.body)?.text ?? c.body,
				status: c.status as 'issued' | 'signed' | 'void',
				issuedOn: c.issuedOn,
				signedOn: c.signedOn,
				fileName: c.originalName,
				fileSize: c.sizeBytes,
				hasFile: !!c.storedName,
				voidReason: c.voidReason
			}
		};
	} catch (e) {
		if (e instanceof ContractError) error(404, 'Not found');
		throw e;
	}
};

export const actions: Actions = {
	sign: async ({ request, locals, params }) => {
		requireCap(locals.user, locals.access, 'employee:write');
		const fd = await request.formData();
		const file = fd.get('file');
		if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'Choose the signed copy to upload.' });
		const signedOn = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(fd.get('signedOn'));
		try {
			const org = await getOrganization();
			await attachSigned(org.id, params.id, file, signedOn.success ? signedOn.data : null);
			await writeAudit({ actor: locals.user, action: 'contract.sign', entityType: 'employee_contract', entityId: params.id });
			return { ok: 'Signed copy saved.' };
		} catch (e) {
			if (e instanceof ContractError || e instanceof UploadValidationError) return fail(400, { error: e.message });
			throw e;
		}
	},

	void: async ({ request, locals, params }) => {
		requireCap(locals.user, locals.access, 'employee:write');
		const reason = String((await request.formData()).get('reason') ?? '');
		try {
			const org = await getOrganization();
			await voidContract(org.id, params.id, reason);
			await writeAudit({
				actor: locals.user,
				action: 'contract.void',
				entityType: 'employee_contract',
				entityId: params.id,
				after: { reason }
			});
			return { ok: 'Contract voided.' };
		} catch (e) {
			if (e instanceof ContractError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
