import { fail } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { businessDateFor } from '$lib/server/finance/shared';
import {
	DtrImportError,
	addManualPunch,
	addPunchSchema,
	createImportTemplate,
	deleteImportTemplate,
	getImportTemplate,
	listImportTemplates,
	listPunchIds,
	listPunchesForId,
	listUploads,
	mappingSchema,
	monthSchema,
	removePunch,
	removeUpload,
	storePunches,
	templateFormSchema,
	type ImportMapping
} from '$lib/server/hr/dtr-import';
import { ParseSheetError, parseImportFile } from '$lib/server/hr/parse-sheet';
import { normalizeEnrollId } from '$lib/hr-import';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'dtr:*');
	const hotel = locals.hotel!;

	const monthParam = url.searchParams.get('month');
	const month =
		monthParam && monthSchema.safeParse(monthParam).success
			? monthParam
			: businessDateFor(hotel.timezone).slice(0, 7);

	const [uploads, ids, templates] = await Promise.all([
		listUploads(hotel.id, month),
		listPunchIds(hotel.id, month),
		listImportTemplates(hotel.id)
	]);

	const requested = url.searchParams.get('id');
	const selected = ids.find((i) => i.enrollKey === requested) ?? ids[0] ?? null;
	const punches = selected ? await listPunchesForId(hotel.id, month, selected.enrollKey) : [];

	return { month, uploads, ids, selected, punches, templates, timezone: hotel.timezone };
};

/** The uploaded file plus the mapping to read it with — a saved template, or the two columns picked now. */
async function readImportRequest(event: Parameters<Actions[string]>[0]) {
	const hotelId = event.locals.hotel!.id;
	const fd = await event.request.formData();
	const file = fd.get('file');
	if (!(file instanceof File) || file.size === 0) throw new DtrImportError('Choose a file to upload.');
	const rows = await parseImportFile(file);

	let mapping: ImportMapping;
	const templateId = fd.get('templateId');
	if (typeof templateId === 'string' && templateId) {
		const t = await getImportTemplate(hotelId, templateId);
		if (!t) throw new DtrImportError('That template no longer exists.');
		mapping = {
			idColumn: t.idColumn,
			datetimeColumn: t.datetimeColumn,
			hasHeader: t.hasHeader,
			dateFormat: t.dateFormat as ImportMapping['dateFormat']
		};
	} else {
		const parsed = mappingSchema.safeParse({
			idColumn: fd.get('idColumn'),
			datetimeColumn: fd.get('datetimeColumn'),
			hasHeader: fd.get('hasHeader') === 'true',
			dateFormat: fd.get('dateFormat') || 'auto'
		});
		if (!parsed.success || parsed.data.idColumn === parsed.data.datetimeColumn) {
			throw new DtrImportError('Pick the Biometric ID column and the Date/time column.');
		}
		mapping = parsed.data;
	}
	return { hotelId, fd, file, rows, mapping };
}

function importFailure(e: unknown) {
	if (e instanceof DtrImportError || e instanceof ParseSheetError) return fail(400, { importError: e.message });
	throw e;
}

export const actions: Actions = {
	importInspect: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dtr:*');
		try {
			const fd = await event.request.formData();
			const file = fd.get('file');
			if (!(file instanceof File) || file.size === 0) throw new DtrImportError('Choose a file to upload.');
			const rows = await parseImportFile(file);
			return {
				importStep: 'inspect' as const,
				sample: rows.slice(0, 8),
				totalRows: rows.length,
				columnCount: Math.max(...rows.slice(0, 50).map((r) => r.length))
			};
		} catch (e) {
			return importFailure(e);
		}
	},

	/** Stores every readable punch in the file, filed under the chosen year-month. */
	importStore: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dtr:*');
		try {
			const { hotelId, fd, file, rows, mapping } = await readImportRequest(event);
			const period = monthSchema.safeParse(fd.get('period'));
			if (!period.success) throw new DtrImportError('Pick the year and month for this file.');
			const saveName = fd.get('saveName');
			let savedTemplate: { id: string; name: string } | null = null;
			if (typeof saveName === 'string' && saveName.trim() && !fd.get('templateId')) {
				const parsed = templateFormSchema.safeParse({ ...mapping, name: saveName });
				if (!parsed.success) throw new DtrImportError(parsed.error.issues[0]!.message);
				const t = await createImportTemplate(hotelId, parsed.data);
				savedTemplate = { id: t.id, name: t.name };
			}
			const result = await storePunches(
				hotelId,
				rows,
				mapping,
				file.name,
				period.data,
				event.locals.user?.id ?? null
			);
			await writeAudit({
				hotelId,
				actor: event.locals.user,
				action: 'dtr.import_punches',
				entityType: 'biometric_punch',
				entityId: null,
				after: {
					file: file.name,
					period: period.data,
					punches: result.total,
					inserted: result.inserted,
					duplicates: result.duplicates
				}
			});
			return { importStep: 'stored' as const, result, savedTemplate };
		} catch (e) {
			return importFailure(e);
		}
	},

	importTemplateDelete: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dtr:*');
		const fd = await event.request.formData();
		const id = fd.get('id');
		if (typeof id !== 'string') return fail(400, { importError: 'Missing template.' });
		await deleteImportTemplate(event.locals.hotel!.id, id);
		return { importStep: 'templateDeleted' as const, ok: 'Template removed.' };
	},

	removeUpload: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dtr:*');
		const hotelId = event.locals.hotel!.id;
		const id = (await event.request.formData()).get('id');
		if (typeof id !== 'string') return fail(400, { error: 'Missing file.' });
		const gone = await removeUpload(hotelId, id);
		if (!gone) return fail(404, { error: 'That file is already gone.' });
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dtr.remove_upload',
			entityType: 'biometric_upload',
			entityId: id,
			after: { file: gone.fileName, punches: gone.punchCount }
		});
		return { ok: `Removed ${gone.fileName}.` };
	},

	removePunch: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dtr:*');
		const hotelId = event.locals.hotel!.id;
		const id = (await event.request.formData()).get('id');
		if (typeof id !== 'string') return fail(400, { error: 'Missing punch.' });
		await removePunch(hotelId, id);
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dtr.remove_punch',
			entityType: 'biometric_punch',
			entityId: id
		});
		return { ok: 'Punch removed.' };
	},

	/** A forgotten punch, for any Biometric ID (matched to an employee or not). */
	addPunch: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dtr:*');
		try {
			const hotelId = event.locals.hotel!.id;
			const parsed = addPunchSchema.safeParse(Object.fromEntries(await event.request.formData()));
			if (!parsed.success) throw new DtrImportError(parsed.error.issues[0]!.message);
			const p = await addManualPunch(hotelId, parsed.data, event.locals.user?.id ?? null);
			await writeAudit({
				hotelId,
				actor: event.locals.user,
				action: 'dtr.add_punch',
				entityType: 'biometric_punch',
				entityId: p.id,
				after: parsed.data
			});
			return { ok: 'Time added.', addedKey: normalizeEnrollId(parsed.data.enrollId) };
		} catch (e) {
			if (e instanceof DtrImportError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
