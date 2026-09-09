import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { roleCan } from '$lib/authz';
import { DocumentError, cancelDocument, listDocuments } from '$lib/server/finance/documents';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const typeParam = url.searchParams.get('type');
	const type = typeParam === 'invoice' || typeParam === 'official_receipt' ? typeParam : undefined;
	const documents = await listDocuments(locals.hotel!.id, type ? { type } : undefined);
	const canWrite =
		(locals.user?.isPlatformAdmin ?? false) ||
		(locals.role ? roleCan(locals.role, 'finance:write') : false);
	return { documents, type: type ?? 'all', canWrite };
};

export const actions: Actions = {
	cancel: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'finance:write');
		const parsed = z
			.object({
				documentId: z.string().uuid(),
				reason: z.string().trim().min(3).max(400),
				issueReplacement: z.union([z.literal('on'), z.undefined()]).transform((v) => v === 'on')
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Enter a cancellation reason (3+ characters).' });

		try {
			const { cancelled, replacement } = await cancelDocument(
				event.locals.hotel!.id,
				parsed.data.documentId,
				parsed.data.reason,
				event.locals.user ?? null,
				{ issueReplacement: parsed.data.issueReplacement }
			);
			return {
				ok: replacement
					? `${cancelled.formattedNo} cancelled — replacement ${replacement.formattedNo} issued.`
					: `${cancelled.formattedNo} cancelled.`
			};
		} catch (e) {
			if (e instanceof DocumentError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
