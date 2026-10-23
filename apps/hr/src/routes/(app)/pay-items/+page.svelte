<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { CATEGORY_LABEL } from '$lib/pay-items-core';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Filter = 'all' | 'earning' | 'deduction' | 'archived' | 'voided';
	const FILTERS: Array<{ key: Filter; label: string }> = [
		{ key: 'all', label: 'Active' },
		{ key: 'earning', label: 'Earnings' },
		{ key: 'deduction', label: 'Deductions' },
		{ key: 'archived', label: 'Archived' },
		{ key: 'voided', label: 'Voided' }
	];
	let filter = $state<Filter>('all');
	let query = $state('');
	const rows = $derived(
		data.items.filter((i) => {
			const q = query.trim().toLowerCase();
			if (q && !`${i.employeeName} ${i.employeeNo} ${i.label}`.toLowerCase().includes(q)) return false;
			if (filter === 'voided') return i.status === 'voided';
			if (filter === 'archived') return i.status === 'archived';
			if (i.status === 'voided' || i.status === 'archived') return false;
			return filter === 'all' || i.kind === filter;
		})
	);

	const peso = (c: number) => (c / 100).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' });
	const day = (d: string) =>
		new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
	const when = (i: { startDate: string; endDate: string | null }) =>
		i.endDate === i.startDate ? `Cutoff of ${day(i.startDate)}` : `${day(i.startDate)} → ${i.endDate ? day(i.endDate) : 'until voided'}`;
	const STATUS = {
		pending: { label: 'Waiting for payroll', variant: 'muted' },
		draft: { label: 'On a draft payslip', variant: 'gold' },
		locked: { label: 'Paid / locked', variant: 'ok' },
		voided: { label: 'Voided', variant: 'muted' },
		archived: { label: 'Archived', variant: 'muted' }
	} as const;

	// Add dialog
	let creating = $state(false);
	let kind = $state<'earning' | 'deduction'>('earning');
	let category = $state('incentive');
	let recurring = $state(false);
	let picked = $state<string[]>([]);
	let search = $state('');
	let pickedDate = $state('');
	// Which payroll cutoff a chosen date falls in, from the runs that exist.
	const landsOn = $derived(data.cutoffs.find((c) => pickedDate >= c.start && pickedDate <= c.end) ?? null);
	let busy = $state(false);
	const choices = $derived(
		data.people.filter((p) => `${p.name} ${p.employeeNo}`.toLowerCase().includes(search.trim().toLowerCase()))
	);
	const categories = $derived(
		kind === 'earning'
			? ([['allowance', 'Allowance'], ['incentive', 'Incentive'], ['other', 'Other earning']] as const)
			: ([['cash_advance', 'Cash advance'], ['other', 'Other deduction']] as const)
	);
	$effect(() => {
		if (!categories.some(([k]) => k === category)) category = categories[0][0];
	});
	function openAdd() {
		kind = 'earning';
		category = 'incentive';
		recurring = false;
		picked = [];
		search = '';
		pickedDate = '';
		creating = true;
	}
	const toggle = (id: string) => (picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

	let voiding = $state<(typeof data.items)[number] | null>(null);

	// Edit dialog
	let editing = $state<(typeof data.items)[number] | null>(null);
	let editRecurring = $state(false);
	function openEdit(i: (typeof data.items)[number]) {
		editing = i;
		editRecurring = i.recurring;
	}
	const editCategories = $derived(
		editing?.kind === 'deduction'
			? ([['cash_advance', 'Cash advance'], ['other', 'Other deduction']] as const)
			: ([['allowance', 'Allowance'], ['incentive', 'Incentive'], ['other', 'Other earning']] as const)
	);

	$effect(() => {
		if (form && 'error' in form && form.error) toast.error(form.error);
		else if (form && 'ok' in form && form.ok) {
			toast.success(form.ok);
			creating = false;
			voiding = null;
			editing = null;
		}
	});

	function submit() {
		busy = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = false;
		};
	}
</script>

