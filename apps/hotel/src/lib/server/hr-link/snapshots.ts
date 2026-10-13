import { sql } from 'drizzle-orm';
import { db } from '../db/index';
import { hrPersonSnapshots } from '../db/schema/index';
import type { HrPerson } from './client';

/** Display-only copy of who HR says these people are; HR remains the authority. */
export async function saveSnapshots(hotelId: string, people: HrPerson[]) {
	if (people.length === 0) return;
	await db
		.insert(hrPersonSnapshots)
		.values(
			people.map((p) => ({
				hotelId,
				personRef: p.person_ref,
				fullName: `${p.first_name} ${p.last_name}`.trim(),
				employeeNo: p.employee_no,
				position: p.position,
				department: p.department
			}))
		)
		.onConflictDoUpdate({
			target: [hrPersonSnapshots.hotelId, hrPersonSnapshots.personRef],
			set: {
				fullName: sql`excluded.full_name`,
				employeeNo: sql`excluded.employee_no`,
				position: sql`excluded.position`,
				department: sql`excluded.department`,
				syncedAt: sql`now()`
			}
		});
}
