<script lang="ts">
	import { goto } from '$app/navigation';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import { money } from '$lib/components/payroll/money';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// svelte-ignore state_referenced_locally
	let month = $state(data.month);
	// svelte-ignore state_referenced_locally
	let est = $state(data.est);
	// svelte-ignore state_referenced_locally
	let drafts = $state(data.includeDrafts);

	const qs = $derived(
		new URLSearchParams({ month, ...(est ? { est } : {}), ...(drafts ? { drafts: '1' } : {}) }).toString()
	);
	function apply() {
		goto(`?${qs}`, { keepFocus: true, noScroll: true });
	}
	const monthLabel = $derived(
		new Date(`${data.month}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
	);
	let open = $state<Record<string, boolean>>({});
	const keyOf = (c: { code: string | null }) => c.code ?? '';
	const r = $derived(data.report);
</script>

<section class="panel space-y-5 p-5 md:p-6" aria-label="Cost by cost center">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="max-w-xl">
			<h2 class="text-2xl font-light">Cost by cost center</h2>
			<p class="mt-1 text-sm text-ink-muted">
				Gross pay plus employer contributions for payslips whose cutoff ends in the month, by the cost center
				each person was charged to when payroll was built.
			</p>
		</div>
		<div class="flex gap-2">
			<Button variant="outline" href="/print/reports/cost-centers?{qs}" target="_blank" rel="noopener"><PrinterIcon /> Print</Button>
			<Button variant="outline" href="/reports/cost-centers/csv?{qs}" data-sveltekit-reload><DownloadIcon /> CSV</Button>
		</div>
	</div>

	<div class="flex flex-wrap items-end gap-3">
		<div class="space-y-1.5">
			<Label for="month">Month</Label>
			<Input id="month" type="month" bind:value={month} onchange={apply} class="w-44" />
		</div>
		<div class="space-y-1.5">
			<Label for="est">Establishment</Label>
			<select
				id="est"
				bind:value={est}
				onchange={apply}
				class="h-10 w-56 rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<option value="">All establishments</option>
				{#each data.establishments as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
			</select>
		</div>
		<label class="flex h-10 items-center gap-2 text-sm">
			<input type="checkbox" bind:checked={drafts} onchange={apply} class="size-4 accent-[var(--gold-deep)]" />
			Include draft payslips
		</label>
	</div>

	{#if r.lines === 0}
		<div class="rounded-2xl border border-dashed border-ink/30 px-6 py-12 text-center">
			<p class="text-lg font-light">No payslips for {monthLabel}</p>
			<p class="mx-auto mt-1 max-w-md text-sm text-ink-muted">
				Only locked and released payslips are counted{drafts ? '' : '. Tick "Include draft payslips" to see work in progress'}.
			</p>
		</div>
	{:else}
		{#if r.draftLines > 0}
			<p class="rounded-xl bg-gold-soft px-4 py-2 text-sm">
				<Badge variant="gold">Draft</Badge> {r.draftLines} of {r.lines} payslip{r.lines === 1 ? '' : 's'} are still drafts; these figures can change.
			</p>
		{/if}
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-ink/20 text-right text-xs text-ink-muted">
						<th class="py-2 text-left font-medium">Cost center</th>
						<th class="font-medium">People</th>
						<th class="font-medium">Gross</th>
						<th class="font-medium">Employer</th>
						<th class="font-medium">Total</th>
					</tr>
				</thead>
				<tbody>
					{#each r.centers as c (keyOf(c))}
						<tr class="border-b border-dotted border-ink/25 text-right">
							<td class="py-2 text-left">
								<button
									type="button"
									class="inline-flex items-center gap-1.5 text-left"
									aria-expanded={!!open[keyOf(c)]}
									onclick={() => (open[keyOf(c)] = !open[keyOf(c)])}
								>
									<ChevronDownIcon class="size-4 transition-transform {open[keyOf(c)] ? '' : '-rotate-90'}" />
									{#if c.code}<span class="font-mono text-xs text-ink-muted">{c.code}</span>{/if}
									<span>{c.name}</span>
								</button>
							</td>
							<td class="tabular-nums">{c.people}</td>
							<td class="tabular-nums">{money(c.gross)}</td>
							<td class="tabular-nums">{money(c.employer)}</td>
							<td class="font-medium tabular-nums">{money(c.total)}</td>
						</tr>
						{#if open[keyOf(c)]}
							<tr>
								<td colspan="5" class="bg-ink/5 px-4 py-3">
									<div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
										<div>
											<p class="mb-1 text-xs font-medium text-ink-muted">By establishment</p>
											<ul class="space-y-0.5 text-sm">
												{#each c.establishments as e (e.name)}
													<li class="flex justify-between gap-3 tabular-nums">
														<span>{e.name} <span class="text-ink-muted">· {e.people}</span></span>
														<span>{money(e.total)}</span>
													</li>
												{/each}
											</ul>
										</div>
										<div>
											<p class="mb-1 text-xs font-medium text-ink-muted">People</p>
											<ul class="space-y-0.5 text-sm">
												{#each c.persons as p (p.employeeId)}
													<li class="flex justify-between gap-3 tabular-nums">
														<span>
															{p.name} <span class="text-ink-muted">#{p.employeeNo} · {p.establishment}{p.payslips > 1 ? ` · ${p.payslips} payslips` : ''}</span>
														</span>
														<span>{money(p.total)}</span>
													</li>
												{/each}
											</ul>
										</div>
									</div>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
				<tfoot>
					<tr class="text-right font-medium">
						<td class="py-2 text-left">Total</td>
						<td class="tabular-nums">{r.totals.people}</td>
						<td class="tabular-nums">{money(r.totals.gross)}</td>
						<td class="tabular-nums">{money(r.totals.employer)}</td>
						<td class="tabular-nums">{money(r.totals.total)}</td>
					</tr>
				</tfoot>
			</table>
		</div>
	{/if}
</section>