<svelte:head><title>Pay items · HR</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-5xl font-light tracking-tight">Pay items</h1>
			<p class="mt-2 max-w-2xl text-sm text-ink-muted">
				Incentives, allowances, cash advances and other deductions. File them here once and payroll picks them up for
				the cutoff they fall in; a draft payslip updates straight away. A recurring item applies to every cutoff
				between its dates, in the amount you enter per cutoff.
			</p>
		</div>
		<div class="flex gap-2">
			<Button variant="outline" href="/print/pay-items?filter={filter}&q={encodeURIComponent(query)}" target="_blank" rel="noopener">
				<PrinterIcon /> Print
			</Button>
			<Button variant="gold" onclick={openAdd}><PlusIcon /> Add pay item</Button>
		</div>
	</div>

	<section class="panel space-y-5 p-5 md:p-6" aria-label="Pay items">
		<div class="flex flex-wrap items-center gap-3">
			<div class="flex flex-wrap gap-2" role="group" aria-label="Filter">
				{#each FILTERS as f (f.key)}
					<button
						type="button"
						aria-pressed={filter === f.key}
						onclick={() => (filter = f.key)}
						class="rounded-full px-4 py-2 text-sm font-medium transition-colors {filter === f.key
							? 'bg-primary text-primary-foreground'
							: 'bg-white/70 text-ink hover:bg-gold-soft'}"
					>
						{f.label}
					</button>
				{/each}
			</div>
			<Input bind:value={query} placeholder="Search employee or item" aria-label="Search" class="ml-auto w-64 max-w-full" />
		</div>

		{#if rows.length === 0}
			<div class="rounded-2xl border border-dashed border-ink/30 px-6 py-12 text-center">
				<p class="text-lg font-light">Nothing here yet</p>
				<p class="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
					Add an incentive or a cash advance and it lands on the next payslip it falls in.
				</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row class="hover:bg-transparent">
						<Table.Head>Employee</Table.Head>
						<Table.Head>Item</Table.Head>
						<Table.Head>Applies</Table.Head>
						<Table.Head class="text-right">Amount</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="w-44"><span class="sr-only">Actions</span></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each rows as i (i.id)}
						<Table.Row>
							<Table.Cell>
								<p class="font-medium">{i.employeeName}</p>
								<p class="text-xs text-ink-muted">{i.employeeNo}</p>
							</Table.Cell>
							<Table.Cell>
								<p>{i.label}</p>
								<p class="text-xs text-ink-muted">
									{i.kind === 'earning' ? 'Earning' : 'Deduction'} · {CATEGORY_LABEL[i.category] ?? i.category}{i.kind === 'earning' && !i.taxable ? ' · tax-exempt' : ''}
								</p>
							</Table.Cell>
							<Table.Cell class="text-sm">{when(i)}</Table.Cell>
							<Table.Cell class="text-right tabular-nums {i.kind === 'deduction' ? 'text-danger' : ''}">
								{i.kind === 'deduction' ? '−' : ''}{peso(i.amountCentavos)}
							</Table.Cell>
							<Table.Cell>
								<Badge variant={STATUS[i.status].variant}>{STATUS[i.status].label}</Badge>
								{#if i.cutoff && i.status !== 'voided'}<p class="mt-1 text-xs text-ink-muted">{i.cutoff}</p>{/if}
								{#if i.status === 'voided' && i.voidReason}<p class="mt-1 text-xs text-ink-muted">{i.voidReason}</p>{/if}
							</Table.Cell>
							<Table.Cell class="whitespace-nowrap">
								{#if i.status === 'archived'}
									<form method="POST" action="?/archive" use:enhance={submit} class="inline">
										<input type="hidden" name="id" value={i.id} />
										<input type="hidden" name="restore" value="1" />
										<Button type="submit" size="sm" variant="ghost" disabled={busy}>Restore</Button>
									</form>
								{:else if i.status !== 'voided'}
									{#if i.lockReason}
										<p class="max-w-52 text-xs whitespace-normal text-ink-muted">{i.lockReason}</p>
									{:else}
										<Button size="sm" variant="ghost" onclick={() => openEdit(i)}>Edit</Button>
									{/if}
									{#if !i.lockReason || i.recurring}
										<form method="POST" action="?/archive" use:enhance={submit} class="inline">
											<input type="hidden" name="id" value={i.id} />
											<Button type="submit" size="sm" variant="ghost" disabled={busy}>Archive</Button>
										</form>
									{/if}
									{#if i.status !== 'locked' && !(i.lockReason && !i.recurring)}
										<Button size="sm" variant="ghost" onclick={() => (voiding = i)}>Void</Button>
									{/if}
								{/if}
							</Table.Cell>
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
			<Dialog.Title class="font-display text-2xl font-light">Add pay item</Dialog.Title>
			<Dialog.Description>
				Pick one or more employees. Earnings raise gross pay (and withholding tax); deductions come off net pay.
			</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/create" use:enhance={submit} class="space-y-4">
			{#each picked as id (id)}<input type="hidden" name="employeeId" value={id} />{/each}

			<div class="flex gap-2" role="group" aria-label="Kind">
				{#each [['earning', 'Earning'], ['deduction', 'Deduction']] as const as [k, l] (k)}
					<button
						type="button"
						aria-pressed={kind === k}
						onclick={() => (kind = k)}
						class="rounded-full px-4 py-2 text-sm font-medium transition-colors {kind === k
							? 'bg-primary text-primary-foreground'
							: 'bg-white/70 text-ink hover:bg-gold-soft'}"
					>
						{l}
					</button>
				{/each}
			</div>
			<input type="hidden" name="kind" value={kind} />

			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-1.5">
					<Label for="category">Type</Label>
					<select
						id="category"
						name="category"
						bind:value={category}
						class="h-10 w-full rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						{#each categories as [k, l] (k)}<option value={k}>{l}</option>{/each}
					</select>
				</div>
				<div class="space-y-1.5">
					<Label for="amount">Amount (₱){recurring ? ' per cutoff' : ''}</Label>
					<Input id="amount" name="amount" type="number" min="0.01" step="0.01" required />
				</div>
				<div class="col-span-2 space-y-1.5">
					<Label for="label">Name on the payslip</Label>
					<Input id="label" name="label" maxlength={80} required placeholder={kind === 'earning' ? 'Sales incentive' : 'Uniform'} />
				</div>
				{#if kind === 'earning'}
					<label class="col-span-2 flex items-start gap-2 text-sm">
						<input type="checkbox" name="exempt" class="mt-0.5 size-4 accent-[var(--gold-deep)]" />
						<span>
							Exempt from income tax
							<span class="block text-xs text-ink-muted">
								For de minimis benefits and similar. It is paid in full but left out of the taxable pay tax is worked out from.
							</span>
						</span>
					</label>
				{/if}
			</div>

			<div class="space-y-3 rounded-2xl bg-ink/5 p-4">
				<label class="flex items-center gap-2 text-sm font-medium">
					<input type="checkbox" name="recurring" bind:checked={recurring} class="size-4 accent-[var(--gold-deep)]" />
					Repeats every cutoff
				</label>
				<div class="grid grid-cols-2 gap-3">
					<div class="space-y-1.5">
						<Label for="startDate">{recurring ? 'Starts from' : 'Pay date'}</Label>
						<Input id="startDate" name="startDate" type="date" required bind:value={pickedDate} />
					</div>
					{#if recurring}
						<div class="space-y-1.5">
							<Label for="endDate">Until <span class="text-ink-muted">(blank = until voided)</span></Label>
							<Input id="endDate" name="endDate" type="date" />
						</div>
					{/if}
				</div>
				<p class="text-xs text-ink-muted" aria-live="polite">
					{#if !pickedDate}
						{recurring
							? 'Taken on every cutoff from this date, in the amount per cutoff you entered above.'
							: 'Pick any date inside the cutoff you want it on. Only the cutoff matters, not the day.'}
					{:else if landsOn}
						{recurring ? 'First applies to' : 'Goes on'} the payroll for <span class="font-medium text-ink">{day(landsOn.start)} – {day(landsOn.end)}</span>.
					{:else}
						No payroll run covers {day(pickedDate)} yet. It will be picked up when a run for that cutoff is created.
					{/if}
				</p>
			</div>

			<div class="space-y-1.5">
				<Label for="note">Note <span class="text-ink-muted">(optional, not printed)</span></Label>
				<Input id="note" name="note" maxlength={300} />
			</div>

			<div class="space-y-2">
				<div class="flex items-center justify-between gap-3">
					<Label for="search">Employees <span class="text-ink-muted">· {picked.length} selected</span></Label>
					<Input id="search" bind:value={search} placeholder="Search" class="h-8 w-44" />
				</div>
				<ul class="max-h-44 space-y-0.5 overflow-y-auto rounded-2xl border border-ink/15 p-2">
					{#each choices as p (p.id)}
						<li>
							<label class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-gold-soft">
								<input type="checkbox" checked={picked.includes(p.id)} onchange={() => toggle(p.id)} class="size-4 accent-[var(--gold-deep)]" />
								<span class="flex-1">{p.name}</span>
								<span class="text-xs text-ink-muted">{p.employeeNo}</span>
							</label>
						</li>
					{:else}
						<li class="px-2 py-1 text-sm text-ink-muted">No one matches.</li>
					{/each}
				</ul>
			</div>

			<Dialog.Footer class="gap-2 pt-1">
				<Button type="button" variant="outline" onclick={() => (creating = false)}>Close</Button>
				<Button type="submit" variant="gold" disabled={busy || picked.length === 0}>Add</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={voiding !== null} onOpenChange={(o) => !o && (voiding = null)}>
	<Dialog.Content>
		{#if voiding}
			<Dialog.Header>
				<Dialog.Title class="font-display text-2xl font-light">Void "{voiding.label}"?</Dialog.Title>
				<Dialog.Description>
					{voiding.employeeName} · {peso(voiding.amountCentavos)}. It comes off any draft payslip it is on; the record
					stays, marked voided.
				</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/void" use:enhance={submit} class="space-y-3">
				<input type="hidden" name="id" value={voiding.id} />
				<div class="space-y-1.5">
					<Label for="reason">Reason <span class="text-ink-muted">(optional)</span></Label>
					<Input id="reason" name="reason" maxlength={200} />
				</div>
				<Dialog.Footer class="gap-2 pt-1">
					<Button type="button" variant="outline" onclick={() => (voiding = null)}>Keep it</Button>
					<Button type="submit" variant="destructive" disabled={busy}>Void item</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={editing !== null} onOpenChange={(o) => !o && (editing = null)}>
	<Dialog.Content class="sm:max-w-lg">
		{#if editing}
			<Dialog.Header>
				<Dialog.Title class="font-display text-2xl font-light">Edit pay item</Dialog.Title>
				<Dialog.Description>
					{editing.employeeName} · {editing.kind === 'earning' ? 'earning' : 'deduction'}. A draft payslip updates straight
					away. To change who it is for, or whether it is an earning, void it and add a new one.
				</Dialog.Description>
			</Dialog.Header>
			{#key editing.id}
				<form method="POST" action="?/update" use:enhance={submit} class="space-y-4">
					<input type="hidden" name="id" value={editing.id} />
					<div class="grid grid-cols-2 gap-3">
						<div class="space-y-1.5">
							<Label for="editCategory">Type</Label>
							<select
								id="editCategory"
								name="category"
								class="h-10 w-full rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								{#each editCategories as [k, l] (k)}<option value={k} selected={editing.category === k}>{l}</option>{/each}
							</select>
						</div>
						<div class="space-y-1.5">
							<Label for="editAmount">Amount (₱){editRecurring ? ' per cutoff' : ''}</Label>
							<Input id="editAmount" name="amount" type="number" min="0.01" step="0.01" value={editing.amountCentavos / 100} required />
						</div>
						<div class="col-span-2 space-y-1.5">
							<Label for="editLabel">Name on the payslip</Label>
							<Input id="editLabel" name="label" maxlength={80} value={editing.label} required />
						</div>
						{#if editing.kind === 'earning'}
							<label class="col-span-2 flex items-start gap-2 text-sm">
								<input type="checkbox" name="exempt" checked={!editing.taxable} class="mt-0.5 size-4 accent-[var(--gold-deep)]" />
								<span>Exempt from income tax</span>
							</label>
						{/if}
					</div>
					<div class="space-y-3 rounded-2xl bg-ink/5 p-4">
						<label class="flex items-center gap-2 text-sm font-medium">
							<input type="checkbox" name="recurring" bind:checked={editRecurring} class="size-4 accent-[var(--gold-deep)]" />
							Repeats every cutoff
						</label>
						<div class="grid grid-cols-2 gap-3">
							<div class="space-y-1.5">
								<Label for="editStart">{editRecurring ? 'Starts from' : 'Pay date'}</Label>
								<Input id="editStart" name="startDate" type="date" value={editing.startDate} required />
							</div>
							{#if editRecurring}
								<div class="space-y-1.5">
									<Label for="editEnd">Ends (optional)</Label>
									<Input id="editEnd" name="endDate" type="date" value={editing.recurring ? (editing.endDate ?? '') : ''} />
								</div>
							{/if}
						</div>
					</div>
					<div class="space-y-1.5">
						<Label for="editNote">Note <span class="text-xs font-normal text-ink-muted">(optional, not printed)</span></Label>
						<Input id="editNote" name="note" maxlength={300} value={editing.note} />
					</div>
					<Dialog.Footer class="gap-2 pt-1">
						<Button type="button" variant="outline" onclick={() => (editing = null)}>Cancel</Button>
						<Button type="submit" variant="gold" disabled={busy}>Save changes</Button>
					</Dialog.Footer>
				</form>
			{/key}
		{/if}
	</Dialog.Content>
</Dialog.Root>
