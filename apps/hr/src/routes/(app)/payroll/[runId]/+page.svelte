<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	type Batch = PageData['batches'][number];
	type Line = Batch['lines'][number];

	let busy = $state(false);
	let editing = $state<{ batch: Batch; line: Line } | null>(null);

	const money = (c: number) =>
		new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(c / 100);
	const ratesOk = $derived(data.run.ratesCheckedAt !== null);

	function run() {
		busy = true;
		return async ({
			result,
			update
		}: {
			result: { type: string; data?: unknown };
			update: (o?: { reset?: boolean }) => Promise<void>;
		}) => {
			await update({ reset: false });
			busy = false;
			const d = result.data as { ok?: string; error?: string } | undefined;
			if (result.type === 'success') {
				editing = null;
				toast.success(d?.ok ?? 'Done.');
			} else if (result.type === 'failure') toast.error(d?.error ?? 'Could not save.');
		};
	}
</script>

<svelte:head><title>Payroll {data.run.cutoffStart} · HR</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-6">
	<div>
		<p class="text-sm text-ink-muted"><a href="/payroll" class="underline-offset-4 hover:underline">Payroll</a></p>
		<h1 class="text-4xl font-light tracking-tight tabular-nums">
			{data.run.cutoffStart} → {data.run.cutoffEnd}
		</h1>
		<p class="mt-1 text-sm text-ink-muted">
			Pay date {data.run.payDate} · {data.run.frequency === 'monthly' ? 'monthly' : 'twice a month'} ·
			{data.run.dayFactor}-day factor. One payslip per person, listed under their home establishment.
		</p>
	</div>

	<section class="panel space-y-3 p-5" aria-label="Statutory rates">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h2 class="text-xl font-light">Rates in force</h2>
			{#if ratesOk}
				<Badge variant="ok">Confirmed for this run</Badge>
			{:else}
				<form method="POST" action="?/confirmRates" use:enhance={run}>
					<Button type="submit" variant="gold" disabled={busy}>I've checked these for this period</Button>
				</form>
			{/if}
		</div>
		<p class="text-sm text-ink-muted">
			These are the published figures this system applies. They are not fetched live — check them
			against the current SSS, PhilHealth, Pag-IBIG and BIR issuances before locking any batch.
		</p>
		<ul class="grid gap-1 text-sm sm:grid-cols-2">
			{#each data.rates as r (r.name)}
				<li class="rounded-xl bg-white/70 px-3 py-2">
					<span class="font-medium">{r.name}</span> — {r.rule}
					<span class="text-xs text-ink-muted"> (since {r.since})</span>
				</li>
			{/each}
		</ul>
	</section>

	{#each data.batches as b (b.id)}
		<section class="panel space-y-4 p-5" aria-label={b.establishmentName}>
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 class="text-2xl font-light">{b.establishmentName}</h2>
					<p class="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
						<Badge variant={b.dtrReceived ? 'ok' : 'muted'}>
							DTR {b.dtrReceived ? 'received' : 'not received'}
						</Badge>
						<Badge variant={b.status === 'released' ? 'ok' : b.status === 'locked' ? 'gold' : 'muted'}>
							{b.status === 'released' ? 'Released' : b.status === 'locked' ? 'Locked' : 'Draft'}
						</Badge>
						{#if b.count > 0}
							<span class="tabular-nums">{b.count} payslip{b.count === 1 ? '' : 's'} · net {money(b.net)}</span>
						{/if}
					</p>
				</div>
				<div class="flex flex-wrap gap-2">
					{#if b.status === 'draft'}
						<form method="POST" action="?/generate" use:enhance={run}>
							<input type="hidden" name="batchId" value={b.id} />
							<Button type="submit" variant="outline" disabled={busy || !b.dtrReceived}>
								{b.generatedAt ? 'Regenerate' : 'Generate'}
							</Button>
						</form>
						{#if b.generatedAt}
							<form method="POST" action="?/lock" use:enhance={run}>
								<input type="hidden" name="batchId" value={b.id} />
								<Button type="submit" disabled={busy || !ratesOk}>Lock</Button>
							</form>
						{/if}
					{:else if b.status === 'locked'}
						<form method="POST" action="?/unlock" use:enhance={run}>
							<input type="hidden" name="batchId" value={b.id} />
							<Button type="submit" variant="outline" disabled={busy}>Unlock</Button>
						</form>
						<form method="POST" action="?/release" use:enhance={run}>
							<input type="hidden" name="batchId" value={b.id} />
							<Button type="submit" variant="gold" disabled={busy}>Release payslips</Button>
						</form>
					{/if}
				</div>
			</div>

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
								<Table.Head>Employee</Table.Head>
								<Table.Head class="text-right">Basic</Table.Head>
								<Table.Head class="text-right">OT</Table.Head>
								<Table.Head class="text-right">Premiums</Table.Head>
								<Table.Head class="text-right">Gross</Table.Head>
								<Table.Head class="text-right">SSS · PhilHealth · Pag-IBIG</Table.Head>
								<Table.Head class="text-right">Tax</Table.Head>
								<Table.Head class="text-right">Other</Table.Head>
								<Table.Head class="text-right">Net</Table.Head>
								<Table.Head><span class="sr-only">Actions</span></Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each b.lines as l (l.id)}
								<Table.Row>
									<Table.Cell>
										<p class="font-medium">{l.employeeName}</p>
										<p class="text-xs text-ink-muted">
											#{l.employeeNo} · {l.position}{l.sharedWith.length
? ` · also at ${l.sharedWith.join(', ')}`
												: ''}
										</p>
										{#if l.loans.some((x) => x.deducted < x.due)}
											<p class="text-xs font-medium text-danger">
												Loan only partly deducted — {money(l.loans.reduce((t, x) => t + (x.due - x.deducted), 0))} carried over
											</p>
										{/if}
									</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{money(l.basic)}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{money(l.overtime)}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{money(l.premium)}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{money(l.gross)}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{money(l.statutory)}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{money(l.tax)}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{money(l.other)}</Table.Cell>
									<Table.Cell class="text-right font-medium tabular-nums">{money(l.net)}</Table.Cell>
									<Table.Cell class="text-right whitespace-nowrap">
										{#if b.status === 'draft'}
											<Button variant="ghost" size="sm" onclick={() => (editing = { batch: b, line: l })}>Adjust</Button>
										{/if}
										<Button
											variant="ghost"
											size="sm"
											href="/print/{b.establishmentSlug}/payslip/{l.id}"
											target="_blank"
											rel="noopener">Payslip</Button
										>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			{:else if b.generatedAt}
				<p class="text-sm text-ink-muted">Nothing to pay for this cutoff.</p>
			{/if}
		</section>
	{/each}
</div>

<Dialog.Root open={editing !== null} onOpenChange={(o) => !o && (editing = null)}>
	<Dialog.Content>
		{#if editing}
			<Dialog.Header>
				<Dialog.Title class="font-display text-2xl font-light">{editing.line.employeeName}</Dialog.Title>
				<Dialog.Description>
					Amounts in pesos. Withholding tax is recomputed unless you set it yourself.
				</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/adjust" use:enhance={run} class="space-y-3">
				<input type="hidden" name="lineId" value={editing.line.id} />
				<div class="grid grid-cols-2 gap-3">
					<div class="space-y-1.5">
						<Label for="allowances">Allowances</Label>
						<Input id="allowances" name="allowances" type="number" min="0" step="0.01" value={editing.line.adjustments.allowances} />
					</div>
					<div class="space-y-1.5">
						<Label for="otherEarnings">Other earnings</Label>
						<Input id="otherEarnings" name="otherEarnings" type="number" min="0" step="0.01" value={editing.line.adjustments.otherEarnings} />
					</div>
					<div class="space-y-1.5">
						<Label for="cashAdvance">Cash advance</Label>
						<Input id="cashAdvance" name="cashAdvance" type="number" min="0" step="0.01" value={editing.line.adjustments.cashAdvance} />
					</div>

					<div class="space-y-1.5">
						<Label for="otherDeductions">Other deductions</Label>
						<Input id="otherDeductions" name="otherDeductions" type="number" min="0" step="0.01" value={editing.line.adjustments.otherDeductions} />
					</div>
					<div class="space-y-1.5">
						<Label for="withholdingOverride">Withholding tax <span class="text-ink-muted">(blank = computed)</span></Label>
						<Input id="withholdingOverride" name="withholdingOverride" type="number" min="0" step="0.01" value={editing.line.adjustments.withholdingOverride} />
					</div>
</div>
					{#if editing.line.loans.length > 0}
						<div class="rounded-2xl bg-ink/5 px-4 py-3 text-sm">
							<p class="font-medium">Loans, from the ledger</p>
							<ul class="mt-1 space-y-0.5">
								{#each editing.line.loans as loan, i (i)}
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
					<Button type="button" variant="outline" onclick={() => (editing = null)}>Close</Button>
					<Button type="submit" disabled={busy}>Save</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
