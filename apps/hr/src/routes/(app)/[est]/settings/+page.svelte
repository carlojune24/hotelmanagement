<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { page } from '$app/state';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	$effect(() => {
		if (form?.error) toast.error(form.error);
		else if (form?.ok) toast.success(form.ok);
	});

	const newKey = $derived((form as { newKey?: string } | null)?.newKey ?? null);
	const apiBase = $derived(page.url.origin);
	const when = (d: Date | string | null) =>
		d ? new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'never';
</script>

<div class="mx-auto max-w-xl space-y-6 p-4 sm:p-6">
	{#if data.tabs.leavePolicy}
		<a
			href="settings/leave"
			class="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 text-sm font-medium hover:bg-gold-soft"
		>
			<span>Leave policy &amp; holiday calendar</span>
			<span aria-hidden="true">&rarr;</span>
		</a>
	{/if}
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

	{#if data.canKeys}
		<section class="space-y-3 border-t border-dotted border-foreground/20 pt-6" aria-label="Hotel connection">
			<div>
				<h2 class="text-lg font-semibold text-ink">Hotel connection</h2>
				<p class="mt-1 text-sm text-ink-muted">
					A key lets this business's hotel app read who is assigned here (name, post, email, status —
					never pay or IDs). Give the hotel admin the key and this address:
					<code class="rounded bg-ink/10 px-1.5 py-0.5 text-xs">{apiBase}</code>
				</p>
			</div>

			{#if newKey}
				<div class="rounded-2xl bg-gold p-4 text-sm">
					<p class="font-medium">Copy this key now — it will not be shown again.</p>
					<code class="mt-2 block break-all rounded-xl bg-white/70 p-3 font-mono text-xs select-all">{newKey}</code>
				</div>
			{/if}

			<form method="POST" action="?/createKey" use:enhance class="flex flex-wrap items-end gap-2">
				<div class="min-w-48 flex-1">
					<Label for="keyName">New key name</Label>
					<Input id="keyName" name="name" required maxlength={80} placeholder="Hotel app" class="mt-1" />
				</div>
				<Button type="submit" variant="gold">Create key</Button>
			</form>

			{#if data.keys.length > 0}
				<ul class="divide-y divide-dotted divide-foreground/20">
					{#each data.keys as k (k.id)}
						<li class="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
							<div>
								<p class="font-medium">
									{k.name} <span class="font-mono text-xs text-ink-muted">{k.prefix}…</span>
									{#if k.revokedAt}<span class="ml-1 text-xs text-destructive">revoked</span>{/if}
								</p>
								<p class="text-xs text-ink-muted">Last used {when(k.lastUsedAt)}</p>
							</div>
							{#if !k.revokedAt}
								<form method="POST" action="?/revokeKey" use:enhance>
									<input type="hidden" name="id" value={k.id} />
									<Button type="submit" variant="outline" size="sm">Revoke</Button>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>
