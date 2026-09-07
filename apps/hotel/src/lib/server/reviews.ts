import { and, desc, eq } from 'drizzle-orm';
import { db } from './db/index';
import { reviews } from './db/schema/index';

export interface PublicReview {
	rating: number;
	comment: string;
	guestDisplayName: string;
	submittedAt: Date;
}

/** Real, moderated guest reviews for the storefront — never fabricated, and only ones staff approved. */
export async function listApprovedReviews(hotelId: string, limit = 12): Promise<PublicReview[]> {
	const rows = await db
		.select({
			rating: reviews.rating,
			comment: reviews.comment,
			guestDisplayName: reviews.guestDisplayName,
			submittedAt: reviews.submittedAt
		})
		.from(reviews)
		.where(and(eq(reviews.hotelId, hotelId), eq(reviews.status, 'approved')))
		.orderBy(desc(reviews.submittedAt))
		.limit(limit);
	return rows;
}
