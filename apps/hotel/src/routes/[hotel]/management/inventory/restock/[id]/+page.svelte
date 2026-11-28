<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { formatQty } from '$lib/stock-units';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const r = $derived(data.restock);
	const hotelBase = $derived(`/${page.params.hotel}/management`);
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const dateFmt = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
	const fmtDate = (d: string) => dateFmt.format(new Date(`${d}T00:00:00Z`));
	const EXPENSE: Record<string, string> = {
		draft: 'Waiting for approval in Finance',
		approved: 'Approved, waiting for Finance to pay',
		paid: 'Paid by Finance',
		void: 'Voided'
	};
	const untouched = $derived(data.lines.every((l) => l.remainingMilli === l.qtyMilli));
	const canVoid = $derived(data.inventory.canWrite && !r.voidedAt && r.expenseStatus !== 'paid');
	let confirming = $state(false);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});
</script>

<svelte:head><title>{r.receiptNo ?? 'Receipt'} · Restock</title></svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<div class="max-w-4xl">
		<a href="{hotelBase}/inventory/restock" class="text-sm text-ink-muted hover:text-ink">← All receipts</a>
		{#if page.url.searchParams.get('saved')}
			<p class="mt-3 flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-ink" role="status">
				<CheckIcon class="size-4 text-brand" aria-hidden="true" />Saved. The items are in stock and the expense is waiting in Finance.
			</p>
		{/if}
		<div class="mt-3 flex flex-wrap items-start justify-between gap-3">
			<div>
				<h2 class="text-base font-semibold {r.voidedAt ?'text-ink-muted line-through decoration-1' : 'text-ink'}">
					{r.supplier ?? 'No supplier named'}{r.receiptNo ? ` · ${r.receiptNo}` : ''}
				</h2>
				<p class="mt-1 text-sm text-ink-muted">
					{fmtDate(r.receiptDate)}{r.createdByName ? ` · encoded by ${r.createdByName}` : ''}
				</p>
			</div>
			<p class="text-xl font-semibold tabular-nums text-ink">{peso(r.totalCentavos)}</p>
		</div>

		{#if r.voidedAt}
			<p class="mt-3 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-ink">Voided: {r.voidReason}</p>
		{/if}

		<dl class="mt-4 grid gap-3 text-sm sm:grid-cols-2">
			<div>
				<dt class="text-xs text-ink-muted">Expense</dt>
				<dd class="text-ink">
					{r.expenseStatus ? (EXPENSE[r.expenseStatus] ?? r.expenseStatus) : '—'}
					{#if r.expenseId && data.canSeeExpense}· <a class="underline" href="{hotelBase}/finance/expenses/{r.expenseId}">Open in Finance</a>{/if}
				</dd>
			</div>
			{#if r.note}<div><dt class="text-xs text-ink-muted">Note</dt><dd class="text-ink">{r.note}</dd></div>{/if}
		</dl>

		<section class="mt-6" aria-labelledby="rs-lines">
			<h3 id="rs-lines" class="border-b border-border pb-2 text-sm font-semibold tracking-wide text-ink uppercase">
				Items<span class="ml-1 font-normal tabular-nums text-ink-muted">{data.lines.length}</span>
			</h3>
			<ul class="divide-y divide-border">
				{#each data.lines as l (l.itemId)}
					<li class="flex items-center gap-3 py-2.5">
						<div class="min-w-0 flex-1">
							<p class="truncate text-base text-ink">{l.name}</p>
							<p class="text-xs text-ink-muted">
								{formatQty(l.remainingMilli ?? 0, l.unit)} of it still in stock{l.expiresOn ? ` · expires ${fmtDate(l.expiresOn)}` : ''}
							</p>
						</div>
						<span class="text-base font-medium tabular-nums text-ink">{formatQty(l.qtyMilli, l.unit)}</span>
					</li>
				{/each}
			</ul>
		</section>

		{#if r.attachmentUrl}
			<section class="mt-6" aria-labelledby="rs-photo">
				<h3 id="rs-photo" class="border-b border-border pb-2 text-sm font-semibold tracking-wide text-ink uppercase">Receipt photo</h3>
				<a href={r.attachmentUrl} target="_blank" rel="noopener" class="mt-3 inline-block">
					<img src={r.attachmentUrl} alt="Receipt from {r.supplier ?? 'the supplier'}" class="max-h-96 rounded-lg border border-border" />
				</a>
			</section>
		{/if}

		{#if canVoid}
			<div class="mt-8 border-t border-border pt-4">
				{#if !untouched}
					<p class="text-sm text-ink-muted">Some of this delivery is already used, so the receipt can no longer be voided. Use Correct count on the Stock page if the quantities were wrong.</p>
				{:else if confirming}
					<form method="POST" action="?/void" use:enhance class="flex flex-wrap items-end gap-3">
						<div class="min-w-64 flex-1">
							<Label for="reason">Why void this receipt?</Label>
							<Input id="reason" name="reason" required maxlength={300} placeholder="Wrong supplier, encoded twice…" class="mt-1" />
						</div>
						<Button type="submit" variant="destructive" class="">Void receipt</Button>
						<Button type="button" variant="ghost" class="" onclick={() => (confirming = false)}>Keep it</Button>
						<p class="w-full text-xs text-ink-muted">Takes these items back out of stock and voids the expense in Finance.</p>
					</form>
				{:else}
					<Button variant="ghost" class="text-danger hover:text-danger" onclick={() => (confirming = true)}>Void this receipt</Button>
				{/if}
			</div>
		{:else if !r.voidedAt && r.expenseStatus === 'paid'}
			<p class="mt-8 border-t border-border pt-4 text-sm text-ink-muted">Finance has paid this receipt. To undo it, Finance voids the expense first.</p>
		{/if}
	</div>
</div>
