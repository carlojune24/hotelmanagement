<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const base = $derived(`/${page.params.hotel}/management/finance/reports`);
	const staff = $derived(`/${page.params.hotel}/management`);
	const r = $derived(data.result);
	const qs = $derived(page.url.searchParams.toString());
	const csvHref = $derived(`${base}/${data.slug}/export${qs ? `?${qs}` : ''}`);

	// Older reports carry no `moneyColumns` and keep their original look (first column left,
	// the rest right-aligned and muted); the ledger reports declare which columns are money.
	const isMoney = (ci: number) => (r.moneyColumns ? r.moneyColumns.includes(ci) : ci !== 0);
	const wide = $derived(!!r.moneyColumns && r.columns.length > 4);

	/** `1234.5` → `1,234.50`, zero → an em dash, negatives with a true minus sign. */
	const money = (v: string | number) => {
		const n = Number(v);
		if (!Number.isFinite(n) || v === '' || v === '—') return String(v);
		if (n === 0) return '—';
		const s = Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		return n < 0 ? `−${s}` : s;
	};
	const peso = (v: string) => (Number(v) < 0 ? `−₱${money(-Number(v))}` : `₱${money(v)}`);

	const TYPE_LABEL: Record<string, string> = {
		asset: 'Assets',
		liability: 'Liabilities',
		equity: 'Equity',
		income: 'Income',
		expense: 'Expenses'
	};
	const accountGroups = $derived(
		Object.keys(TYPE_LABEL)
			.map((type) => ({ type, label: TYPE_LABEL[type], items: (r.accountOptions ?? []).filter((a) => a.type === type) }))
			.filter((g) => g.items.length > 0)
	);

	type Link = NonNullable<NonNullable<typeof r.rowMeta>[number]>['link'];
	const linkHref = (l: NonNullable<Link>) =>
		l.kind === 'order'
			? `${staff}/transactions/${l.id}`
			: l.kind === 'shift'
				? `${staff}/finance/shifts/${l.id}`
				: `${staff}/finance/expenses`;
	const linkLabel = (l: NonNullable<Link>) =>
		l.kind === 'order' ? 'Open booking' : l.kind === 'shift' ? 'Open shift' : 'Open expenses';

	let expanded = $state<Record<number, boolean>>({});
	// A new report or new filters → start collapsed again.
	$effect(() => {
		void page.url.search;
		expanded = {};
	});
</script>

