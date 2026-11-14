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
	<h1 class="mb-1 text-xl font-semibold tracking-tight text-ink">Booking rules</h1>
	<p class="mb-6 text-sm text-ink-muted">
		Exceptions staff can make when keying in a booking. Hotel admins can always use them.
	</p>

	<div class="divide-y divide-border rounded-xl border border-border bg-surface-2">
		<div class="flex items-start justify-between gap-4 p-4">
			<div class="min-w-0">
				<p class="font-medium text-ink">Let front desk override guest capacity</p>
				<p class="mt-0.5 text-sm text-ink-muted">
					Lets front desk book more guests into a room than its limit, with extra beds, when they
					give a reason. Every override is logged. Turn it off and only hotel admins can do it.
				</p>
			</div>
			<form method="POST" action="?/capacityOverride" use:enhance class="shrink-0">
				<input
					type="hidden"
					name="enabled"
					value={(!data.frontDeskCapacityOverride).toString()}
				/>
				<button
					type="submit"
					role="switch"
					aria-checked={data.frontDeskCapacityOverride}
					aria-label="Let front desk override guest capacity"
					class="relative h-6 w-11 shrink-0 rounded-full transition-colors {data.frontDeskCapacityOverride
						? 'bg-brand'
						: 'bg-border'}"
				>
					<span
						class="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform {data.frontDeskCapacityOverride
							? 'translate-x-5'
							: 'translate-x-0'}"
					></span>
				</button>
			</form>
		</div>
	</div>
</div>
