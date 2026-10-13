<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	$effect(() => {
		if (form?.error) toast.error(form.error);
		else if (form?.ok) toast.success(form.ok);
	});
</script>

<div class="mx-auto max-w-xl space-y-6 p-4 sm:p-6">
	<div>
		<h1 class="text-lg font-semibold text-ink">Night differential</h1>
		<p class="mt-1 text-sm text-ink-muted">
			Hours worked inside this window earn the premium. A shift can set its own window in Schedule
			&rarr; Shifts; this one applies to every shift that doesn't.
		</p>
	</div>

	<form method="POST" action="?/saveNightDiff" use:enhance class="space-y-4">
		<div class="grid grid-cols-3 gap-3">
			<div>
				<Label for="ndStart">From</Label>
				<Input id="ndStart" name="start" type="time" required value={data.nightDiff.start} class="mt-1" />
			</div>
			<div>
				<Label for="ndEnd">To</Label>
				<Input id="ndEnd" name="end" type="time" required value={data.nightDiff.end} class="mt-1" />
			</div>
			<div>
				<Label for="ndRate">Premium (%)</Label>
				<Input
					id="ndRate"
					name="ratePct"
					type="number"
					min="0"
					max="100"
					step="0.01"
					required
					value={data.nightDiff.ratePct}
					class="mt-1"
				/>
			</div>
		</div>
		<p class="text-xs text-ink-muted">
			Times after midnight wrap, so 22:00 to 06:00 covers the night. The statutory minimum is 10%.
			Changing the window affects DTRs generated from now on; saved DTRs are not recomputed.
		</p>
		<Button type="submit">Save</Button>
	</form>
</div>
