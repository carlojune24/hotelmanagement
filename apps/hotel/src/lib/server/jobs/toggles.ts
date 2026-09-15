import { and, eq } from 'drizzle-orm';
import { db } from '../db/index';
import { hotels, jobToggles } from '../db/schema/index';
import type { SessionUser } from '../auth/session';

/**
 * Closed, additive list of scheduled jobs a hotel can toggle. `label`/`description`
 * back the Settings → Automation UI; `defaultEnabled` is what applies when a hotel
 * has no `job_toggles` row yet for that key (no backfill/seeding needed).
 */
export const JOB_DEFS = {
	hold_sweep: {
		label: 'Expire abandoned holds',
		description: 'Cancels pending-payment bookings once their hold window has passed.',
		defaultEnabled: true
	},
	recurring_expenses: {
		label: 'Generate due recurring expenses',
		description: 'Creates each due recurring expense automatically instead of waiting for the "Generate due" button.',
		defaultEnabled: true
	},
	no_show_autoflag: {
		label: 'Auto-flag no-shows',
		description: "Marks a confirmed arrival no-show once its check-in date has fully passed with no check-in.",
		defaultEnabled: true
	},
	auto_day_close: {
		label: 'Auto-close the business day',
		description:
			"Closes yesterday's business day and issues its Z-reading once every cashier shift for it is closed — instead of waiting for the \"Close day\" button. A day with a shift still open is left for staff to close by hand.",
		// Off by default, unlike the jobs above: closing a day issues a permanent,
		// sequentially-numbered Z-reading (BIR keeps every one, none can be deleted),
		// so a hotel opts in deliberately rather than getting it silently on.
		defaultEnabled: false
	}
} as const;

export type JobKey = keyof typeof JOB_DEFS;
export const JOB_KEYS = Object.keys(JOB_DEFS) as JobKey[];

/** Whether `jobKey` should run for `hotelId` — the job's own default when no row exists. */
export async function isJobEnabled(hotelId: string, jobKey: JobKey): Promise<boolean> {
	const [row] = await db
		.select({ enabled: jobToggles.enabled })
		.from(jobToggles)
		.where(and(eq(jobToggles.hotelId, hotelId), eq(jobToggles.jobKey, jobKey)))
		.limit(1);
	return row?.enabled ?? JOB_DEFS[jobKey].defaultEnabled;
}

/** Every hotel id where `jobKey` is enabled (explicitly or by default) — for a job
 *  that sweeps across all tenants. */
export async function getEnabledHotelIds(jobKey: JobKey): Promise<string[]> {
	const [allHotels, toggledOff] = await Promise.all([
		db.select({ id: hotels.id }).from(hotels),
		db
			.select({ hotelId: jobToggles.hotelId })
			.from(jobToggles)
			.where(and(eq(jobToggles.jobKey, jobKey), eq(jobToggles.enabled, false)))
	]);
	if (JOB_DEFS[jobKey].defaultEnabled) {
		const off = new Set(toggledOff.map((r) => r.hotelId));
		return allHotels.map((h) => h.id).filter((id) => !off.has(id));
	}
	// Default is off: only hotels with an explicit enabled=true row qualify.
	const on = await db
		.select({ hotelId: jobToggles.hotelId })
		.from(jobToggles)
		.where(and(eq(jobToggles.jobKey, jobKey), eq(jobToggles.enabled, true)));
	return on.map((r) => r.hotelId);
}

export async function listJobTogglesForHotel(hotelId: string) {
	const rows = await db
		.select({ jobKey: jobToggles.jobKey, enabled: jobToggles.enabled })
		.from(jobToggles)
		.where(eq(jobToggles.hotelId, hotelId));
	const overrides = new Map(rows.map((r) => [r.jobKey, r.enabled]));
	return JOB_KEYS.map((key) => ({
		key,
		...JOB_DEFS[key],
		enabled: overrides.get(key) ?? JOB_DEFS[key].defaultEnabled
	}));
}

export async function setJobToggle(
	hotelId: string,
	jobKey: JobKey,
	enabled: boolean,
	actor: SessionUser | null
): Promise<void> {
	await db
		.insert(jobToggles)
		.values({ hotelId, jobKey, enabled, updatedByUserId: actor?.id ?? null })
		.onConflictDoUpdate({
			target: [jobToggles.hotelId, jobToggles.jobKey],
			set: { enabled, updatedAt: new Date(), updatedByUserId: actor?.id ?? null }
		});
}
