<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const slug = $derived(page.params.hotel);
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	$effect(() => {
		if (form && 'ok' in form && form.ok) toast.success(form.ok);
		if (form && 'error' in form && form.error) toast.error(form.error);
	});

	const x = $derived(data.xReading);
	const xTiles = $derived<[string, number][]>([
		['Gross sales', x.grossSalesCentavos],
		['VAT', x.vatCentavos],
		['Net sales', x.netSalesCentavos],
		['Projected grand total', x.newGrandTotalCentavos]
	]);

	const r = $derived(data.readiness);
	const base = $derived(`/${slug}/finance`);
	// done → warn (needs a step) → blocked (open shift) → neutral (not closed)
	const state = $derived(
		r.hasZ
			? 'done'
			: r.dayClosed
				? 'warn'
				: r.openShiftCount > 0
					? 'blocked'
					: 'pending'
	);
	const panelClass = $derived(
		{
			done: 'border-ok/40 bg-ok/5',
			warn: 'border-amber-500/40 bg-amber-500/5',
			blocked: 'border-amber-500/40 bg-amber-500/5',
			pending: 'border-border'
		}[state]
	);
</script>

<!-- Z-reading readiness for the selected date -->
<section class="mb-8 rounded-xl border p-5 {panelClass}">
	<div class="mb-1 flex items-center justify-between gap-3">
		<h2 class="text-sm font-semibold text-ink">
			Z-reading · <span class="font-mono">{r.date}</span>{r.isToday ? ' (today)' : ''}
		</h2>
		{#if state === 'done'}
			<Badge variant="outline" class="border-transparent bg-ok/15 text-ok">Issued</Badge>
		{:else}
			<Badge variant="outline" class="border-border bg-surface-2 text-ink-muted">Not issued</Badge>
		{/if}
	</div>

	{#if state === 'done'}
		<p class="text-sm text-ink-muted">
			Z-reading No. <span class="font-mono text-ink">{r.zCounter}</span> was issued for this date.
			<a class="ml-1 font-medium underline" href="/{slug}/print/reading/z/{r.zId}" target="_blank">
				Print
			</a>
		</p>
	{:else if state === 'warn'}
		<p class="text-sm text-ink-muted">
			This day is <span class="text-ink">closed</span> but its Z-reading was never written
			(the auto-issue at close is non-fatal). Generate it now:
		</p>
		<form method="POST" action="?/generateZ" use:enhance class="mt-3">
			<input type="hidden" name="date" value={r.date} />
			<Button type="submit" size="sm" disabled={!data.canGenerate}>Generate Z-reading</Button>
		</form>
	{:else if state === 'blocked'}
		<p class="text-sm text-ink-muted">
			A Z-reading can't be issued until this business day is <span class="text-ink">closed</span>,
			and the day won't close while a cashier shift is still open.
		</p>
		<p class="mt-2 text-sm">
			<span class="font-medium text-ink">{r.openShiftCount} cashier shift{r.openShiftCount === 1 ? '' : 's'} still open</span>
			for {r.date}.
		</p>
		<ol class="mt-2 ml-4 list-decimal space-y-0.5 text-sm text-ink-muted">
			<li><a class="font-medium underline" href="{base}/shifts">Close the open shift{r.openShiftCount === 1 ? '' : 's'}</a> (count the drawer).</li>
			<li><a class="font-medium underline" href={base}>Run day close</a> on the dashboard — the Z-reading is issued automatically.</li>
		</ol>
	{:else}
		<p class="text-sm text-ink-muted">
			<span class="font-mono text-ink">{r.date}</span> isn't closed yet. No open cashier shifts are
			blocking it —
			<a class="font-medium underline" href={base}>run day close</a> on the dashboard and the
			Z-reading is issued automatically.
		</p>
	{/if}
</section>

<!-- X-reading (interim) -->
<section class="mb-8 rounded-xl border border-border p-5">
	<div class="mb-3 flex items-center justify-between">
		<h2 class="text-sm font-semibold text-ink">X-reading — interim</h2>
		<form method="GET" class="flex items-center gap-2">
			<input
				type="date"
				name="date"
				value={data.xDate}
				class="rounded-md border border-input bg-transparent px-2 py-1 text-sm"
			/>
			<Button type="submit" size="sm" variant="outline">View</Button>
		</form>
	</div>

	<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		{#each xTiles as [label, n] (label)}
			<div class="rounded-lg border border-border p-3">
				<div class="text-xs text-ink-muted">{label}</div>
				<div class="font-mono text-ink">{peso(n)}</div>
			</div>
		{/each}
	</div>
	<p class="mt-2 text-xs text-ink-muted">
		{x.businessDate} · Invoices {x.invoiceCount} · ORs {x.orCount} · Voids {x.voidCount} · Refunds
		{x.refundCount}. Interim only — no counter is reset.
	</p>
	<a
		class="mt-3 inline-block text-sm font-medium underline"
		href="/{slug}/print/reading/x?date={x.businessDate}"
		target="_blank"
	>
		Print X-reading
	</a>
</section>

<!-- Closed days still needing a Z -->
{#if data.closedWithoutZ.length > 0}
	<section class="mb-8 rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
		<h2 class="mb-2 text-sm font-semibold text-ink">Closed days without a Z-reading</h2>
		<p class="mb-3 text-xs text-ink-muted">
			A Z-reading is normally issued automatically at day-close. Generate one here if that step was
			missed.
		</p>
		<div class="flex flex-wrap gap-2">
			{#each data.closedWithoutZ as d (d)}
				<form method="POST" action="?/generateZ" use:enhance>
					<input type="hidden" name="date" value={d} />
					<Button type="submit" size="sm" variant="outline" disabled={!data.canGenerate}>
						Generate Z for {d}
					</Button>
				</form>
			{/each}
		</div>
	</section>
{/if}

<!-- Z-readings -->
<section>
	<h2 class="mb-3 text-sm font-semibold text-ink">Z-readings</h2>
	{#if data.zReadings.length === 0}
		<p class="rounded-xl border border-dashed border-border p-6 text-center text-sm text-ink-muted">
			No Z-readings yet — they're issued when a business date is closed (Finance → Dashboard →
			day-close).
		</p>
	{:else}
		<div class="overflow-x-auto rounded-xl border border-border">
			<table class="w-full text-sm">
				<thead class="border-b border-border bg-surface-2 text-left text-xs text-ink-muted">
					<tr>
						<th class="px-3 py-2">Z No.</th>
						<th class="px-3 py-2">Business date</th>
						<th class="px-3 py-2 text-right">Gross</th>
						<th class="px-3 py-2 text-right">Net</th>
						<th class="px-3 py-2 text-right">New grand total</th>
						<th class="px-3 py-2">Closed</th>
						<th class="px-3 py-2"></th>
					</tr>
				</thead>
				<tbody>
					{#each data.zReadings as z (z.id)}
						<tr class="border-b border-border/60 last:border-0">
							<td class="px-3 py-2 font-mono">{z.zCounter}</td>
							<td class="px-3 py-2 font-mono">{z.businessDate}</td>
							<td class="px-3 py-2 text-right font-mono">{peso(z.grossSalesCentavos)}</td>
							<td class="px-3 py-2 text-right font-mono">{peso(z.netSalesCentavos)}</td>
							<td class="px-3 py-2 text-right font-mono">{peso(z.newGrandTotalCentavos)}</td>
							<td class="px-3 py-2 text-ink-muted">
								{new Date(z.generatedAt).toLocaleDateString('en-PH')}
							</td>
							<td class="px-3 py-2 text-right">
								<a
									class="text-xs font-medium underline"
									href="/{slug}/print/reading/z/{z.id}"
									target="_blank"
								>
									Print
								</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
