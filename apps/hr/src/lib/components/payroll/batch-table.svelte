<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { BatchView, LineView } from '$lib/server/hr/payroll-view';
	import { amt, money } from './money';

	let { b, onadjust }: { b: BatchView; onadjust: (line: LineView) => void } = $props();
	const showExtras = $derived(b.lines.some((x) => x.extras > 0));
	const keys = [
		'basic', 'overtime', 'premium', 'extras', 'gross', 'sss', 'philhealth', 'pagibig', 'tax',
		'lateUndertime', 'loanDeductions', 'cashAdvance', 'otherDeductions', 'net'
	] as const;
	const total = $derived(
		Object.fromEntries(keys.map((k) => [k, b.lines.reduce((t, l) => t + l[k], 0)])) as Record<(typeof keys)[number], number>
	);
</script>

{#if !b.dtrReceived}
	<p class="text-sm text-ink-muted">
		Payroll is built from received DTRs only.
		{#each b.dtrStatuses.filter((s) => s.status !== 'received') as s (s.month)}
			{s.month}: {s.status === 'draft' ? 'not sent' : s.status}.
		{/each}
	</p>
{/if}

{#if b.lines.length > 0}
	<div class="overflow-x-auto">
		<Table.Root>
			<Table.Header>
				<Table.Row class="hover:bg-transparent">
					<Table.Head class="align-top">Employee</Table.Head>
					<Table.Head class="text-right align-top">Basic</Table.Head>
					<Table.Head class="border-l border-dotted border-ink/20 text-right align-top">
						<span class="block text-[11px] tracking-wide uppercase">Incentives</span>
						<span class="mt-1 block leading-6 font-normal">OT</span>
						<span class="block leading-6 font-normal">Premiums</span>
						{#if showExtras}<span class="block leading-6 font-normal">Allowances</span>{/if}
					</Table.Head>
					<Table.Head class="border-l border-dotted border-ink/20 text-right align-top">Gross</Table.Head>
					<Table.Head class="border-l border-dotted border-ink/20 text-right align-top">
						<span class="block text-[11px] tracking-wide uppercase">Government</span>
						<span class="mt-1 block leading-6 font-normal">SSS</span>
						<span class="block leading-6 font-normal">PhilHealth</span>
						<span class="block leading-6 font-normal">Pag-IBIG</span>
						<span class="block leading-6 font-normal">Tax</span>
					</Table.Head>
					<Table.Head class="border-l border-dotted border-ink/20 text-right align-top">
						<span class="block text-[11px] tracking-wide uppercase">Other deductions</span>
						<span class="mt-1 block leading-6 font-normal">Late / undertime</span>
						<span class="block leading-6 font-normal">Loans</span>
						<span class="block leading-6 font-normal">Cash advance</span>
						<span class="block leading-6 font-normal">Other</span>
					</Table.Head>
					<Table.Head class="border-l border-dotted border-ink/20 text-right align-top">Net</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each b.lines as l (l.id)}
					<Table.Row>
						<Table.Cell class="align-top">
							<p class="font-medium">{l.employeeName}</p>
							<p class="text-xs text-ink-muted">
								#{l.employeeNo} · {l.position}{l.sharedWith.length ? ` · also at ${l.sharedWith.join(', ')}` : ''}
							</p>
							{#if l.loans.some((x) => x.deducted < x.due)}
								<p class="text-xs font-medium text-danger">
									Loan only partly deducted — {money(l.loans.reduce((t, x) => t + (x.due - x.deducted), 0))} carried over
								</p>
							{/if}
							<div class="mt-2 flex flex-wrap gap-1.5">
								{#if b.status === 'draft'}
									<Button variant="gold" size="xs" onclick={() => onadjust(l)}>Adjust</Button>
								{/if}
								<Button variant="default" size="xs" href="/print/{b.establishmentSlug}/payslip/{l.id}" target="_blank" rel="noopener">
									Payslip
								</Button>
							</div>
						</Table.Cell>
						<Table.Cell class="text-right align-top tabular-nums">{money(l.basic)}</Table.Cell>
						<Table.Cell class="border-l border-dotted border-ink/20 text-right align-top text-sm leading-6 tabular-nums">
							<span class="block">{amt(l.overtime)}</span>
							<span class="block">{amt(l.premium)}</span>
							{#if showExtras}<span class="block">{amt(l.extras)}</span>{/if}
						</Table.Cell>
						<Table.Cell class="border-l border-dotted border-ink/20 text-right align-top font-medium tabular-nums">{money(l.gross)}</Table.Cell>
						<Table.Cell class="border-l border-dotted border-ink/20 text-right align-top text-sm leading-6 tabular-nums">
							<span class="block">{amt(l.sss)}</span>
							<span class="block">{amt(l.philhealth)}</span>
							<span class="block">{amt(l.pagibig)}</span>
							<span class="block">{amt(l.tax)}</span>
						</Table.Cell>
						<Table.Cell class="border-l border-dotted border-ink/20 text-right align-top text-sm leading-6 tabular-nums">
							<span class="block">{amt(l.lateUndertime)}</span>
							<span class="block">{amt(l.loanDeductions)}</span>
							<span class="block">{amt(l.cashAdvance)}</span>
							<span class="block">{amt(l.otherDeductions)}</span>
						</Table.Cell>
						<Table.Cell class="border-l border-dotted border-ink/20 text-right align-top font-medium tabular-nums">{money(l.net)}</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
			<Table.Footer class="border-t border-ink/30 bg-transparent">
				<Table.Row class="hover:bg-transparent">
					<Table.Cell class="align-top">
						<p class="font-medium">Total</p>
						<p class="text-xs text-ink-muted">{b.lines.length} payslip{b.lines.length === 1 ? '' : 's'}</p>
					</Table.Cell>
					<Table.Cell class="text-right align-top tabular-nums">{money(total.basic)}</Table.Cell>
					<Table.Cell class="border-l border-dotted border-ink/20 text-right align-top text-sm leading-6 tabular-nums">
						<span class="block">{amt(total.overtime)}</span>
						<span class="block">{amt(total.premium)}</span>
						{#if showExtras}<span class="block">{amt(total.extras)}</span>{/if}
					</Table.Cell>
					<Table.Cell class="border-l border-dotted border-ink/20 text-right align-top tabular-nums">{money(total.gross)}</Table.Cell>
					<Table.Cell class="border-l border-dotted border-ink/20 text-right align-top text-sm leading-6 tabular-nums">
						<span class="block">{amt(total.sss)}</span>
						<span class="block">{amt(total.philhealth)}</span>
						<span class="block">{amt(total.pagibig)}</span>
						<span class="block">{amt(total.tax)}</span>
					</Table.Cell>
					<Table.Cell class="border-l border-dotted border-ink/20 text-right align-top text-sm leading-6 tabular-nums">
						<span class="block">{amt(total.lateUndertime)}</span>
						<span class="block">{amt(total.loanDeductions)}</span>
						<span class="block">{amt(total.cashAdvance)}</span>
						<span class="block">{amt(total.otherDeductions)}</span>
					</Table.Cell>
					<Table.Cell class="border-l border-dotted border-ink/20 text-right align-top tabular-nums">{money(total.net)}</Table.Cell>
				</Table.Row>
			</Table.Footer>
		</Table.Root>
	</div>
{:else if b.generatedAt}
	<p class="text-sm text-ink-muted">Nothing to pay for this cutoff.</p>
{/if}
