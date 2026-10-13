<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	$effect(() => {
		if (form?.error) toast.error(form.error);
		else if (form && 'ok' in form && form.ok) toast.success(form.ok);
	});

	const money = (c: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(c / 100);
	const isBir = $derived(data.agency === 'bir');
	const isLoan = $derived(data.agency === 'sss_loan' || data.agency === 'pagibig_loan');
	/** Contribution schedules have an employer share; tax and loan collections do not. */
	const hasEmployer = $derived(!isBir && !isLoan);
	const hasEc = $derived(data.agency === 'sss');
	const remitted = $derived(data.record?.status === 'remitted');
	const base = $derived(`/remittances/${data.agency}/${data.period}`);
</script>

<svelte:head><title>{data.label} {data.period} · Remittances · HR</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
	<div>
		<a href="/remittances?period={data.period}" class="text-sm text-ink-muted hover:underline">← Remittances</a>
		<div class="flex flex-wrap items-center gap-3">
			<h1 class="text-5xl font-light tracking-tight">{data.label}</h1>
			{#if remitted}<Badge variant="secondary">Remitted</Badge>{:else}<Badge variant="outline">Open</Badge>{/if}
		</div>
		<p class="mt-1 text-sm text-ink-muted tabular-nums">
			Paid in {data.period}{#if data.dueDate} · due {data.dueDate}{/if}{#if data.employerNo} · employer no. {data.employerNo}{/if}
		</p>
		<p class="mt-1 text-sm text-ink-muted">
			{#if isLoan}
				Taken from each payslip's loan deductions. Loans are collected and paid separately from contributions.
			{:else}
				Computed from the statutory rates on file, <strong class="font-medium text-ink">not yet verified</strong>
				against the current circulars.
			{/if}
		</p>
	</div>

	{#if data.draftBatches > 0}
		<p class="rounded-lg border border-dashed border-ink/30 px-4 py-3 text-sm">
			{data.draftBatches} payroll batch{data.draftBatches === 1 ? '' : 'es'} paid this month
			{data.draftBatches === 1 ? 'is' : 'are'} not locked yet — this schedule is incomplete until
			{data.draftBatches === 1 ? 'it is' : 'they are'} locked.
		</p>
	{/if}
	{#if data.skipped.length > 0}
		<section class="rounded-lg border border-dashed border-ink/30 px-4 py-3 text-sm">
			<p class="font-medium">Skipped this month — not deducted, so not on this schedule</p>
			<p class="mt-0.5 text-ink-muted">The agency still expects these payments; the loan may show as behind until they are made.</p>
			<ul class="mt-2">
				{#each data.skipped as k (k.employeeNo + (k.reference ?? ''))}
					<li>
						{k.name} <span class="text-ink-muted">(#{k.employeeNo}{k.reference ? ` · ref ${k.reference}` : ''})</span> — {k.reason}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
	{#if data.schedule.missingId.length > 0}
		<p class="rounded-lg border border-dashed border-ink/30 px-4 py-3 text-sm">
			No {isBir ? 'TIN' : 'ID number'} on file for: {data.schedule.missingId.join('; ')}.
		</p>
	{/if}

	<section class="panel overflow-x-auto p-2">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Employee</Table.Head>
					<Table.Head>{isBir ? 'TIN' : 'ID number'}</Table.Head>
					{#if isLoan}<Table.Head>Loan reference</Table.Head>{/if}
					<Table.Head class="text-right">{isBir ? 'Tax withheld' : isLoan ? 'Amount deducted' : 'Employee share'}</Table.Head>
					{#if hasEmployer}<Table.Head class="text-right">Employer share</Table.Head>{/if}
					{#if hasEc}<Table.Head class="text-right">EC</Table.Head>{/if}
					<Table.Head class="text-right">Total</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.schedule.rows as r (r.employeeId)}
					<Table.Row>
						<Table.Cell>
							<div class="font-medium">{r.name}</div>
							<div class="text-xs text-ink-muted">{r.employeeNo}</div>
						</Table.Cell>
						<Table.Cell class="tabular-nums">{r.idNumber ?? '—'}</Table.Cell>
						{#if isLoan}<Table.Cell class="tabular-nums">{r.reference ?? '—'}</Table.Cell>{/if}
						<Table.Cell class="text-right tabular-nums">{money(r.employee)}</Table.Cell>
						{#if hasEmployer}<Table.Cell class="text-right tabular-nums">{money(r.employer)}</Table.Cell>{/if}
						{#if hasEc}<Table.Cell class="text-right tabular-nums">{money(r.ec)}</Table.Cell>{/if}
						<Table.Cell class="text-right font-medium tabular-nums">{money(r.total)}</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={6} class="py-8 text-center text-ink-muted">
							No locked payslips were paid in this month yet.
						</Table.Cell>
					</Table.Row>
				{/each}
				{#if data.schedule.rows.length > 0}
					<Table.Row class="font-medium">
						<Table.Cell colspan={isLoan ? 3 : 2}>Total</Table.Cell>
						<Table.Cell class="text-right tabular-nums">{money(data.schedule.totals.employee)}</Table.Cell>
						{#if hasEmployer}<Table.Cell class="text-right tabular-nums">{money(data.schedule.totals.employer)}</Table.Cell>{/if}
						{#if hasEc}<Table.Cell class="text-right tabular-nums">{money(data.schedule.totals.ec)}</Table.Cell>{/if}
						<Table.Cell class="text-right tabular-nums">{money(data.schedule.totals.total)}</Table.Cell>
					</Table.Row>
				{/if}
			</Table.Body>
		</Table.Root>
	</section>

	{#if data.byEstablishment.length > 1}
		<section class="panel space-y-2 p-5">
			<h2 class="text-lg font-light">By establishment (for cost allocation)</h2>
			<ul class="text-sm">
				{#each data.byEstablishment as e (e.name)}
					<li class="flex justify-between border-b border-ink/10 py-1.5">
						<span>{e.name}</span><span class="tabular-nums">{money(e.total)}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if data.schedule.notCovered.length > 0}
		<section class="panel space-y-2 p-5">
			<h2 class="text-lg font-light">Not covered — left out on purpose</h2>
			<ul class="text-sm text-ink-muted">
				{#each data.schedule.notCovered as n (n.name)}
					<li>{n.name}{n.note ? ` — ${n.note}` : ''}</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="panel space-y-4 p-5 md:p-6">
		{#if remitted && data.record}
			<h2 class="text-xl font-light">Remitted</h2>
			<p class="text-sm tabular-nums">
				{money(data.record.amountCentavos ?? 0)} on {data.record.remittedOn} · ref {data.record.referenceNo}
				· {data.record.lineCount} {data.record.lineCount === 1 ? 'person' : 'people'}
			</p>
			{#if data.record.note}<p class="text-sm text-ink-muted">{data.record.note}</p>{/if}
			<form method="POST" action="?/reopen" use:enhance>
				<Button type="submit" variant="outline">Reopen</Button>
			</form>
		{:else}
			<h2 class="text-xl font-light">Mark as remitted</h2>
			<form method="POST" action="?/remit" use:enhance class="grid gap-3 sm:grid-cols-3 sm:items-end">
				<div>
					<Label for="remittedOn">Date paid</Label>
					<Input id="remittedOn" name="remittedOn" type="date" required class="mt-1" />
				</div>
				<div>
					<Label for="referenceNo">Payment reference no.</Label>
					<Input id="referenceNo" name="referenceNo" required class="mt-1" />
				</div>
				<div>
					<Label for="note">Note (optional)</Label>
					<Input id="note" name="note" class="mt-1" />
				</div>
				<div class="sm:col-span-3">
					<Button type="submit">Mark as remitted</Button>
				</div>
			</form>
		{/if}
		<div class="flex gap-2 border-t border-ink/10 pt-4">
			<Button variant="outline" href="/print/remittance/{data.agency}/{data.period}" target="_blank">Print</Button>
			<Button variant="outline" href="{base}/export" data-sveltekit-reload>Download CSV</Button>
		</div>
	</section>
</div>
