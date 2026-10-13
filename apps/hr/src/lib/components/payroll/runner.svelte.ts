import { toast } from 'svelte-sonner';

/**
 * The enhance callback every payroll form shares: tracks `busy`, toasts the server's message, and
 * calls `onDone` after a success (a page uses it to close its dialog).
 */
export function createRunner(onDone: () => void = () => {}) {
	let busy = $state(false);
	return {
		get busy() {
			return busy;
		},
		run() {
			busy = true;
			return async ({
				result,
				update
			}: {
				result: { type: string; data?: unknown };
				update: (o?: { reset?: boolean }) => Promise<void>;
			}) => {
				await update({ reset: false });
				busy = false;
				const d = result.data as { ok?: string; error?: string } | undefined;
				if (result.type === 'success') {
					onDone();
					toast.success(d?.ok ?? 'Done.');
				} else if (result.type === 'failure') toast.error(d?.error ?? 'Could not save.');
			};
		}
	};
}