<div class="mx-auto w-full {wide ? 'max-w-5xl' : 'max-w-3xl'} px-4 py-6 sm:px-6">
	<div class="mb-4 flex items-center justify-between print:hidden">
		<a href={base} class="text-sm text-ink-muted underline underline-offset-2">← Reports</a>
		<div class="flex items-center gap-3">
			<button type="button" onclick={() => window.print()} class="text-sm text-ink-muted underline underline-offset-2 hover:text-ink">
				Print
			</button>
			<a href={csvHref} class="text-sm text-ink-muted underline underline-offset-2">Download CSV</a>
		</div>
	</div>
	<h1 class="mb-1 text-xl font-semibold tracking-tight text-ink print:text-black">{r.name}</h1>
	<p class="mb-3 hidden text-sm text-black print:block">{page.data.hotel?.name ?? ''}</p>

	{#each r.notices ?? [] as note (note)}
		<p class="mb-3 max-w-prose text-sm text-ink-muted print:text-black">{note}</p>
	{/each}

	<form method="GET" class="mb-4 flex flex-wrap items-end gap-2 print:hidden">
		{#if r.accountOptions}
			<div>
				<Label class="text-xs" for="account">Account</Label>
				<select
					id="account"
					name="account"
					class="mt-1 h-8 max-w-[18rem] rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
				>
					{#each accountGroups as g (g.type)}
						<optgroup label={g.label}>
							{#each g.items as a (a.id)}
								<option value={a.id} selected={a.id === r.accountId}>{a.code} · {a.name}</option>
							{/each}
						</optgroup>
					{/each}
				</select>
			</div>
		{/if}
		{#if r.kind === 'day'}
			<div><Label class="text-xs">Date</Label><Input name="date" type="date" value={data.params.date} class="mt-1 h-8" /></div>
		{:else if r.kind === 'asOf'}
			<div><Label class="text-xs">As of</Label><Input name="to" type="date" value={data.params.to} class="mt-1 h-8" /></div>
		{:else}
			<div><Label class="text-xs">From</Label><Input name="from" type="date" value={data.params.from} class="mt-1 h-8" /></div>
			<div><Label class="text-xs">To</Label><Input name="to" type="date" value={data.params.to} class="mt-1 h-8" /></div>
		{/if}
		{#if data.slug === 'trial-balance'}
			<label class="flex h-8 items-center gap-1.5 text-sm text-ink">
				<input type="checkbox" name="all" value="1" checked={r.showAll} class="size-4" />
				Show accounts with no activity
			</label>
		{/if}
		<Button type="submit" size="sm" variant="outline">Run</Button>
	</form>

	<!-- The report's own check (debits = credits, assets = liabilities + equity). -->
	{#if r.check}
		<p
			class="mb-3 flex items-start gap-2 text-sm {r.check.ok ? 'text-ink-muted' : 'rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-danger'} print:text-black"
			role={r.check.ok ? undefined : 'alert'}
		>
			{#if r.check.ok}
				<CircleCheckIcon class="mt-0.5 size-4 shrink-0 text-ok print:hidden" />
			{:else}
				<TriangleAlertIcon class="mt-0.5 size-4 shrink-0" />
			{/if}
			<span>{r.check.text}</span>
		</p>
	{/if}

	<!-- Cash accounts vs. the ledger. Quiet when they agree; loud, with reasons, when they don't. -->
	{#if r.tieOut}
		{#if r.tieOut.ok}
			<p class="mb-4 flex items-start gap-2 text-sm text-ink-muted print:text-black">
				<CircleCheckIcon class="mt-0.5 size-4 shrink-0 text-ok print:hidden" />
				<span>Cash accounts tie out to the ledger ({r.tieOut.checked} checked, as of now).</span>
			</p>
		{:else}
			<div class="mb-4 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2.5 text-sm" role="alert">
				<p class="flex items-start gap-2 font-medium text-danger">
					<TriangleAlertIcon class="mt-0.5 size-4 shrink-0" />
					<span>Cash doesn't tie out to the ledger (as of now)</span>
				</p>
				<ul class="mt-2 space-y-2">
					{#each r.tieOut.failing as f (f.name)}
						<li>
							<span class="font-medium text-ink">{f.name}</span>
							<span class="text-ink-muted"> — account shows {peso(f.stored)}, ledger shows {peso(f.ledger)}</span>
							<ul class="mt-0.5 list-disc pl-5 text-ink-muted">
								{#each f.reasons as reason (reason)}<li>{reason}</li>{/each}
							</ul>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}

	<dl class="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm print:text-black">
		{#each r.summary as [k, v] (k)}
			<div>
				<dt class="inline text-ink-muted print:text-black">{k}:</dt>
				<dd class="inline font-medium text-ink tabular-nums print:text-black">{r.moneySummaryKeys?.includes(k) ? peso(v) : v}</dd>
			</div>
		{/each}
	</dl>

	<div class="overflow-x-auto rounded-xl border border-border print:overflow-visible print:rounded-none print:border-0">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					{#each r.columns as c, i (c)}
						<Table.Head class={isMoney(i) ? 'text-right print:text-black' : 'print:text-black'}>{c}</Table.Head>
					{/each}
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each r.rows as row, ri (ri)}
					{@const m = r.rowMeta?.[ri] ?? null}
					{#if m?.kind === 'section'}
						<Table.Row class="bg-surface-2 hover:bg-surface-2 print:break-inside-avoid">
							<Table.Cell colspan={r.columns.length} class="font-semibold text-ink print:text-black">{row[0]}</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row
							class="print:break-inside-avoid {m?.kind === 'total'
								? 'border-t-2 border-border font-semibold'
								: m?.kind === 'subtotal'
									? 'border-t border-border font-medium'
									: ''} {m?.kind === 'opening' ? 'italic' : ''}"
						>
							{#each row as cell, ci (ci)}
								<Table.Cell
									class="{isMoney(ci) ? 'text-right tabular-nums' : ''} {r.moneyColumns
										? ci === 0 && !m?.kind
											? 'text-ink-muted tabular-nums'
											: 'text-ink'
										: ci === 0
											? 'text-ink'
											: 'text-ink-muted'} print:text-black"
								>
									{#if m?.detail && ci === 1}
										<button
											type="button"
											onclick={() => (expanded[ri] = !expanded[ri])}
											aria-expanded={!!expanded[ri]}
											class="inline-flex items-center gap-1 rounded underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
										>
											{#if expanded[ri]}<ChevronDownIcon class="size-3.5 print:hidden" />{:else}<ChevronRightIcon class="size-3.5 print:hidden" />{/if}
											{cell}
										</button>
									{:else if isMoney(ci) && r.moneyColumns}
										{money(cell)}
									{:else}
										{cell}
									{/if}
								</Table.Cell>
							{/each}
						</Table.Row>
						{#if m?.detail && expanded[ri]}
							<Table.Row class="bg-surface-2/60 hover:bg-surface-2/60 print:hidden">
								<Table.Cell colspan={r.columns.length} class="py-2">
									<div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
										<table class="min-w-[18rem] text-xs">
											<thead class="text-ink-muted">
												<tr>
													<th class="pr-4 text-left font-medium">Account</th>
													<th class="pr-4 text-right font-medium">Debit</th>
													<th class="text-right font-medium">Credit</th>
												</tr>
											</thead>
											<tbody>
												{#each m.detail as l, li (li)}
													<tr>
														<td class="pr-4 text-ink"><span class="text-ink-muted tabular-nums">{l.code}</span> {l.name}</td>
														<td class="pr-4 text-right tabular-nums text-ink">{money(l.debit)}</td>
														<td class="text-right tabular-nums text-ink">{money(l.credit)}</td>
													</tr>
												{/each}
											</tbody>
										</table>
										{#if m.link}
											<a href={linkHref(m.link)} class="text-xs text-ink underline underline-offset-2">{linkLabel(m.link)} →</a>
										{/if}
									</div>
								</Table.Cell>
							</Table.Row>
						{/if}
					{/if}
				{:else}
					<Table.Row>
						<Table.Cell colspan={r.columns.length} class="py-6 text-center text-ink-muted">{r.emptyMessage ?? 'No data.'}</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>

<style>
	@media print {
		:global(body) {
			background: #fff;
		}
	}
</style>
