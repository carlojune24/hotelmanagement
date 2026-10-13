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
	/** `2026-10` → "Oct 2026". */
	const monthLabel = (ym: string) =>
		new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
	const kb = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
	const dayLabel = (d: Date | string) =>
		new Date(d).toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' });
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

	function submitReset() {
		busy = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update();
			busy = false;
		};
	}

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
		{#if data.loans.length > 0}
			<div class="space-y-3">
				<dl class="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
					<div class="rounded-2xl bg-white/70 px-4 py-3">
						<dt class="text-ink-muted">Open loans</dt>
						<dd class="text-lg font-medium tabular-nums">{data.summary.open}</dd>
					</div>
					<div class="rounded-2xl bg-white/70 px-4 py-3">
						<dt class="text-ink-muted">Still owed</dt>
						<dd class="text-lg font-medium tabular-nums">{money(data.summary.outstanding)}</dd>
					</div>
					<div class="rounded-2xl bg-white/70 px-4 py-3">
						<dt class="text-ink-muted">Behind schedule</dt>
						<dd class="text-lg font-medium tabular-nums {data.summary.behindCount > 0 ? 'text-danger' : ''}">
							{data.summary.behindCount}
							{#if data.summary.behindCount > 0}<span class="text-sm font-normal"> · {money(data.summary.behindAmount)}</span>{/if}
						</dd>
					</div>
					<div class="rounded-2xl bg-white/70 px-4 py-3">
						<dt class="text-ink-muted">Ending within 3 months</dt>
						<dd class="text-lg font-medium tabular-nums">{data.summary.endingSoon}</dd>
					</div>
				</dl>
				{#if data.summary.byType.length > 0}
					<p class="text-xs text-ink-muted tabular-nums">
						{data.summary.byType.map((t) => `${t.label}: ${t.count} · ${money(t.outstanding)}`).join('   |   ')}
					</p>
				{/if}
				{#if data.summary.separatedCount > 0}
					<p class="rounded-lg border border-dashed border-danger/50 px-4 py-2 text-sm">
						{data.summary.separatedCount} open loan{data.summary.separatedCount === 1 ? '' : 's'} belong{data.summary.separatedCount === 1
							? 's'
							: ''} to employees who have separated — {money(data.summary.separatedOwed)} is still owed. Settle it from
						their final pay on the <a href="/separations" class="underline underline-offset-4">Separations</a> page, or record a payment received.
					</p>
				{/if}
			</div>
		{/if}

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
									{#if l.employeeStatus === 'separated' && l.balance > 0}
										<p class="text-xs font-medium text-danger">
											Separated{l.separatedOn ? ` ${dayLabel(l.separatedOn)}` : ''} · still owes ·
											<a
												href={l.separationId ? `/separations/${l.separationId}` : '/separations'}
												class="underline underline-offset-4"
												>{l.separationId ? 'Open separation' : 'Start separation'}</a
											>
										</p>
									{/if}
							</Table.Cell>
							<Table.Cell>
								<p>{l.kindLabel}</p>
								<p class="text-xs text-ink-muted">
									{l.referenceNo ? `Ref ${l.referenceNo}` : 'No reference'} · from {monthLabel(l.startPeriod)}
								</p>
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{money(l.amortization)}</Table.Cell>
							<Table.Cell>
								<div class="h-1.5 w-full rounded-full bg-ink/10" aria-hidden="true">
									<div
										class="h-1.5 rounded-full bg-gold-deep"
										style="width: {Math.min(100, Math.round(((l.deducted + l.alreadyPaid + l.paidOutside) / l.principal) * 100))}%"
									></div>
								</div>
								<p class="mt-1 text-xs text-ink-muted tabular-nums">{money(l.deducted + l.alreadyPaid + l.paidOutside)} of {money(l.principal)}</p>
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">
									<p class="font-medium">{money(l.balance)}</p>
									{#if l.behind > 0}
										<p class="text-xs font-medium text-danger">Behind {money(l.behind)}</p>
									{:else if l.expectedEnd}
										<p class="text-xs text-ink-muted">Ends {monthLabel(l.expectedEnd)}</p>
									{/if}
								</Table.Cell>
							<Table.Cell>
								<Badge variant={l.status === 'active' ? 'ok' : l.status === 'paused' ? 'gold' : 'muted'}>
									<span class="size-1.5 rounded-full bg-current opacity-70"></span>
									{STATUS_LABEL[l.status]}
								</Badge>
								{#if l.upcomingSkips.length > 0}
									<p class="mt-1 text-xs text-ink-muted">Skipping {l.upcomingSkips.map(monthLabel).join(', ')}</p>
								{/if}
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
					<Label for="principal">Total to pay back (₱)</Label>
					<Input id="principal" name="principal" type="number" min="0.01" step="0.01" required />
						<p class="text-xs text-ink-muted">Include interest — the total the lender will collect.</p>
				</div>
				<div class="space-y-1.5">
					<Label for="alreadyPaid">Already paid (₱)</Label>
					<Input id="alreadyPaid" name="alreadyPaid" type="number" min="0" step="0.01" placeholder="0.00" />
					<p class="text-xs text-ink-muted">Paid before the first payroll here. Leave blank for a new loan.</p>
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
						<Label for="releasedOn">Released on <span class="text-ink-muted">(optional)</span></Label>
						<Input id="releasedOn" name="releasedOn" type="date" max={data.today} />
					</div>
					<div class="space-y-1.5">
						<Label for="termMonths">Term, months <span class="text-ink-muted">(optional)</span></Label>
						<Input id="termMonths" name="termMonths" type="number" min="1" max="600" step="1" />
					</div>
					<div class="col-span-2 space-y-1.5">
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
	<Dialog.Content class="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
		{#if open}
			<Dialog.Header class="bg-gold px-7 py-5 pr-14 text-ink">
				<Dialog.Title class="font-display text-2xl font-light">{open.employeeName}</Dialog.Title>
				<Dialog.Description class="text-ink/70">
					{open.kindLabel}{open.referenceNo ? ` · ref ${open.referenceNo}` : ''} · from {monthLabel(open.startPeriod)}{open.releasedOn ? ` · released ${dayLabel(open.releasedOn)}` : ''}{open.termMonths
							? ` · ${open.termMonths}-month term`
							: ''}
				</Dialog.Description>
			</Dialog.Header>

			<div class="min-h-0 flex-1 space-y-6 overflow-y-auto px-7 py-6">

			<dl class="grid grid-cols-3 gap-3 text-sm">
				<div><dt class="text-ink-muted">Loan</dt><dd class="tabular-nums">{money(open.principal)}</dd></div>
				<div>
					<dt class="text-ink-muted">Paid so far</dt>
					<dd class="tabular-nums">{money(open.deducted + open.alreadyPaid + open.paidOutside)}</dd>
					{#if open.alreadyPaid > 0 || open.paidOutside > 0}
						<dd class="text-xs text-ink-muted tabular-nums">{money(open.alreadyPaid)} before HR + {money(open.deducted)} payroll + {money(open.paidOutside)} direct</dd>
					{/if}
				</div>
				<div>
					<dt class="text-ink-muted">Balance</dt>
					<dd class="font-medium tabular-nums">
						{money(open.balance)}{#if open.balance > 0 && open.amortization > 0}<span class="font-normal text-ink-muted">
								· {monthsLeft(open)} mo left</span>{/if}
					</dd>
				</div>
			</dl>
			<div class="flex flex-wrap items-center justify-between gap-2">
				{#if open.status === 'active' && open.balance > 0}
					<p class="text-sm {open.behind > 0 ? 'font-medium text-danger' : 'text-ink-muted'}">
						{#if open.behind > 0}Behind schedule by {money(open.behind)}.{:else}On schedule.{/if}
						{#if open.expectedEnd}Ends about {monthLabel(open.expectedEnd)}.{/if}
					</p>
				{:else}
					<span></span>
				{/if}
				
			</div>
			{#if open.statusNote}<p class="text-sm text-ink-muted">{STATUS_LABEL[open.status]}: {open.statusNote}</p>{/if}
			{#if !open.remitted}
				<p class="text-sm text-ink-muted">A company loan — deducted from pay, not remitted to an agency.</p>
			{/if}

			<div class="space-y-1.5">
				<p class="flex flex-wrap items-baseline justify-between gap-2 text-sm font-medium">
						Deductions
						<span class="text-xs font-normal text-ink-muted tabular-nums">{money(open.deducted)} deducted so far</span>
					</p>
				{#if data.history.length === 0}
					<p class="text-sm text-ink-muted">Not deducted from any payslip yet.</p>
				{:else}
					<ul class="max-h-48 space-y-1 overflow-y-auto text-sm">
						{#each data.history as h, i (i)}
							<li
									class="flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 tabular-nums {h.status === 'draft'
										? 'text-ink-muted'
										: 'bg-gold-soft'}"
								>
									<span class="flex flex-wrap items-center gap-2">
										{h.cutoffStart} – {h.cutoffEnd}
										{#if h.status === 'draft'}
											<Badge variant="muted">Draft · not counted</Badge>
										{:else}
											<Badge variant="ok">Deducted</Badge>
										{/if}
									</span>
									<span class={h.status === 'draft' ? '' : 'font-medium'}>
										{money(h.deductedCentavos)}
										{#if h.deductedCentavos < h.dueCentavos}
											<span class="font-normal text-danger">· {money(h.dueCentavos - h.deductedCentavos)} short</span>
										{/if}
									</span>
								</li>
						{/each}
					</ul>
				{/if}
			</div>

			<div class="space-y-1.5">
					<p class="text-sm font-medium">Payments received directly</p>
					{#if data.payments.length === 0}
						<p class="text-sm text-ink-muted">
							None. Cash or transfers the employee paid straight to the lender or the company go here; they are not
							deducted by payroll and never appear on an agency schedule.
						</p>
					{:else}
						<ul class="max-h-56 space-y-1 overflow-y-auto text-sm">
							{#each data.payments as pay (pay.id)}
								<li class="rounded-xl px-3 py-2 tabular-nums {pay.voidedAt ? 'text-ink-muted' : 'bg-gold-soft'}">
									<div class="flex flex-wrap items-center justify-between gap-2">
										<span class="flex flex-wrap items-center gap-2">
											<span class={pay.voidedAt ? 'line-through' : ''}>{dayLabel(pay.paidOn)}</span>
											{#if pay.voidedAt}<Badge variant="muted">Voided</Badge>{:else}<Badge variant="ok">Received</Badge>{/if}
										</span>
										<span class={pay.voidedAt ? 'line-through' : 'font-medium'}>{money(pay.amountCentavos)}</span>
									</div>
									<p class="text-xs text-ink-muted">
										{pay.note ? `${pay.note} · ` : ''}recorded by {pay.by ?? 'unknown'}{pay.voidReason ? ` · voided: ${pay.voidReason}` : ''}
									</p>
									{#if !pay.voidedAt}
										<form method="POST" action="?/voidPayment" use:enhance={submitReset} class="mt-1 flex gap-2">
											<input type="hidden" name="paymentId" value={pay.id} />
											<Input name="reason" maxlength={300} placeholder="Reason to void" aria-label="Reason to void this payment" class="h-8 text-xs" required />
											<Button type="submit" variant="ghost" size="sm" disabled={busy}>Void</Button>
										</form>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
					{#if !isClosed}
						<form method="POST" action="?/payment" use:enhance={submitReset} class="grid grid-cols-2 gap-3 pt-2">
							<input type="hidden" name="loanId" value={open.id} />
							<div class="space-y-1.5">
								<Label for="payDate">Date paid</Label>
								<Input id="payDate" name="paidOn" type="date" value={data.today} max={data.today} required />
							</div>
							<div class="space-y-1.5">
								<Label for="payAmount">Amount (₱)</Label>
								<Input id="payAmount" name="amount" type="number" min="0.01" step="0.01" required />
							</div>
							<div class="col-span-2 space-y-1.5">
								<Label for="payNote">Note <span class="text-ink-muted">(optional)</span></Label>
								<Input id="payNote" name="note" maxlength={300} />
							</div>
							<div class="col-span-2">
								<Button type="submit" variant="outline" disabled={busy}>Record payment</Button>
							</div>
						</form>
					{/if}
				</div>

				<div class="space-y-1.5">
					<p class="text-sm font-medium">Documents</p>
					{#if data.documents.length === 0}
						<p class="text-sm text-ink-muted">None. Attach the agreement or the lender's approval voucher (PDF or image, up to 8 MB).</p>
					{:else}
						<ul class="space-y-1 text-sm">
							{#each data.documents as d (d.id)}
								<li class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/70 px-3 py-2">
									<span class="min-w-0">
										<a href="/loans/documents/{d.id}" target="_blank" rel="noopener" class="font-medium underline underline-offset-4">{d.originalName}</a>
										<span class="block text-xs text-ink-muted">{kb(d.sizeBytes)} · {d.by ?? 'unknown'} · {dayLabel(d.createdAt)}</span>
									</span>
									<form method="POST" action="?/removeDocument" use:enhance={submit}>
										<input type="hidden" name="documentId" value={d.id} />
										<Button type="submit" variant="ghost" size="sm" disabled={busy} aria-label="Remove {d.originalName}">Remove</Button>
									</form>
								</li>
							{/each}
						</ul>
					{/if}
					<form method="POST" action="?/upload" enctype="multipart/form-data" use:enhance={submitReset} class="flex flex-wrap items-end gap-3 pt-2">
						<input type="hidden" name="loanId" value={open.id} />
						<div class="min-w-0 flex-1 space-y-1.5">
							<Label for="docFile">Attach a document</Label>
							<Input id="docFile" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required />
						</div>
						<Button type="submit" variant="outline" disabled={busy}>Attach</Button>
					</form>
				</div>

<div class="space-y-1.5">
				<p class="text-sm font-medium">Skipped months</p>
				{#if data.skips.length === 0}
					<p class="text-sm text-ink-muted">No skipped months.</p>
				{:else}
					<ul class="max-h-48 divide-y divide-dotted divide-ink/20 overflow-y-auto text-sm">
						{#each data.skips as k (k.id)}
							<li class="flex flex-wrap items-center justify-between gap-2 py-1.5">
								<span>
									<span class="font-medium tabular-nums">{monthLabel(k.payMonth)}</span> · {k.reason}
									<span class="block text-xs text-ink-muted">added by {k.by ?? 'unknown'}, {dayLabel(k.createdAt)}</span>
								</span>
								{#if k.locked}
									<span class="text-xs text-ink-muted">In a locked payslip</span>
								{:else if !isClosed}
									<form method="POST" action="?/unskip" use:enhance={submit}>
										<input type="hidden" name="skipId" value={k.id} />
										<Button
											type="submit"
											variant="ghost"
											size="sm"
											disabled={busy}
											aria-label="Remove skip for {monthLabel(k.payMonth)}">Remove</Button
										>
									</form>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
				{#if !isClosed}
					{#if open.remitted}
			<p class="rounded-lg border border-dashed border-ink/30 px-3 py-2 text-sm">
				This loan is remitted to an agency. A skipped month is not deducted or remitted, but the agency still
				expects the payment — the loan can show as behind. It is listed on that month's loan schedule.
			</p>
		{/if}
		<form method="POST" action="?/skip" use:enhance={submitReset} class="grid grid-cols-2 gap-3 pt-2">
						<input type="hidden" name="loanId" value={open.id} />
						<div class="space-y-1.5">
							<Label for="skMonth">Month to skip</Label>
							<Input id="skMonth" name="payMonth" type="month" min={open.startPeriod} required />
						</div>
						<div class="space-y-1.5">
							<Label for="skReason">Reason</Label>
							<Input id="skReason" name="reason" maxlength={300} required />
						</div>
						<div class="col-span-2">
							<Button type="submit" variant="outline" disabled={busy}>Skip month</Button>
						</div>
					</form>
				{/if}
			</div>

			{#if !isClosed}
				<form method="POST" action="?/edit" use:enhance={submit} class="space-y-3 border-t border-dotted border-ink/20 pt-4">
					<input type="hidden" name="loanId" value={open.id} />
					<div class="grid grid-cols-2 gap-3">
						<div class="space-y-1.5">
								<Label for="ePrincipal">Total to pay back (₱)</Label>
								<Input
									id="ePrincipal"
									name="principal"
									type="number"
									min="0.01"
									step="0.01"
									value={pesos(open.principal)}
									disabled={open.deducted > 0}
									required
								/>
							</div>
							<div class="space-y-1.5">
								<Label for="eStart">First deducted in</Label>
								<Input id="eStart" name="startPeriod" type="month" value={open.startPeriod} disabled={open.deducted > 0} required />
							</div>
							<div class="space-y-1.5">
							<Label for="eAmort">Per month (₱)</Label>
							<Input id="eAmort" name="amortization" type="number" min="0.01" step="0.01" value={pesos(open.amortization)} required />
						</div>
						<div class="space-y-1.5">
								<Label for="eReleased">Released on</Label>
								<Input id="eReleased" name="releasedOn" type="date" value={open.releasedOn ?? ''} max={data.today} />
							</div>
							<div class="space-y-1.5">
								<Label for="eTerm">Term, months</Label>
								<Input id="eTerm" name="termMonths" type="number" min="1" max="600" step="1" value={open.termMonths ?? ''} />
							</div>
							<div class="space-y-1.5">
							<Label for="eAlready">Already paid before HR (₱)</Label>
							<Input id="eAlready" name="alreadyPaid" type="number" min="0" step="0.01" value={pesos(open.alreadyPaid)} />
						</div>
						<div class="space-y-1.5">
							<Label for="eRef">Reference no.</Label>
							<Input id="eRef" name="referenceNo" maxlength={60} value={open.referenceNo ?? ''} />
						</div>
						<div class="space-y-1.5">
							<Label for="eNote">Note</Label>
							<Input id="eNote" name="note" maxlength={500} value={open.note ?? ''} />
						</div>
					</div>
					{#if open.deducted > 0}
							<p class="text-xs text-ink-muted">
								The loan amount and start month are locked because a payslip has already deducted this loan.
							</p>
						{/if}
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
							<Button type="submit" name="to" value="paused" variant="outline" disabled={busy}>Pause until I resume</Button>
						{:else}
							<Button type="submit" name="to" value="active" variant="gold" disabled={busy}>Resume deductions</Button>
						{/if}
						<Button type="submit" name="to" value="paid_off" variant="outline" disabled={busy}>Mark paid off</Button>
						<Button type="submit" name="to" value="cancelled" variant="outline" disabled={busy}>Cancel loan</Button>
					</div>
				</form>
			{/if}
		</div>

			<Dialog.Footer class="flex-row items-center justify-between border-t border-dotted border-ink/20 bg-white/70 px-7 py-4 sm:justify-between">
				<Button variant="outline" href="/print/loan/{open.id}" target="_blank" rel="noopener">Print statement</Button>
				<Button type="button" onclick={() => show(null)}>Close</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
