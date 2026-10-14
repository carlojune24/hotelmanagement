<script lang="ts">
	import type { CostCenterRow } from '$lib/cost-centers-core';
	import { money } from './money';

	let { rows }: { rows: CostCenterRow[] } = $props();

	const total = $derived({
		people: rows.reduce((a, r) => a + r.people, 0),
		gross: rows.reduce((a, r) => a + r.gross, 0),
		employer: rows.reduce((a, r) => a + r.employer, 0),
		total: rows.reduce((a, r) => a + r.total, 0)
	});
</script>

{#if rows.length > 0}
	<section class="panel space-y-3 p-5 md:p-6" aria-label="Cost by cost center">
		<div>
			<h2 class="text-2xl font-light">Cost by cost center</h2>
			<p class="text-sm text-ink-muted">
				Gross pay plus employer contributions, by the cost center each person is charged to. People with none
				are listed as Unassigned, so this always adds up to the run.
			</p>
		</div>
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
					{#each rows as r (r.code ?? '')}
						<tr class="border-b border-dotted border-ink/25 text-right">
							<td class="py-2 text-left">
								{#if r.code}<span class="font-mono text-xs text-ink-muted">{r.code}</span> {/if}{r.name}
							</td>
							<td class="tabular-nums">{r.people}</td>
							<td class="tabular-nums">{money(r.gross)}</td>
							<td class="tabular-nums">{money(r.employer)}</td>
							<td class="font-medium tabular-nums">{money(r.total)}</td>
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr class="text-right font-medium">
						<td class="py-2 text-left">Total</td>
						<td class="tabular-nums">{total.people}</td>
						<td class="tabular-nums">{money(total.gross)}</td>
						<td class="tabular-nums">{money(total.employer)}</td>
						<td class="tabular-nums">{money(total.total)}</td>
					</tr>
				</tfoot>
			</table>
		</div>
	</section>
{/if}
