import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index';
import { hrConnections, type HrConnection } from '../db/schema/index';
import { decryptSecret, encryptSecret, maskSecret } from '../secrets';

/**
 * The hotel's only contact with the separate HR app: read-only, one API key per hotel, issued by
 * Main HR (docs/HR_PLAN.md §4–5). Nothing here is required for the hotel to run — with no
 * connection, or HR down, Team simply loses its employee picker and nothing else changes.
 */

export type HrLinkErrorKind = 'not_connected' | 'unreachable' | 'unauthorized' | 'bad_response';

export class HrLinkError extends Error {
	constructor(
		public kind: HrLinkErrorKind,
		message: string
	) {
		super(message);
	}
}

const personSchema = z.object({
	person_ref: z.string(),
	employee_no: z.string(),
	first_name: z.string(),
	last_name: z.string(),
	email: z.string().nullable(),
	status: z.string(),
	position: z.string().nullable(),
	department: z.string().nullable(),
	assigned: z.boolean()
});
export type HrPerson = z.infer<typeof personSchema>;

const responseSchema = z.object({
	establishment: z.object({ org_ref: z.string(), name: z.string() }),
	employees: z.array(personSchema)
});

/** Pure: an origin like `https://hr.example.com`. Plain http is only for a local dev HR app. */
export function normalizeBaseUrl(raw: string): string {
	let u: URL;
	try {
		u = new URL(raw.trim());
	} catch {
		throw new HrLinkError('bad_response', 'Enter the HR app address, e.g. https://hr.yourcompany.com');
	}
	const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
	if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
		throw new HrLinkError('bad_response', 'The HR app address must start with https://');
	}
	return u.origin;
}

export async function getConnection(hotelId: string): Promise<HrConnection | null> {
	return db
		.select()
		.from(hrConnections)
		.where(eq(hrConnections.hotelId, hotelId))
		.then((r) => r.at(0) ?? null);
}

async function call(baseUrl: string, apiKey: string, query = ''): Promise<z.infer<typeof responseSchema>> {
	let res: Response;
	try {
		res = await fetch(`${baseUrl}/api/v1/hr/employees${query}`, {
			headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
			signal: AbortSignal.timeout(8000)
		});
	} catch {
		throw new HrLinkError('unreachable', `Couldn't reach the HR app at ${baseUrl}.`);
	}
	if (res.status === 401) {
		throw new HrLinkError('unauthorized', 'HR did not accept this key. Ask Main HR to issue a new one.');
	}
	if (!res.ok) throw new HrLinkError('unreachable', `The HR app answered with an error (${res.status}).`);
	const parsed = responseSchema.safeParse(await res.json().catch(() => null));
	if (!parsed.success) throw new HrLinkError('bad_response', "That address doesn't look like the HR app.");
	return parsed.data;
}

async function noteContact(hotelId: string, error: string | null) {
	await db
		.update(hrConnections)
		.set({ lastError: error, ...(error ? {} : { lastSyncAt: new Date() }), updatedAt: new Date() })
		.where(eq(hrConnections.hotelId, hotelId));
}

async function withConnection<T>(
	hotelId: string,
	query: string,
	pick: (r: z.infer<typeof responseSchema>) => T
): Promise<T> {
	const conn = await getConnection(hotelId);
	if (!conn) throw new HrLinkError('not_connected', 'This hotel is not connected to HR yet.');
	try {
		const data = await call(conn.baseUrl, decryptSecret(conn.apiKeyEnc), query);
		await noteContact(hotelId, null);
		return pick(data);
	} catch (e) {
		if (e instanceof HrLinkError) await noteContact(hotelId, e.message).catch(() => {});
		throw e;
	}
}

/** The people HR currently has assigned to this hotel (the Team picker's list). */
export function fetchAssigned(hotelId: string): Promise<HrPerson[]> {
	return withConnection(hotelId, '', (r) => r.employees);
}

/** The state of specific linked people — status and whether they are still assigned here. */
export function fetchPeople(hotelId: string, refs: string[]): Promise<HrPerson[]> {
	if (refs.length === 0) return Promise.resolve([]);
	return withConnection(hotelId, `?person_refs=${encodeURIComponent(refs.join(','))}`, (r) => r.employees);
}

/** Validates the key against HR first, then stores it encrypted. Replaces any earlier connection. */
export async function saveConnection(
	hotelId: string,
	baseUrlRaw: string,
	apiKey: string,
	userId: string | null
): Promise<{ establishmentName: string }> {
	const baseUrl = normalizeBaseUrl(baseUrlRaw);
	const key = apiKey.trim();
	if (!key) throw new HrLinkError('unauthorized', 'Paste the key Main HR gave you.');
	const probe = await call(baseUrl, key); // throws a specific, readable HrLinkError
	const values = {
		baseUrl,
		apiKeyEnc: encryptSecret(key),
		apiKeyHint: maskSecret(key),
		establishmentName: probe.establishment.name,
		lastSyncAt: new Date(),
		lastError: null,
		connectedByUserId: userId,
		updatedAt: new Date()
	};
	await db
		.insert(hrConnections)
		.values({ hotelId, ...values })
		.onConflictDoUpdate({ target: hrConnections.hotelId, set: values });
	return { establishmentName: probe.establishment.name };
}

export async function removeConnection(hotelId: string) {
	await db.delete(hrConnections).where(eq(hrConnections.hotelId, hotelId));
}
