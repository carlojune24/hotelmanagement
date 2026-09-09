<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const base = $derived(`/${page.params.hotel}/finance/bir/accountable-forms`);
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	$effect(() => {
		if (form && 'ok' in form && form.ok) toast.success(form.ok);
		if (form && 'error' in form && form.error) toast.error(form.error);
	});

	let showSpoil = $state(false);
	const typeLabel = (t: string) => (t === 'invoice' ? 'Invoice' : 'Official Receipt');
	const rowStatusClass: Record<string, string> = {
		issued: 'text-ink',
		cancelled: 'text-danger',
		spoiled: 'text-ink-muted',
		unused: 'text-ink-muted'
	};
	const printHref = (r: { type: string | null; documentId: string | null; status: string }) =>
		r.documentId && r.type && r.status !== 'spoiled'
			? `/${page.params.hotel}/print/${r.type === 'invoice' ? 'invoice' : 'receipt'}/${r.documentId}`
			: null;
</script>

{#if data.series.length === 0}
	<p class="rounded-xl border border-dashed border-border p-6 text-center text-sm text-ink-muted">
		No serial ranges registered yet — add one under <a class="underline" href="../series">Series</a>.
	</p>
{:else}
	<div class="mb-4 flex flex-wrap items-center gap-3">
		<Label class="text-xs" for="series">Range</Label>
		<select
			id="series"
			class="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
			onchange={(e) => (window.location.href = `${base}?series=${(e.target as HTMLSelectElement).value}`)}
		>
			{#each data.series as s (s.id)}
				<option value={s.id} selected={s.id === data.selectedId}>
					{typeLabel(s.type)} — {s.prefix} {s.serialFrom}–{s.serialTo} ({s.status})
				</option>
			{/each}
		</select>

		{#if data.register}
			<a class="ml-auto text-sm font-medium underline" href="/{page.params.hotel}/print/liquidation/{data.selectedId}" target="_blank">
				Print register
			</a>
		{/if}
	</div>

	{#if data.register}
		{@const sum = data.register.summary}
		<div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
			{#each [['Issued', sum.issued], ['Cancelled', sum.cancelled], ['Spoiled', sum.spoiled], ['Unused', sum.unused], ['Range total', sum.total]] as [label, n] (label)}
				<div class="rounded-lg border border-border p-3">
					<div class="text-xs text-ink-muted">{label}</div>
					<div class="font-mono text-lg text-ink">{n}</div>
				</div>
			{/each}
		</div>

		{#if data.canWrite}
			<div class="mb-4">
				<Button size="sm" variant={showSpoil ? 'secondary' : 'outline'} onclick={() => (showSpoil = !showSpoil)}>
					{showSpoil ? 'Cancel' : 'Spoil next serial'}
				</Button>
				{#if showSpoil}
					<form
						method="POST"
						action="?/spoil"
						use:enhance={() => async ({ update }) => {
							await update();
							showSpoil = false;
						}}
						class="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-border p-4"
					>
						<div>
							<Label class="text-xs" for="spoil-type">Series</Label>
							<select
								id="spoil-type"
								name="type"
								class="mt-1 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
							>
								<option value="official_receipt">Official Receipt</option>
								<option value="invoice">Invoice</option>
							</select>
						</div>
						<div class="min-w-64 flex-1">
							<Label class="text-xs" for="spoil-reason">Reason</Label>
							<Input id="spoil-reason" name="reason" placeholder="e.g. printer jam, misprint" />
						</div>
						<Button type="submit" size="sm" variant="destructive">Record as spoiled</Button>
						<p class="w-full text-xs text-ink-muted">
							Consumes the next number in the <strong>active</strong> range for that type without issuing
							a document. Use this only for a number that was physically wasted.
						</p>
					</form>
				{/if}
			</div>
		{/if}

		<div class="overflow-x-auto rounded-xl border border-border">
			<table class="w-full text-sm">
				<thead class="border-b border-border bg-surface-2 text-left text-xs text-ink-muted">
					<tr>
						<th class="px-3 py-2">Serial</th>
						<th class="px-3 py-2">Status</th>
						<th class="px-3 py-2">Bill to</th>
						<th class="px-3 py-2 text-right">Amount</th>
						<th class="px-3 py-2">Date</th>
						<th class="px-3 py-2">By</th>
						<th class="px-3 py-2">Reason</th>
						<th class="px-3 py-2"></th>
					</tr>
				</thead>
				<tbody>
					{#each data.register.rows as r, i (i)}
						<tr class="border-b border-border/60 last:border-0">
							<td class="px-3 py-2 font-mono whitespace-nowrap">
								{#if r.count === 1}{r.formattedFrom}{:else}{r.formattedFrom} – {r.formattedTo}
									<span class="text-ink-muted">({r.count})</span>{/if}
							</td>
							<td class="px-3 py-2 {rowStatusClass[r.status]}">{r.status}</td>
							<td class="px-3 py-2">{r.billToName ?? '—'}</td>
							<td class="px-3 py-2 text-right font-mono">
								{r.grossCentavos == null ? '—' : peso(r.grossCentavos)}
							</td>
							<td class="px-3 py-2 text-ink-muted whitespace-nowrap">
								{r.at ? new Date(r.at).toLocaleDateString('en-PH') : '—'}
							</td>
							<td class="px-3 py-2 text-ink-muted">{r.byName ?? '—'}</td>
							<td class="px-3 py-2 text-ink-muted">{r.reason ?? '—'}</td>
							<td class="px-3 py-2 text-right">
								{#if printHref(r)}
									<a class="text-xs font-medium underline" href={printHref(r)} target="_blank">Print</a>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
{/if}
