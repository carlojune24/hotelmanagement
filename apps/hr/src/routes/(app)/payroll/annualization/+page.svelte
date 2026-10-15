<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { money } from '$lib/components/payroll/money';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let busy = $state(false);

	$effect(() => {
		if (form && 'error' in form && form.error) toast.error(form.error);
		else if (form && 'ok' in form && form.ok) toast.success(form.ok);
	});

	function submit() {
		busy = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = false;
		};
	}
	const signed = (c: number) => (c > 0 ? money(c) : `− ${money(-c)}`);
	const batchLabel = (b: PageData['drafts'][number]) =>
		`${b.establishment} · ${b.cutoffStart} → ${b.cutoffEnd} · pay ${b.payDate}`;
</script>

<svelte:head><title>Year-end tax · HR</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-6">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-5xl font-light tracking-tight">Year-end tax</h1>
			<p class="mt-2 max-w-2xl text-sm text-ink-muted">
				Each person's income tax for the whole year, compared with what payroll withheld period by period. The
				difference is withheld or returned in the year's last payroll.
			</p>
		</div>
		<div class="flex items-center gap-2">
			<Button variant="outline" size="sm" href="?year={data.year - 1}">← {data.year - 1}</Button>
			<span class="px-2 text-lg tabular-nums">{data.year}</span>
			<Button variant="outline" size="sm" href="?year={data.year + 1}">{data.year + 1} →</Button>
		</div>
	</div>

	<section class="panel space-y-4 p-5 md:p-6" aria-label="Settle in a batch">
		<h2 class="text-xl font-light">Apply the settlement</h2>
		{#if data.drafts.length === 0}
			<p class="rounded-lg border border-dashed border-ink/30 px-4 py-3 text-sm text-ink-muted">
				There is no draft batch paid in {data.year}. Generate the year's last payroll first, then come back.
			</p>
		{:else}
			<form method="POST" action="?/apply" use:enhance={submit} class="flex flex-wrap items-end gap-3">
				<input type="hidden" name="year" value={data.year} />
				<div class="min-w-72 flex-1 space-y-1.5">
					<label for="batchId" class="text-sm font-medium">Draft batch to settle in</label>
					<select
						id="batchId"
						name="batchId"
						required
						class="h-10 w-full rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						{#each data.drafts as b (b.batchId)}<option value={b.batchId}>{batchLabel(b)}</option>{/each}
					</select>
				</div>
				<Button type="submit" variant="gold" disabled={busy}>Apply settlement</Button>
			</form>
			<p class="text-xs text-ink-muted">
				Extra tax is added to withholding and a refund is paid back as a tax-exempt earning, on each person's
				line. Run it again after regenerating the batch or changing anything in the year: it always recomputes
				from scratch. Regenerating keeps the last figure, which may by then be out of date.
			</p>
		{/if}
	</section>

	<section class="panel p-5 md:p-6" aria-label="Year-end tax by person">
		{#if data.rows.length === 0}
			<div class="hatch rounded-2xl px-6 py-14 text-center">
				<p class="text-lg">No locked payslips paid in {data.year}</p>
				<p class="mx-auto mt-1 max-w-sm text-sm text-ink-muted">Lock the year's payrolls and the figures appear here.</p>
			</div>
		{:else}
			<dl class="mb-4 flex flex-wrap gap-x-10 gap-y-3 text-sm">
				<div><dt class="text-xs text-ink-muted">People</dt><dd class="font-medium tabular-nums">{data.totals.people}</dd></div>
				<div><dt class="text-xs text-ink-muted">Tax due for the year</dt><dd class="font-medium tabular-nums">{money(data.totals.taxDue)}</dd></div>
				<div><dt class="text-xs text-ink-muted">Withheld so far</dt><dd class="font-medium tabular-nums">{money(data.totals.withheld)}</dd></div>
				<div><dt class="text-xs text-ink-muted">Still to withhold</dt><dd class="font-medium tabular-nums">{money(data.totals.additional)}</dd></div>
				<div><dt class="text-xs text-ink-muted">To return</dt><dd class="font-medium tabular-nums">{money(data.totals.refund)}</dd></div>
			</dl>
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row class="hover:bg-transparent">
							<Table.Head>Employee</Table.Head>
							<Table.Head class="text-right">Gross pay</Table.Head>
							<Table.Head class="text-right">Exempt &amp; contrib.</Table.Head>
							<Table.Head class="text-right">Bonus &gt; ₱90,000</Table.Head>
							<Table.Head class="text-right">Taxable</Table.Head>
							<Table.Head class="text-right">Tax due</Table.Head>
							<Table.Head class="text-right">Withheld</Table.Head>
							<Table.Head class="text-right">Settlement</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.rows as r (r.employeeId)}
							<Table.Row>
								<Table.Cell class="max-w-56">
									<p class="font-medium">{r.name}</p>
									<p class="text-xs text-ink-muted">
										#{r.employeeNo}{r.status === 'separated' ? ' · separated' : ''}{r.withholdingExempt ? ' · exempt' : ''}
									</p>
									{#if !r.tin}<p class="text-xs font-medium text-danger">No TIN on file</p>{/if}
									{#if r.prevTaxable > 0}
										<p class="text-xs text-ink-muted">
											Includes {money(r.prevTaxable)} from {r.prevEmployerName || 'a previous employer'}
										</p>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(r.gross)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(r.exemptEarnings + r.contributions)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{r.benefitsTaxable > 0 ? money(r.benefitsTaxable) : '–'}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(r.taxable)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(r.taxDue)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(r.withheld + r.prevWithheld)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">
									{#if r.settlement === 0}
										<Badge variant="ok">Settled</Badge>
									{:else}
										<span class="font-medium">{signed(r.settlement)}</span>
										<span class="block text-xs text-ink-muted">
											{r.status === 'separated'
												? 'settle in final pay'
												: r.appliedInDraft === r.settlement
													? 'applied to the draft'
													: r.settlement > 0
														? 'withhold'
														: 'return'}
										</span>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
			<p class="mt-3 text-xs text-ink-muted">
				Counts locked and released payslips paid in {data.year}{data.drafts.length > 0
					? `, plus the ${data.drafts.length} draft ${data.drafts.length === 1 ? 'batch' : 'batches'} listed above as if final`
					: ''}, and the 13th month and other benefits issued over the year. Check the figures with your accountant before relying on them for filing.
			</p>
		{/if}
	</section>
</div>
