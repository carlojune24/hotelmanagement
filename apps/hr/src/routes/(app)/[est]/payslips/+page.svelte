<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const money = (c: number) =>
		new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(c / 100);
</script>

<svelte:head><title>Payslips · HR</title></svelte:head>

<div class="space-y-6 p-4 sm:p-6">
	<div>
		<h2 class="text-base font-semibold text-ink">Payslips</h2>
		<p class="text-sm text-ink-muted">
			Released by Main HR for the people based here. Government numbers are masked.
		</p>
	</div>

	{#each data.groups as g (g.cutoffStart + g.cutoffEnd)}
		<section class="space-y-2">
			<h3 class="text-sm font-medium tabular-nums">
				{g.cutoffStart} → {g.cutoffEnd}
				<span class="font-normal text-ink-muted">· pay date {g.payDate}</span>
			</h3>
			<div class="overflow-hidden rounded-2xl border border-border">
				<Table.Root>
					<Table.Header>
						<Table.Row class="hover:bg-transparent">
							<Table.Head>Employee</Table.Head>
							<Table.Head>Position</Table.Head>
							<Table.Head class="text-right">Net pay</Table.Head>
							<Table.Head><span class="sr-only">Payslip</span></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each g.slips as s (s.id)}
							<Table.Row>
								<Table.Cell class="font-medium">{s.employeeName} <span class="font-normal text-ink-muted">#{s.employeeNo}</span></Table.Cell>
								<Table.Cell class="text-ink-muted">{s.position}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(s.netPayCentavos)}</Table.Cell>
								<Table.Cell class="text-right">
									<Button
										variant="outline"
										size="sm"
										href="/print/{page.params.est}/payslip/{s.id}"
										target="_blank"
										rel="noopener">View / print</Button
									>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</section>
	{:else}
		<div class="hatch rounded-2xl px-6 py-14 text-center">
			<p class="text-lg">No payslips released yet</p>
			<p class="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
				They appear here once Main HR releases a payroll run for this establishment.
			</p>
		</div>
	{/each}
</div>
