<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}/management/inventory/counts`);
	const DEPT: Record<string, string> = { dining: 'Dining', hotel: 'Hotel' };
	const scope = (d: string | null) => (d ? DEPT[d] : 'Everything');
	const SCOPES = [
		{ key: 'hotel', label: 'Hotel', hint: 'Linens, guest amenities' },
		{ key: 'dining', label: 'Dining', hint: 'Kitchen and bar stock' },
		{ key: 'all', label: 'Everything', hint: 'Every department' }
	];
	let department = $state('hotel');
	let busy = $state(false);

	const open = $derived(data.counts.find((c) => c.status === 'open'));
	const done = $derived(data.counts.filter((c) => c.status === 'finished'));
	const when = $derived(new Intl.DateTimeFormat('en-PH', { timeZone: data.timezone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }));

	$effect(() => {
		if (form?.error) toast.error(form.error);
	});
</script>

<svelte:head><title>Counts · Inventory</title></svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<div class="max-w-4xl">
		<h2 class="text-base font-semibold text-ink">Stock counts</h2>
		<p class="mt-1 text-sm text-ink-muted">
			Count what is really on the shelf — linens, toiletries, kitchen stock. On finish, every difference is posted as a correction
			with its reason, and the count is kept as the audit record.
		</p>

		{#if open}
			<a
				href="{base}/{open.id}"
				class="mt-4 flex items-center gap-3 rounded-lg border border-warning/60 bg-warning/10 px-4 py-3 hover:bg-warning/15"
			>
				<ClipboardListIcon class="size-5 shrink-0 text-ink" aria-hidden="true" />
				<div class="min-w-0 flex-1">
					<p class="text-sm font-semibold text-ink">Count in progress: {scope(open.department)}</p>
					<p class="text-xs text-ink-muted">
						Started {when.format(new Date(open.startedAt))}{open.startedByName ? ` by ${open.startedByName}` : ''} · {open.lines} items
					</p>
				</div>
				<span class="text-sm font-medium text-ink">Continue</span>
				<ChevronRightIcon class="size-4 text-ink-muted" aria-hidden="true" />
			</a>
		{:else if data.inventory.canWrite}
			<form
				method="POST"
				action="?/start"
				class="mt-4 rounded-lg border border-border bg-surface p-4"
				use:enhance={() => {
					busy = true;
					return async ({ update }) => {
						busy = false;
						await update();
					};
				}}
			>
				<fieldset>
					<legend class="text-sm font-medium text-ink">Start a count</legend>
					<input type="hidden" name="department" value={department} />
					<div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="What to count">
						{#each SCOPES as sc (sc.key)}
							<button
								type="button"
								role="radio"
								aria-checked={department === sc.key}
								class="rounded-md border px-3 py-2 text-left {department === sc.key ?'border-ink bg-surface-2'
									: 'border-border hover:border-ink-muted'}"
								onclick={() => (department = sc.key)}
							>
								<span class="block text-sm font-medium text-ink">{sc.label}</span>
								<span class="block text-xs text-ink-muted">{sc.hint}</span>
							</button>
						{/each}
					</div>
				</fieldset>
				<div class="mt-3 flex flex-wrap items-end gap-3">
					<div class="min-w-56 flex-1">
						<Label for="countNote">Note (optional)</Label>
						<Input id="countNote" name="note" maxlength={300} placeholder="Monthly linen audit" class="mt-1" />
					</div>
					<Button type="submit" class="" disabled={busy}>Start count</Button>
				</div>
			</form>
		{/if}

		<section class="mt-6" aria-labelledby="past-counts">
			<h3 id="past-counts" class="border-b border-border pb-2 text-sm font-semibold tracking-wide text-ink uppercase">
				Finished<span class="ml-1 font-normal tabular-nums text-ink-muted">{done.length}</span>
			</h3>
			{#if done.length}
				<ul class="divide-y divide-border">
					{#each done as c (c.id)}
						<li>
							<a href="{base}/{c.id}" class="flex items-center gap-3 py-2.5 hover:bg-surface-2">
								<div class="min-w-0 flex-1">
									<p class="truncate text-base text-ink">{scope(c.department)}{c.note ? ` — ${c.note}` : ''}</p>
									<p class="text-xs text-ink-muted">
										{when.format(new Date(c.finishedAt ?? c.startedAt))}{c.finishedByName ? ` · ${c.finishedByName}` : ''}
									</p>
								</div>
								<span class="text-sm tabular-nums {c.adjusted ?'text-ink' : 'text-ink-muted'}">
									{c.adjusted ? `${c.adjusted} of ${c.lines} adjusted` : `${c.lines} items, all matched`}
								</span>
								<ChevronRightIcon class="size-4 text-ink-muted" aria-hidden="true" />
							</a>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="py-6 text-sm text-ink-muted">No finished counts yet.</p>
			{/if}
		</section>
	</div>
</div>
