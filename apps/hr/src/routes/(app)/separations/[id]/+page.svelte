<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import CheckIcon from '@lucide/svelte/icons/check';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { money } from '$lib/components/payroll/money';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const selectClass =
		'h-10 w-full rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';
	const dayLabel = (d: Date | string) =>
		new Date(d).toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' });

	let busy = $state(false);
	let adding = $state(false);
	const t = $derived(data.totals);
	const cleared = $derived(data.sep.status === 'cleared');
	const doneCount = $derived(Object.values(data.steps).filter(Boolean).length);

	$effect(() => {
		if (form && 'error' in form && form.error) toast.error(form.error);
		else if (form && 'ok' in form && form.ok) {
			toast.success(form.ok);
			adding = false;
		}
	});

	/** Clears the inputs after a successful add; keeps them when the server refused. */
	function submit() {
		busy = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update();
			busy = false;
		};
	}

	const lines = $derived(data.items.filter((i) => i.kind === 'credit' || i.kind === 'charge'));
	const settlements = $derived(data.items.filter((i) => i.kind === 'receipt' || i.kind === 'writeoff'));
</script>

<svelte:head><title>{data.employee.name} · Separation · HR</title></svelte:head>

<div class="mx-auto max-w-4xl space-y-6">
	<p class="text-sm text-ink-muted">
		<a href="/separations" class="underline-offset-4 hover:underline">Separations</a>
	</p>

	<!-- Header -->
	<section class="panel overflow-hidden" aria-label="Summary">
		<div class="bg-gold px-6 py-5 text-ink md:px-8">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 class="font-display text-3xl font-light">{data.employee.name}</h1>
					<p class="text-sm text-ink/70">
						#{data.employee.no}{data.employee.position ? ` · ${data.employee.position}` : ''}{data.employee.establishment
							? ` · ${data.employee.establishment}`
							: ''}
					</p>
					<p class="mt-1 text-sm">
						{data.kindLabel} · last day <span class="font-medium tabular-nums">{data.sep.lastDay}</span>
						{#if data.sep.note}<span class="text-ink/70"> · {data.sep.note}</span>{/if}
					</p>
				</div>
				<div class="text-right">
					<Badge variant={cleared ? 'ok' : t.stillOwed > 0 ? 'muted' : 'gold'}>
						{cleared ? 'Cleared' : t.stillOwed > 0 ? 'Still owes' : 'In process'}
					</Badge>
					<p class="mt-1 text-xs text-ink/70 tabular-nums">{doneCount} of 3 steps done</p>
					<Button
						variant="outline"
						size="sm"
						class="mt-2"
						href="/print/separation/{data.sep.id}"
						target="_blank"
						rel="noopener">Print statement</Button
					>
				</div>
			</div>
		</div>
		<ol class="grid gap-3 px-6 py-4 text-sm sm:grid-cols-3 md:px-8">
			{#each [
				{ done: data.steps.finalPay, label: 'Final pay handed over', hint: t.payToEmployee > 0 ? `${money(t.payToEmployee)} to pay` : 'Nothing to pay' },
				{ done: data.steps.nothingOwed, label: 'Nothing owed', hint: t.stillOwed > 0 ? `${money(t.stillOwed)} still owed` : 'Settled' },
				{ done: data.steps.checklist, label: 'Clearance checklist', hint: `${data.clearance.filter((c) => c.doneAt).length} of ${data.clearance.length} done` }
			] as s (s.label)}
				<li class="flex items-start gap-2">
					<span
						class="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full {s.done
							? 'bg-ink text-white'
							: 'border border-ink/30'}"
					>
						{#if s.done}<CheckIcon class="size-3" />{/if}
					</span>
					<span>
						<span class="font-medium">{s.label}</span>
						<span class="block text-xs text-ink-muted tabular-nums">{s.hint}</span>
					</span>
				</li>
			{/each}
		</ol>
	</section>

	{#if data.employee.status !== 'separated'}
		<p class="rounded-lg border border-dashed border-ink/30 px-4 py-2 text-sm">
			Their last day is {data.sep.lastDay}. They stay active until then and are marked separated automatically.
		</p>
	{/if}

	<!-- 1. Final pay -->
	<section class="panel space-y-4 p-5 md:p-6" aria-label="Final pay">
		<div class="flex flex-wrap items-baseline justify-between gap-2">
			<h2 class="text-xl font-light">1 · Final pay</h2>
			{#if !cleared}
				<form method="POST" action="?/lastDay" use:enhance={submit} class="flex items-center gap-2 text-sm">
					<Label for="lastDay" class="text-ink-muted">Last day</Label>
					<Input id="lastDay" name="lastDay" type="date" value={data.sep.lastDay} class="h-8 w-40 text-xs" />
					<Button type="submit" variant="ghost" size="sm" disabled={busy}>Change</Button>
				</form>
			{/if}
		</div>
		<p class="text-sm text-ink-muted">
			What the company owes them (13th month, leave conversion, anything else) and what is charged against it. The
			last regular payslip still comes from payroll.
		</p>

		{#if lines.length === 0}
			<p class="text-sm text-ink-muted">Nothing entered yet.</p>
		{:else}
			<ul class="space-y-1 text-sm">
				{#each lines as i (i.id)}
					<li class="rounded-xl px-3 py-2 tabular-nums {i.voidedAt ? 'text-ink-muted' : i.kind === 'credit' ? 'bg-gold-soft' : 'bg-white/70'}">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<span class="flex flex-wrap items-center gap-2">
								<span class={i.voidedAt ? 'line-through' : 'font-medium'}>{i.label}</span>
								<Badge variant="muted">{i.kind === 'credit' ? 'Owed to employee' : 'Charged'}</Badge>
								{#if i.voidedAt}<Badge variant="muted">Voided</Badge>{/if}
							</span>
							<span class={i.voidedAt ? 'line-through' : 'font-medium'}>
								{i.kind === 'charge' ? '−' : ''}{money(i.amountCentavos)}
							</span>
						</div>
						{#if i.note || i.voidReason}
							<p class="text-xs text-ink-muted">{i.note ?? ''}{i.voidReason ? ` · voided: ${i.voidReason}` : ''}</p>
						{/if}
						{#if !i.voidedAt && !cleared}
							<form method="POST" action="?/voidItem" use:enhance={submit} class="mt-1 flex gap-2">
								<input type="hidden" name="itemId" value={i.id} />
								<Input name="reason" maxlength={300} placeholder="Reason to void" aria-label="Reason to void this line" class="h-8 text-xs" required />
								<Button type="submit" variant="ghost" size="sm" disabled={busy}>Void</Button>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		<div class="space-y-2 rounded-2xl bg-white/70 px-4 py-3 text-sm">
			<p class="font-medium">13th month pay · {data.thirteenth.year}</p>
			{#if data.thirteenth.entitled}
				<p class="text-ink-muted tabular-nums">
					Basic earned {money(data.thirteenth.basicEarned)} − late/undertime {money(data.thirteenth.lateDeductions)}
					= {money(data.thirteenth.basicEarned - data.thirteenth.lateDeductions)}, ÷ 12 =
					<span class="font-medium text-ink">{money(data.thirteenth.amount)}</span>
					<span class="text-xs">
						· from {data.thirteenth.finalPayslips} locked payslip{data.thirteenth.finalPayslips === 1 ? '' : 's'}, {data.thirteenth.serviceDays}
						days served this year</span
					>
				</p>
				{#if data.thirteenth.draftPayslips > 0}
					<p class="text-xs font-medium text-danger">
						{data.thirteenth.draftPayslips} payslip{data.thirteenth.draftPayslips === 1 ? '' : 's'} this year
						{data.thirteenth.draftPayslips === 1 ? 'is' : 'are'} still draft and not counted. Lock
						{data.thirteenth.draftPayslips === 1 ? 'it' : 'them'} first for the full figure.
					</p>
				{/if}
				{#if data.thirteenth.midYearPaid > 0}
					<p class="text-xs text-ink-muted tabular-nums">
						Less {money(data.thirteenth.midYearPaid)} already paid as a mid-year installment, so
						{money(data.thirteenth.due)} is due now.
					</p>
				{/if}
				{#if data.thirteenth.addedAmount !== null}
					<p>Added to the statement: <span class="font-medium tabular-nums">{money(data.thirteenth.addedAmount)}</span>.</p>
				{:else if !cleared}
					<form method="POST" action="?/thirteenth" use:enhance={submit}>
						<Button type="submit" variant="gold" size="sm" disabled={busy || data.thirteenth.due === 0}>Add {money(data.thirteenth.due)} to final pay</Button>
					</form>
				{/if}
			{:else}
				<p class="text-ink-muted">
					{#if data.thirteenth.reason === 'not_covered'}
						Not due — marked as not entitled{data.thirteenth.note ? `: ${data.thirteenth.note}` : ''}.
					{:else if data.thirteenth.reason === 'under_one_month'}
						Not due — served {data.thirteenth.serviceDays} day{data.thirteenth.serviceDays === 1 ? '' : 's'} this year, under
						the one month the law requires.
					{:else}
						Nothing to add yet — no basic pay on locked payslips this year.
					{/if}
				</p>
			{/if}
			{#if !cleared}
				<form method="POST" action="?/entitlement" use:enhance={submit} class="flex flex-wrap items-end gap-2">
					<input type="hidden" name="covered" value={data.thirteenth.covered ? '0' : '1'} />
					{#if data.thirteenth.covered}
						<div class="min-w-0 flex-1 space-y-1">
							<Label for="ent-note" class="text-xs text-ink-muted">Not entitled? (managerial staff are not covered)</Label>
							<Input id="ent-note" name="note" maxlength={200} placeholder="Reason, e.g. managerial" class="h-8 text-xs" />
						</div>
						<Button type="submit" variant="ghost" size="sm" disabled={busy}>Mark not entitled</Button>
					{:else}
						<Button type="submit" variant="ghost" size="sm" disabled={busy}>Mark entitled again</Button>
					{/if}
				</form>
			{/if}
			<p class="text-xs text-ink-muted">
				One twelfth of basic pay earned this year (PD 851); overtime, premiums and allowances are not counted. The
				13th month and other benefits are tax-exempt up to ₱90,000 a year — anything above is taxable and is not
				computed here.
			</p>
		</div>

		{#if !cleared}
			<div class="flex flex-wrap items-center gap-3 border-t border-dotted border-ink/20 pt-4">
				<Button variant="outline" onclick={() => (adding = true)}><PlusIcon /> Add line</Button>
				<p class="min-w-0 flex-1 text-xs text-ink-muted">
					A line is one amount on the final-pay statement: something owed to them (e.g. unused leave converted to cash) adds to
					it, something charged to them (e.g. unreturned uniform) is taken off it. The 13th month has its own button above, so don't add it here.</p>
			</div>
		{/if}
	</section>

	<!-- 2. Loans -->
	<section class="panel space-y-4 p-5 md:p-6" aria-label="Loans">
		<div class="flex flex-wrap items-baseline justify-between gap-2">
			<h2 class="text-xl font-light">2 · Loans</h2>
			<p class="text-sm text-ink-muted tabular-nums">
				Final pay available to apply: <span class="font-medium text-ink">{money(t.payToEmployee)}</span>
			</p>
		</div>
		<p class="text-sm text-ink-muted">
			Decide how much of the final pay goes to each loan, company loan first if you like. Each amount is recorded as
			a payment on that loan. Government loans (SSS, Pag-IBIG) follow the agency's rules — check before applying.
		</p>

		{#if data.loans.length === 0}
			<p class="text-sm text-ink-muted">No open loans.</p>
		{:else}
			<ul class="space-y-2">
				{#each data.loans as l (l.id)}
					<li class="rounded-xl bg-white/70 px-4 py-3 text-sm">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<span>
								<span class="font-medium">{l.label}</span>
								<span class="text-ink-muted">{l.referenceNo ? ` · ref ${l.referenceNo}` : ''}</span>
								{#if l.status === 'paused'}<Badge variant="muted">Paused</Badge>{/if}
							</span>
							<span class="font-medium text-danger tabular-nums">{money(l.balance)} owed</span>
						</div>
						{#if !cleared}
							<form method="POST" action="?/applyLoan" use:enhance={submit} class="mt-2 flex flex-wrap items-end gap-2">
								<input type="hidden" name="loanId" value={l.id} />
								<div class="space-y-1">
									<Label for="apply-{l.id}" class="text-xs text-ink-muted">Take from final pay (₱)</Label>
									<Input
										id="apply-{l.id}"
										name="amount"
										type="number"
										min="0.01"
										step="0.01"
										max={Math.min(l.balance, t.payToEmployee) / 100}
										class="h-9 w-44"
										disabled={t.payToEmployee === 0}
										required
									/>
								</div>
								<Button type="submit" variant="outline" size="sm" disabled={busy || t.payToEmployee === 0}>Apply</Button>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if data.applied.length > 0}
			<div class="space-y-1">
				<p class="text-sm font-medium">Taken from final pay</p>
				<ul class="space-y-1 text-sm">
					{#each data.applied as a (a.id)}
						<li class="rounded-xl px-3 py-2 tabular-nums {a.voidedAt ? 'text-ink-muted' : 'bg-gold-soft'}">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<span class={a.voidedAt ? 'line-through' : ''}>
									{a.loanLabel}{a.referenceNo ? ` · ref ${a.referenceNo}` : ''} · {dayLabel(a.paidOn)}
								</span>
								<span class={a.voidedAt ? 'line-through' : 'font-medium'}>{money(a.amountCentavos)}</span>
							</div>
							{#if !a.voidedAt && !cleared}
								<form method="POST" action="?/undoLoan" use:enhance={submit} class="mt-1 flex gap-2">
									<input type="hidden" name="paymentId" value={a.id} />
									<Input name="reason" maxlength={300} placeholder="Reason to undo" aria-label="Reason to undo this" class="h-8 text-xs" required />
									<Button type="submit" variant="ghost" size="sm" disabled={busy}>Undo</Button>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</section>

	<!-- 3. Statement and what is still owed -->
	<section class="panel space-y-4 p-5 md:p-6" aria-label="Settlement">
		<h2 class="text-xl font-light">3 · Settlement</h2>
		<dl class="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
			<div class="rounded-2xl bg-white/70 px-4 py-3">
				<dt class="text-ink-muted">Owed to employee</dt>
				<dd class="text-lg font-medium tabular-nums">{money(t.credits)}</dd>
			</div>
			<div class="rounded-2xl bg-white/70 px-4 py-3">
				<dt class="text-ink-muted">Charges + loans taken</dt>
				<dd class="text-lg font-medium tabular-nums">{money(t.charges + t.loanApplied)}</dd>
			</div>
			<div class="rounded-2xl bg-gold-soft px-4 py-3">
				<dt class="text-ink-muted">Pay to the employee</dt>
				<dd class="text-lg font-medium tabular-nums">{money(t.payToEmployee)}</dd>
			</div>
			<div class="rounded-2xl px-4 py-3 {t.stillOwed > 0 ? 'bg-white/70 ring-1 ring-danger/40' : 'bg-white/70'}">
				<dt class="text-ink-muted">Employee still owes</dt>
				<dd class="text-lg font-medium tabular-nums {t.stillOwed > 0 ? 'text-danger' : ''}">{money(t.stillOwed)}</dd>
			</div>
		</dl>

		{#if data.sep.finalPayPaidOn}
			<p class="text-sm">
				Final pay of {money(t.payToEmployee)} handed over on <span class="tabular-nums">{data.sep.finalPayPaidOn}</span>{data.finalPayPaidBy
					? ` by ${data.finalPayPaidBy}`
					: ''}.
			</p>
		{:else if t.payToEmployee > 0 && !cleared}
			<form method="POST" action="?/paid" use:enhance={submit}>
				<Button type="submit" variant="gold" disabled={busy}>Mark {money(t.payToEmployee)} as handed over</Button>
			</form>
		{/if}

		<div class="space-y-2 border-t border-dotted border-ink/20 pt-4">
			<p class="text-sm font-medium">Still owed to the company</p>
			<p class="text-sm text-ink-muted tabular-nums">
				Loans {money(t.loanOwed)} · other {money(t.nonLoanOwed)}. They stay listed as owing until paid or written off.
			</p>
			{#if settlements.length > 0}
				<ul class="space-y-1 text-sm">
					{#each settlements as i (i.id)}
						<li class="flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 tabular-nums {i.voidedAt ? 'text-ink-muted' : 'bg-gold-soft'}">
							<span class={i.voidedAt ? 'line-through' : ''}>
								{i.label} <span class="text-xs text-ink-muted">· {data.itemKindLabel[i.kind]}</span>
							</span>
							<span class={i.voidedAt ? 'line-through' : 'font-medium'}>{money(i.amountCentavos)}</span>
						</li>
					{/each}
				</ul>
			{/if}
			{#if !cleared && t.nonLoanOwed > 0}
				<form method="POST" action="?/addItem" use:enhance={submit} class="grid grid-cols-2 gap-3 pt-1 md:grid-cols-4">
					<div class="space-y-1.5">
						<Label for="skind">Record</Label>
						<select id="skind" name="kind" class={selectClass}>
							<option value="receipt">Cash received</option>
							<option value="writeoff">Write off</option>
						</select>
					</div>
					<div class="space-y-1.5 md:col-span-2">
						<Label for="slabel">Note</Label>
						<Input id="slabel" name="label" maxlength={120} placeholder="e.g. Paid in cash, waived by the owner" required />
					</div>
					<div class="space-y-1.5">
						<Label for="samount">Amount (₱)</Label>
						<Input id="samount" name="amount" type="number" min="0.01" step="0.01" max={t.nonLoanOwed / 100} required />
					</div>
					<div class="col-span-2 md:col-span-4">
						<Button type="submit" variant="outline" disabled={busy}>Record</Button>
					</div>
				</form>
			{:else if !cleared && t.loanOwed > 0}
				<p class="text-sm text-ink-muted">
					The remaining balance is on loans. Record payments received on the
					<a href="/loans" class="underline underline-offset-4">Loans</a> page, or apply final pay above.
				</p>
			{/if}
		</div>
	</section>

	<!-- 4. Clearance -->
	<section class="panel space-y-4 p-5 md:p-6" aria-label="Clearance">
		<h2 class="text-xl font-light">4 · Clearance</h2>
		<ul class="space-y-1 text-sm">
			{#each data.clearance as c (c.id)}
				<li>
					<form method="POST" action="?/check" use:enhance={submit} class="flex items-center justify-between gap-3 rounded-xl bg-white/70 px-3 py-2">
						<input type="hidden" name="itemId" value={c.id} />
						<input type="hidden" name="done" value={c.doneAt ? '0' : '1'} />
						<span class="flex items-center gap-3">
							<span
								class="inline-flex size-5 shrink-0 items-center justify-center rounded-full {c.doneAt ? 'bg-ink text-white' : 'border border-ink/30'}"
								aria-hidden="true"
							>
								{#if c.doneAt}<CheckIcon class="size-3" />{/if}
							</span>
							<span class={c.doneAt ? 'text-ink-muted' : ''}>{c.label}</span>
							{#if c.doneAt}<span class="text-xs text-ink-muted tabular-nums">{dayLabel(c.doneAt)}</span>{/if}
						</span>
						{#if !cleared}
							<Button type="submit" variant="ghost" size="sm" disabled={busy}>{c.doneAt ? 'Undo' : 'Mark done'}</Button>
						{/if}
					</form>
				</li>
			{/each}
		</ul>
		{#if !cleared}
			<form method="POST" action="?/addCheck" use:enhance={submit} class="flex flex-wrap items-end gap-2">
				<div class="min-w-0 flex-1 space-y-1.5">
					<Label for="check">Add a checklist item</Label>
					<Input id="check" name="label" maxlength={120} />
				</div>
				<Button type="submit" variant="outline" disabled={busy}>Add</Button>
			</form>
		{/if}
	</section>

	<!-- Clear -->
	<section class="panel flex flex-wrap items-center justify-between gap-3 p-5 md:p-6" aria-label="Clear">
		{#if cleared}
			<p class="text-sm">
				Cleared on <span class="tabular-nums">{data.sep.clearedAt ? dayLabel(data.sep.clearedAt) : ''}</span>{data.clearedBy
					? ` by ${data.clearedBy}`
					: ''}. Nothing is owed and the checklist is done.
			</p>
		{:else}
			<p class="text-sm text-ink-muted">
				{#if data.canClear}Everything is settled. Clearing closes this separation.{:else}
					To clear: {[
						!data.steps.finalPay ? 'hand over the final pay' : null,
						!data.steps.nothingOwed ? 'settle or write off what is owed' : null,
						!data.steps.checklist ? 'finish the checklist' : null
					]
						.filter(Boolean)
						.join(', ')}.
				{/if}
			</p>
			<form method="POST" action="?/clear" use:enhance={submit}>
				<Button type="submit" variant="gold" disabled={busy || !data.canClear}>Mark cleared</Button>
			</form>
		{/if}
	</section>
</div>

<Dialog.Root open={adding} onOpenChange={(o) => (adding = o)}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title class="font-display text-2xl font-light">Add a line</Dialog.Title>
			<Dialog.Description>Something owed to the employee, or charged against their final pay.</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/addItem" use:enhance={submit} class="space-y-3">
			<div class="space-y-1.5">
				<Label for="kind">Type</Label>
				<select id="kind" name="kind" class={selectClass}>
					<option value="credit">Owed to the employee</option>
					<option value="charge">Charged to the employee</option>
				</select>
			</div>
			<div class="space-y-1.5">
				<Label for="label">For</Label>
				<Input id="label" name="label" maxlength={120} placeholder="e.g. Unused leave conversion, Unreturned uniform" required />
			</div>
			<div class="space-y-1.5">
				<Label for="amount">Amount (₱)</Label>
				<Input id="amount" name="amount" type="number" min="0.01" step="0.01" required />
			</div>
			<div class="space-y-1.5">
				<Label for="note">Note <span class="text-ink-muted">(optional)</span></Label>
				<Input id="note" name="note" maxlength={300} />
			</div>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (adding = false)}>Cancel</Button>
				<Button type="submit" disabled={busy}>Add line</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
