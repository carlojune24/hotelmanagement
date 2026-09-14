<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	$effect(() => {
		if (form && 'ok' in form && form.ok) toast.success(form.ok);
		if (form && 'error' in form && form.error) toast.error(form.error);
	});
</script>

<div class="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
	<h1 class="mb-1 text-xl font-semibold tracking-tight text-ink">Automation</h1>
	<p class="mb-6 text-sm text-ink-muted">
		Background jobs this hotel runs on a schedule instead of a staff member triggering them by
		hand. Turning one off just goes back to the manual button it replaces — nothing here is
		required for the app to work.
	</p>

	<div class="divide-y divide-border rounded-xl border border-border bg-surface-2">
		{#each data.jobs as j (j.key)}
			<div class="flex items-start justify-between gap-4 p-4">
				<div class="min-w-0">
					<p class="font-medium text-ink">{j.label}</p>
					<p class="mt-0.5 text-sm text-ink-muted">{j.description}</p>
				</div>
				<form method="POST" action="?/toggle" use:enhance class="shrink-0">
					<input type="hidden" name="jobKey" value={j.key} />
					<input type="hidden" name="enabled" value={(!j.enabled).toString()} />
					<button
						type="submit"
						role="switch"
						aria-checked={j.enabled}
						aria-label={j.label}
						class="relative h-6 w-11 shrink-0 rounded-full transition-colors {j.enabled
							? 'bg-brand'
							: 'bg-border'}"
					>
						<span
							class="absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform {j.enabled
								? 'translate-x-[22px]'
								: 'translate-x-0.5'}"
						></span>
					</button>
				</form>
			</div>
		{/each}
	</div>

	<p class="mt-4 text-xs text-ink-muted">
		More automations (posting nightly room charges, applying cancellation fees, closing the
		business day) will appear here as they're built.
	</p>
</div>
