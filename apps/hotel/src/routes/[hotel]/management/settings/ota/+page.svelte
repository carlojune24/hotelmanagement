<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}/management`);
	let renamingId = $state<string | null>(null);

	$effect(() => {
		if (form && 'error' in form && form.error) toast.error(form.error);
		if (form && 'ok' in form && form.ok) {
			toast.success(form.ok);
			renamingId = null;
		}
	});
</script>

<div class="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between gap-3">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">OTA channels</h1>
			<p class="text-sm text-ink-muted">The OTAs your hotel takes bookings from. Staff pick from this list, so one OTA is never spelt two ways.</p>
		</div>
		<Button variant="outline" href="{base}/settings">← Settings</Button>
	</div>

	<form method="POST" action="?/add" use:enhance={() => async ({ update }) => update({ reset: true })} class="mb-5 flex items-end gap-2">
		<div class="flex-1">
			<Label for="otaNewName">New OTA name</Label>
			<Input id="otaNewName" name="name" required maxlength={60} autocomplete="off" placeholder="e.g. Expedia" class="mt-1" />
		</div>
		<Button type="submit">Add</Button>
	</form>

	<ul class="divide-y divide-border rounded-xl border border-border">
		{#each data.channels as c (c.id)}
			<li class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
				{#if renamingId === c.id}
					<form method="POST" action="?/rename" use:enhance class="flex flex-1 flex-wrap items-end gap-2">
						<input type="hidden" name="id" value={c.id} />
						<div class="min-w-40 flex-1">
							<Label for="otaRename-{c.id}" class="text-xs">Renames its {c.bookings} booking(s) too</Label>
							<Input id="otaRename-{c.id}" name="name" value={c.name} required maxlength={60} autocomplete="off" class="mt-1 h-9" />
						</div>
						<Button type="submit" size="sm">Save</Button>
						<Button type="button" size="sm" variant="ghost" onclick={() => (renamingId = null)}>Cancel</Button>
					</form>
				{:else}
					<div class="min-w-0">
						<span class="font-medium text-ink {c.isActive ? '' : 'text-ink-muted'}">{c.name}</span>
						{#if !c.isActive}<Badge variant="outline" class="ml-2 border-border bg-surface-2 text-ink-muted">off</Badge>{/if}
						<span class="ml-2 text-xs text-ink-muted tabular-nums">{c.bookings} booking{c.bookings === 1 ? '' : 's'}</span>
					</div>
					<div class="flex items-center gap-1.5">
						<Button type="button" size="sm" variant="outline" onclick={() => (renamingId = c.id)}>Rename</Button>
						<form method="POST" action="?/setActive" use:enhance class="inline">
							<input type="hidden" name="id" value={c.id} />
							<input type="hidden" name="active" value={c.isActive ? 'false' : 'true'} />
							<Button type="submit" size="sm" variant="outline">{c.isActive ? 'Turn off' : 'Turn on'}</Button>
						</form>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
	<p class="mt-3 text-xs text-ink-muted">
		An OTA that is turned off can't be picked for a new booking, but it keeps its tab on Finance → OTA payouts while bookings are still waiting for its payout. An OTA can't be deleted.
	</p>
</div>
