import PgBoss from 'pg-boss';
import { env } from '$env/dynamic/private';
import {
	runAutoDayClose,
	runErrorLogRetentionJob,
	runHoldSweep,
	runNoShowAutoflag,
	runRecurringExpenses,
	type JobRunSummary
} from './tasks';

/**
 * The background job runner — one `pg-boss` instance per server process, backed
 * by the same Postgres database (it manages its own `pgboss` schema there, no
 * separate DB needed). Cron schedules run in UTC; each task loops over hotels and
 * applies *that hotel's own* timezone/business-date internally (see `tasks.ts`),
 * so a coarse shared cadence is enough — no per-hotel-timezone scheduling needed.
 *
 * Safe to call `startJobRunner()` more than once per process (e.g. a dev-mode
 * server-file reload) — memoized, so it starts at most one real `PgBoss` instance.
 * The memo lives on `globalThis`, not a module-level variable: Vite HMR re-executes
 * this module on reload, which would otherwise reset a module-level memo and start
 * a fresh `PgBoss` (and its connection pool) on every save, leaking connections
 * until Postgres hits its connection limit.
 */

declare global {
	// eslint-disable-next-line no-var
	var __mmhotelJobRunnerPromise: Promise<PgBoss> | undefined;
}

const QUEUES = {
	hold_sweep: { cron: '*/15 * * * *', run: runHoldSweep },
	recurring_expenses: { cron: '0 * * * *', run: runRecurringExpenses },
	no_show_autoflag: { cron: '0 * * * *', run: runNoShowAutoflag },
	// Hourly, not once nightly: it only ever targets "yesterday" and no-ops once that
	// day is closed, so running more often just means a hotel whose shifts close late
	// gets picked up within the hour instead of waiting for a fixed nightly slot.
	auto_day_close: { cron: '0 * * * *', run: runAutoDayClose },
	error_log_retention: { cron: '30 3 * * *', run: runErrorLogRetentionJob }
} as const;

async function boot(): Promise<PgBoss> {
	const url = env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set');

	const boss = new PgBoss(url);
	boss.on('error', (err) => console.error('[jobs] pg-boss error:', err));

	await boss.start();

	for (const [name, def] of Object.entries(QUEUES)) {
		await boss.createQueue(name);
		await boss.schedule(name, def.cron);
		await boss.work(name, async () => {
			const summary: JobRunSummary = await def.run();
			console.log(`[jobs] ${name}:`, summary);
		});
	}

	console.log('[jobs] pg-boss started —', Object.keys(QUEUES).join(', '));
	return boss;
}

/** Starts the job runner once per process. Call from `hooks.server.ts` at boot. */
export function startJobRunner(): Promise<PgBoss> {
	if (!globalThis.__mmhotelJobRunnerPromise) {
		globalThis.__mmhotelJobRunnerPromise = boot().catch((err) => {
			// Let a later call retry instead of permanently wedging on a transient
			// startup failure (e.g. the DB not accepting connections yet).
			globalThis.__mmhotelJobRunnerPromise = undefined;
			throw err;
		});
	}
	return globalThis.__mmhotelJobRunnerPromise;
}
