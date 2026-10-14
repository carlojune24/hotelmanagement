import { and, desc, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { announcements } from '$lib/server/db/schema/index';

export class AnnouncementError extends Error {}

export const announcementSchema = z.object({
	title: z.string().trim().min(2, 'Give the announcement a title.').max(120),
	body: z.string().trim().min(2, 'Write the announcement.').max(4000),
	/** Blank = every establishment. */
	establishmentIds: z.array(z.string().uuid()).default([]),
	pinned: z.boolean().default(false),
	expiresOn: z.preprocess(
		(v) => (v === '' || v === null || v === undefined ? null : v),
		z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date.').nullable()
	)
});
export type AnnouncementInput = z.infer<typeof announcementSchema>;

const audienceOf = (ids: string[]) => (ids.length ? ids : null);

export async function createAnnouncement(organizationId: string, input: AnnouncementInput, userId: string | null) {
	const [row] = await db
		.insert(announcements)
		.values({
			organizationId,
			title: input.title,
			body: input.body,
			audience: audienceOf(input.establishmentIds),
			pinned: input.pinned,
			expiresOn: input.expiresOn,
			createdByUserId: userId
		})
		.returning();
	return row!;
}

export async function updateAnnouncement(organizationId: string, id: string, input: AnnouncementInput) {
	const [row] = await db
		.update(announcements)
		.set({
			title: input.title,
			body: input.body,
			audience: audienceOf(input.establishmentIds),
			pinned: input.pinned,
			expiresOn: input.expiresOn,
			updatedAt: new Date()
		})
		.where(and(eq(announcements.id, id), eq(announcements.organizationId, organizationId)))
		.returning();
	if (!row) throw new AnnouncementError('That announcement does not exist.');
	return row;
}

export async function setAnnouncementStatus(organizationId: string, id: string, status: 'active' | 'archived') {
	const [row] = await db
		.update(announcements)
		.set({ status, updatedAt: new Date() })
		.where(and(eq(announcements.id, id), eq(announcements.organizationId, organizationId)))
		.returning();
	if (!row) throw new AnnouncementError('That announcement does not exist.');
	return row;
}

/** Everything Main HR has posted, newest first (the management view). */
export async function listAnnouncements(organizationId: string) {
	return db
		.select()
		.from(announcements)
		.where(eq(announcements.organizationId, organizationId))
		.orderBy(desc(announcements.createdAt));
}

/** What an establishment's dashboard shows: active, not expired, addressed to it or to everyone. */
export async function announcementsFor(organizationId: string, establishmentId: string, today: string) {
	return db
		.select({
			id: announcements.id,
			title: announcements.title,
			body: announcements.body,
			pinned: announcements.pinned,
			createdAt: announcements.createdAt,
			expiresOn: announcements.expiresOn
		})
		.from(announcements)
		.where(
			and(
				eq(announcements.organizationId, organizationId),
				eq(announcements.status, 'active'),
				or(isNull(announcements.expiresOn), gte(announcements.expiresOn, today)),
				or(
					isNull(announcements.audience),
					sql`${announcements.audience} @> ${JSON.stringify([establishmentId])}::jsonb`
				)
			)
		)
		.orderBy(desc(announcements.pinned), desc(announcements.createdAt));
}
