<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import SearchIcon from '@lucide/svelte/icons/search';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Filter = 'active' | 'paused' | 'closed' | 'all';
	const FILTERS: Array<{ key: Filter; label: string }> = [
		{ key: 'active', label: 'Active' },
		{ key: 'paused', label: 'Paused' },
		{ key: 'closed', label: 'Closed' },
		{ key: 'all', label: 'All' }
	];
	const STATUS_LABEL = { active: 'Active', paused: 'Paused', paid_off: 'Paid off', cancelled: 'Cancelled' } as const;

	let query = $state('');
	let filter = $state<Filter>('active');
	let kind = $state('all');
	let creating = $state(false);
	let busy = $state(false);

	const money = (c: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(c / 100);
	const pesos = (c: number) => (c / 100).toFixed(2);
	const selectClass =
		'h-10 w-full rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

	const rows = $derived(
		data.loans.filter((l) => {
			const q = query.trim().toLowerCase();
			const inFilter =
				filter === 'all' ||
				(filter === 'closed' ? l.status === 'paid_off' || l.status === 'cancelled' : l.status === filter);
			return (
				inFilter &&
				(kind === 'all' || l.kind === kind) &&
				(!q ||
					l.employeeName.toLowerCase().includes(q) ||
					l.employeeNo.toLowerCase().includes(q) ||
					(l.referenceNo ?? '').toLowerCase().includes(q))
			);
		})
	);
	const open = $derived(data.loans.find((l) => l.id === data.openId) ?? null);
	const isClosed = $derived(open ? open.status === 'paid_off' || open.status === 'cancelled' : false);
	const monthsLeft = (l: { balance: number; amortization: number }) => Math.ceil(l.balance / Math.max(1, l.amortization));

	$effect(() => {
		if (form && 'error' in form && form.error) toast.error(form.error);
		else if (form && 'ok' in form && form.ok) {
			toast.success(form.ok);
			creating = false;
		}
	});

	const show = (id: string | null) =>
		goto(id ? `?loan=${id}` : '?', { noScroll: true, keepFocus: true, replaceState: false });

	function submit() {
		busy = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = false;
		};
	}
</script>

