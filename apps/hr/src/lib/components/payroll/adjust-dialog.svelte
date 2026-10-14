<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { LineView } from '$lib/server/hr/payroll-view';
	import { money } from './money';

	let {
		line,
		busy,
		run,
		onclose
	}: { line: LineView | null; busy: boolean; run: SubmitFunction; onclose: () => void } = $props();
</script>

<Dialog.Root open={line !== null} onOpenChange={(o) => !o && onclose()}>
	<Dialog.Content>
		{#if line}
			<Dialog.Header>
				<Dialog.Title class="font-display text-2xl font-light">{line.employeeName}</Dialog.Title>
				<Dialog.Description>
					Withholding tax is recomputed unless you set it yourself.
				</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/adjust" use:enhance={run} class="space-y-3">
				<input type="hidden" name="lineId" value={line.id} />
				<div class="space-y-1.5">
					<Label for="withholdingOverride">Withholding tax <span class="text-ink-muted">(blank = computed)</span></Label>
					<Input id="withholdingOverride" name="withholdingOverride" type="number" min="0" step="0.01" value={line.adjustments.withholdingOverride} />
				</div>
				<div class="rounded-2xl bg-ink/5 px-4 py-3 text-sm">
					<p class="font-medium">Pay items</p>
					{#if line.payItems.length === 0}
						<p class="mt-1 text-xs text-ink-muted">None for this cutoff.</p>
					{:else}
						<ul class="mt-1 space-y-0.5">
							{#each line.payItems as it (it.id)}
								<li class="flex justify-between gap-3 tabular-nums">
									<span>{it.label}</span>
									<span class={it.kind === 'deduction' ? 'text-danger' : ''}>{it.kind === 'deduction' ? '−' : ''}{money(it.amountCentavos)}</span>
								</li>
							{/each}
						</ul>
					{/if}
					<p class="mt-1 text-xs text-ink-muted">Add or void incentives, allowances and deductions under <a href="/pay-items" class="underline underline-offset-4">Pay items</a>; this payslip updates by itself.</p>
				</div>
				{#if line.loans.length > 0}
					<div class="rounded-2xl bg-ink/5 px-4 py-3 text-sm">
						<p class="font-medium">Loans, from the ledger</p>
						<ul class="mt-1 space-y-0.5">
							{#each line.loans as loan, i (i)}
								<li class="flex justify-between gap-3 tabular-nums">
									<span>{loan.label}</span>
									<span>
										{money(loan.deducted)}{#if loan.deducted < loan.due}
											<span class="text-ink-muted"> of {money(loan.due)} — {money(loan.due - loan.deducted)} short, carried over</span>{/if}
									</span>
								</li>
							{/each}
						</ul>
						<p class="mt-1 text-xs text-ink-muted">Change a loan under Loans, then regenerate this batch.</p>
					</div>
				{/if}
				<Dialog.Footer class="gap-2 pt-1">
					<Button type="button" variant="outline" onclick={onclose}>Close</Button>
					<Button type="submit" disabled={busy}>Save</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
