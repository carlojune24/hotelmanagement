<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import PermitStatusBadge from '$lib/components/city/permit-status-badge.svelte';
	import { daysUntil } from '$lib/city/permits';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const day = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'UTC' });
	const fmtDay = (s: string) => day.format(new Date(`${s}T00:00:00Z`));
	const when = (n: number) =>
		n === 0 ? 'today' : n > 0 ? `in ${n} ${n === 1 ? 'day' : 'days'}` : `${-n} ${n === -1 ? 'day' : 'days'} ago`;

	const v = $derived((form && 'values' in form ? form.values : {}) as Record<string, string>);

	// The form is cleared after a successful save by remounting it.
	let formKey = $state(0);

	$effect(() => {
		if (form && 'error' in form && form.error) toast.error(form.error);
	});
</script>

<svelte:head><title>{data.hotel.name} permits — City management</title></svelte:head>

<div class="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
	<Button variant="outline" href="/city/permits">← Permits</Button>

	<div class="mt-5 flex flex-wrap items-center gap-3">
		<h1 class="text-xl font-semibold tracking-tight text-ink">{data.hotel.name}</h1>
		<PermitStatusBadge status={data.status} />
	</div>

	{#if data.current}
		<dl class="mt-5 divide-y divide-border border-y border-border text-sm">
			<div class="grid grid-cols-[10rem_1fr] gap-4 py-2.5">
				<dt class="text-ink-muted">Current permit</dt>
				<dd class="font-mono text-ink">{data.current.permitNumber}</dd>
			</div>
			<div class="grid grid-cols-[10rem_1fr] gap-4 py-2.5">
				<dt class="text-ink-muted">Expires</dt>
				<dd class="text-ink">
					{fmtDay(data.current.expiresOn)}
					{#if data.daysLeft !== null}<span class="text-ink-muted">· {when(data.daysLeft)}</span>{/if}
				</dd>
			</div>
			{#if data.current.issuedOn}
				<div class="grid grid-cols-[10rem_1fr] gap-4 py-2.5">
					<dt class="text-ink-muted">Issued</dt>
					<dd class="text-ink">{fmtDay(data.current.issuedOn)}</dd>
				</div>
			{/if}
		</dl>
	{:else}
		<p class="mt-5 text-sm text-ink-muted">No permit is on file for this hotel yet.</p>
	{/if}

	<section class="mt-8 border-t border-border pt-6">
		<h2 class="text-sm font-semibold text-ink">
			{data.current ? 'Record a renewal or new permit' : 'Record a permit'}
		</h2>
		<p class="mt-1 max-w-[68ch] text-sm text-ink-muted">
			A renewal is saved as a new entry, so earlier permits stay in the history below. The permit
			expiring latest counts as current.
		</p>
		{#key formKey}
			<form
				method="POST"
				action="?/record"
				use:enhance={() =>
					async ({ result, update }) => {
						await update({ reset: false });
						if (result.type === 'success') {
							toast.success('Permit recorded.');
							formKey++;
						}
					}}
				class="mt-4 space-y-4"
			>
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<Label for="permitNumber">Permit number</Label>
						<Input
							id="permitNumber"
							name="permitNumber"
							required
							value={v.permitNumber ?? ''}
							class="mt-1 font-mono"
						/>
					</div>
					<div>
						<Label for="expiresOn">Expires on</Label>
						<Input id="expiresOn" name="expiresOn" type="date" required value={v.expiresOn ?? ''} class="mt-1" />
					</div>
					<div>
						<Label for="issuedOn">Issued on <span class="text-ink-muted">(optional)</span></Label>
						<Input id="issuedOn" name="issuedOn" type="date" value={v.issuedOn ?? ''} class="mt-1" />
					</div>
				</div>
				<div>
					<Label for="notes">Notes <span class="text-ink-muted">(optional)</span></Label>
					<textarea
						id="notes"
						name="notes"
						rows="2"
						maxlength="1000"
						class="mt-1 w-full rounded-md border border-input bg-transparent px-2.5 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
						>{v.notes ?? ''}</textarea
					>
				</div>
				<Button type="submit">Save permit</Button>
			</form>
		{/key}
	</section>

	<section class="mt-8 border-t border-border pt-6">
		<h2 class="text-sm font-semibold text-ink">History</h2>
		{#if data.history.length === 0}
			<p class="mt-2 text-sm text-ink-muted">Nothing recorded yet.</p>
		{:else}
			<ul class="mt-2 divide-y divide-border border-y border-border text-sm">
				{#each data.history as p (p.id)}
					<li class="py-2.5">
						<div class="flex flex-wrap items-baseline justify-between gap-2">
							<span class="font-mono text-ink">{p.permitNumber}</span>
							<span class="text-ink-muted">
								{p.issuedOn ? `${fmtDay(p.issuedOn)} – ` : 'Expires '}{fmtDay(p.expiresOn)}
								{#if daysUntil(p.expiresOn, data.today) < 0}<span class="text-danger"> · lapsed</span>{/if}
							</span>
						</div>
						{#if p.notes}<p class="mt-1 text-xs text-ink-muted">{p.notes}</p>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