<svelte:head><title>Loans · HR</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
	<div>
		<h1 class="text-5xl font-light tracking-tight">Loans</h1>
		<p class="mt-2 max-w-2xl text-sm text-ink-muted">
			SSS, Pag-IBIG and company loans taken out of pay. An active loan is deducted automatically when you
			generate payroll — half in each cutoff — and shows on the SSS / Pag-IBIG loan remittance for the month.
		</p>
	</div>

	<section class="panel space-y-5 p-5 md:p-6" aria-label="Loans">
		<div class="flex flex-wrap items-center gap-3">
			<div class="relative min-w-52 flex-1">
				<SearchIcon class="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink-muted" />
				<Input
					type="search"
					placeholder="Search by name, number or loan reference"
					aria-label="Search loans"
					class="pl-10"
					bind:value={query}
				/>
			</div>
			<select class="{selectClass} w-auto" aria-label="Loan type" bind:value={kind}>
				<option value="all">All types</option>
				{#each data.kinds as k (k.value)}<option value={k.value}>{k.label}</option>{/each}
			</select>
			<Button variant="gold" onclick={() => (creating = true)}><PlusIcon /> New loan</Button>
		</div>

		<div class="flex flex-wrap gap-2" role="group" aria-label="Status">
			{#each FILTERS as f (f.key)}
				<button
					type="button"
					aria-pressed={filter === f.key}
					class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors {filter === f.key
						? 'bg-ink text-white'
						: 'bg-ink/10 text-ink hover:bg-ink/15'}"
					onclick={() => (filter = f.key)}>{f.label}</button
				>
			{/each}
		</div>

		{#if data.loans.length === 0}
			<div class="hatch rounded-2xl px-6 py-14 text-center">
				<p class="text-lg">No loans recorded</p>
				<p class="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
					Add an SSS or Pag-IBIG loan once and it is deducted every cutoff until it is paid off.
				</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row class="hover:bg-transparent">
						<Table.Head>Employee</Table.Head>
						<Table.Head>Loan</Table.Head>
						<Table.Head class="text-right">Per month</Table.Head>
						<Table.Head class="min-w-44">Paid</Table.Head>
						<Table.Head class="text-right">Balance</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="w-24"><span class="sr-only">Actions</span></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each rows as l (l.id)}
						<Table.Row>
							<Table.Cell>
								<p class="font-medium">{l.employeeName}</p>
								<p class="text-xs text-ink-muted">#{l.employeeNo}</p>
							</Table.Cell>
							<Table.Cell>
								<p>{l.kindLabel}</p>
								<p class="text-xs text-ink-muted">{l.referenceNo ? `Ref ${l.referenceNo}` : 'No reference'}</p>
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{money(l.amortization)}</Table.Cell>
							<Table.Cell>
								<div class="h-1.5 w-full rounded-full bg-ink/10" aria-hidden="true">
									<div
										class="h-1.5 rounded-full bg-gold-deep"
										style="width: {Math.min(100, Math.round((l.deducted / l.principal) * 100))}%"
									></div>
								</div>
								<p class="mt-1 text-xs text-ink-muted tabular-nums">{money(l.deducted)} of {money(l.principal)}</p>
							</Table.Cell>
							<Table.Cell class="text-right font-medium tabular-nums">{money(l.balance)}</Table.Cell>
							<Table.Cell>
								<Badge variant={l.status === 'active' ? 'ok' : l.status === 'paused' ? 'gold' : 'muted'}>
									<span class="size-1.5 rounded-full bg-current opacity-70"></span>
									{STATUS_LABEL[l.status]}
								</Badge>
							</Table.Cell>
							<Table.Cell class="text-right">
								<Button variant="outline" size="sm" onclick={() => show(l.id)}>Open</Button>
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row class="hover:bg-transparent">
							<Table.Cell colspan={7} class="py-10 text-center text-ink-muted">No loans match.</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</section>
</div>

<Dialog.Root open={creating} onOpenChange={(o) => (creating = o)}>
	<Dialog.Content class="sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title class="font-display text-2xl font-light">New loan</Dialog.Title>
			<Dialog.Description>
				The monthly amount is taken half in each cutoff, from the month you choose until the balance is zero.
			</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/create" use:enhance={submit} class="space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<div class="col-span-2 space-y-1.5">
					<Label for="employeeId">Employee</Label>
					<select id="employeeId" name="employeeId" class={selectClass} required>
						<option value="" disabled selected>Choose a person</option>
						{#each data.people as p (p.id)}<option value={p.id}>{p.name} · #{p.employeeNo}</option>{/each}
					</select>
				</div>
				<div class="space-y-1.5">
					<Label for="kind">Loan type</Label>
					<select id="kind" name="kind" class={selectClass} required>
						{#each data.newKinds as k (k.value)}<option value={k.value}>{k.label}</option>{/each}
					</select>
					<p class="text-xs text-ink-muted">
						Missing a type? Add it under <a href="/settings" class="underline">Settings</a>.
					</p>
				</div>
				<div class="space-y-1.5">
					<Label for="referenceNo">Reference no.</Label>
					<Input id="referenceNo" name="referenceNo" maxlength={60} />
				</div>
				<div class="space-y-1.5">
					<Label for="principal">Loan amount (₱)</Label>
					<Input id="principal" name="principal" type="number" min="0.01" step="0.01" required />
				</div>
				<div class="space-y-1.5">
					<Label for="amortization">Per month (₱)</Label>
					<Input id="amortization" name="amortization" type="number" min="0.01" step="0.01" required />
				</div>
				<div class="space-y-1.5">
					<Label for="startPeriod">First deducted in</Label>
					<Input id="startPeriod" name="startPeriod" type="month" value={data.thisMonth} required />
				</div>
				<div class="space-y-1.5">
					<Label for="loanNote">Note</Label>
					<Input id="loanNote" name="note" maxlength={500} />
				</div>
			</div>
			<Dialog.Footer class="gap-2 pt-1">
				<Button type="button" variant="outline" onclick={() => (creating = false)}>Cancel</Button>
				<Button type="submit" disabled={busy}>Record loan</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={open !== null} onOpenChange={(o) => !o && show(null)}>
	<Dialog.Content class="sm:max-w-xl">
		{#if open}
			<Dialog.Header>
				<Dialog.Title class="font-display text-2xl font-light">{open.employeeName}</Dialog.Title>
				<Dialog.Description>
					{open.kindLabel}{open.referenceNo ? ` · ref ${open.referenceNo}` : ''} · from {open.startPeriod}
				</Dialog.Description>
			</Dialog.Header>

			<dl class="grid grid-cols-3 gap-3 text-sm">
				<div><dt class="text-ink-muted">Loan</dt><dd class="tabular-nums">{money(open.principal)}</dd></div>
				<div><dt class="text-ink-muted">Paid so far</dt><dd class="tabular-nums">{money(open.deducted)}</dd></div>
				<div>
					<dt class="text-ink-muted">Balance</dt>
					<dd class="font-medium tabular-nums">
						{money(open.balance)}{#if open.balance > 0 && open.amortization > 0}<span class="font-normal text-ink-muted">
								· {monthsLeft(open)} mo left</span>{/if}
					</dd>
				</div>
			</dl>
			{#if open.statusNote}<p class="text-sm text-ink-muted">{STATUS_LABEL[open.status]}: {open.statusNote}</p>{/if}
			{#if !open.remitted}
				<p class="text-sm text-ink-muted">A company loan — deducted from pay, not remitted to an agency.</p>
			{/if}

			<div class="space-y-1.5">
				<p class="text-sm font-medium">Deductions</p>
				{#if data.history.length === 0}
					<p class="text-sm text-ink-muted">Not deducted from any payslip yet.</p>
				{:else}
					<ul class="max-h-48 divide-y divide-dotted divide-ink/20 overflow-y-auto text-sm">
						{#each data.history as h, i (i)}
							<li class="flex flex-wrap items-baseline justify-between gap-2 py-1.5 tabular-nums">
								<span>{h.cutoffStart} – {h.cutoffEnd}</span>
								<span>
									{money(h.deductedCentavos)}
									{#if h.deductedCentavos < h.dueCentavos}
										<span class="text-danger">· {money(h.dueCentavos - h.deductedCentavos)} short</span>
									{/if}
									{#if h.status === 'draft'}<span class="text-ink-muted">· draft, not counted</span>{/if}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			{#if !isClosed}
				<form method="POST" action="?/edit" use:enhance={submit} class="space-y-3 border-t border-dotted border-ink/20 pt-4">
					<input type="hidden" name="loanId" value={open.id} />
					<div class="grid grid-cols-2 gap-3">
						<div class="space-y-1.5">
							<Label for="eAmort">Per month (₱)</Label>
							<Input id="eAmort" name="amortization" type="number" min="0.01" step="0.01" value={pesos(open.amortization)} required />
						</div>
						<div class="space-y-1.5">
							<Label for="eRef">Reference no.</Label>
							<Input id="eRef" name="referenceNo" maxlength={60} value={open.referenceNo ?? ''} />
						</div>
						<div class="col-span-2 space-y-1.5">
							<Label for="eNote">Note</Label>
							<Input id="eNote" name="note" maxlength={500} value={open.note ?? ''} />
						</div>
					</div>
					<Dialog.Footer class="gap-2 pt-1">
						<Button type="submit" variant="outline" disabled={busy}>Save changes</Button>
					</Dialog.Footer>
				</form>

				<form method="POST" action="?/status" use:enhance={submit} class="space-y-3 border-t border-dotted border-ink/20 pt-4">
					<input type="hidden" name="loanId" value={open.id} />
					<div class="space-y-1.5">
						<Label for="sNote">Reason <span class="text-ink-muted">(required to close)</span></Label>
						<Input id="sNote" name="note" maxlength={500} />
					</div>
					<div class="flex flex-wrap gap-2">
						{#if open.status === 'active'}
							<Button type="submit" name="to" value="paused" variant="outline" disabled={busy}>Pause deductions</Button>
						{:else}
							<Button type="submit" name="to" value="active" variant="gold" disabled={busy}>Resume deductions</Button>
						{/if}
						<Button type="submit" name="to" value="paid_off" variant="outline" disabled={busy}>Mark paid off</Button>
						<Button type="submit" name="to" value="cancelled" variant="outline" disabled={busy}>Cancel loan</Button>
					</div>
				</form>
			{/if}
		{/if}
	</Dialog.Content>
</Dialog.Root>
