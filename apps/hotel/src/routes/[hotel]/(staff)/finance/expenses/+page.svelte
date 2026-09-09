<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const base = $derived(`/${page.params.hotel}/finance`);
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	$effect(() => {
		if (form && 'ok' in form && form.ok) {
			toast.success(form.ok);
			showNew = false;
			payingId = null;
		}
		if (form && 'error' in form && form.error) toast.error(form.error);
	});

	let showNew = $state(false);
	let payingId = $state<string | null>(null);

	const statusClass: Record<string, string> = {
		draft: 'border-border bg-surface-2 text-ink-muted',
		approved: 'border-transparent bg-brand/15 text-brand',
		paid: 'border-transparent bg-ok/15 text-ok',
		void: 'border-transparent bg-danger/15 text-danger'
	};
	const tabs = ['', 'draft', 'approved', 'paid'] as const;
	const tabLabel = (s: string) => (s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1));
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
	<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
		<h1 class="text-xl font-semibold tracking-tight text-ink">Expenses</h1>
		<div class="flex gap-2">
			<a href="{base}/expenses/recurring" class="text-sm text-ink-muted underline underline-offset-2">Recurring</a>
			{#if data.finance.canExpense}
				<Button size="sm" onclick={() => (showNew = !showNew)}>New expense</Button>
			{/if}
		</div>
	</div>

	{#if showNew}
		<form
			method="POST"
			action="?/create"
			enctype="multipart/form-data"
			use:enhance
			class="mb-6 grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-3"
		>
			<div><Label class="text-xs">Date</Label><Input name="expenseDate" type="date" value={data.today} required class="mt-1" /></div>
			<div>
				<Label class="text-xs">Category</Label>
				<select name="categoryId" required class="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
					{#each data.categories as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
				</select>
			</div>
			<div>
				<Label class="text-xs">Vendor</Label>
				<select name="vendorId" class="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
					<option value="">— none —</option>
					{#each data.vendors as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
				</select>
			</div>
			<div class="sm:col-span-2"><Label class="text-xs">Description</Label><Input name="description" required maxlength={300} class="mt-1" /></div>
			<div><Label class="text-xs">Vendor invoice/OR no.</Label><Input name="vendorInvoiceNo" maxlength={120} class="mt-1" /></div>
			<div><Label class="text-xs">Gross amount (₱)</Label><Input name="gross" type="number" min="0.01" step="0.01" required class="mt-1" /></div>
			<div><Label class="text-xs">Withholding tax (₱)</Label><Input name="withholdingTax" type="number" min="0" step="0.01" class="mt-1" /></div>
			<label class="flex items-center gap-2 pt-5 text-sm text-ink">
				<input type="checkbox" name="isVatable" class="size-4" /> VAT-inclusive (12% input VAT)
			</label>
			<div class="sm:col-span-2"><Label class="text-xs">Notes</Label><Input name="notes" maxlength={1000} class="mt-1" /></div>
			<div><Label class="text-xs">Receipt photo</Label><Input name="attachment" type="file" accept="image/*" class="mt-1" /></div>
			<div class="flex items-end sm:col-span-3">
				<Button type="submit" size="sm">Save expense</Button>
			</div>
		</form>
	{/if}

	<!-- Status tabs -->
	<div class="mb-3 flex gap-1">
		{#each tabs as t (t)}
			<a
				href="?status={t}"
				class="rounded-md px-3 py-1.5 text-sm font-medium {data.filters.status === t
					? 'bg-surface-2 text-ink'
					: 'text-ink-muted hover:text-ink'}"
			>
				{tabLabel(t)}
			</a>
		{/each}
	</div>

	<div class="overflow-x-auto rounded-xl border border-border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Date</Table.Head>
					<Table.Head>Category / vendor</Table.Head>
					<Table.Head>Description</Table.Head>
					<Table.Head class="text-right">Gross</Table.Head>
					<Table.Head class="text-right">Input VAT</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.rows as r (r.id)}
					<Table.Row>
						<Table.Cell class="whitespace-nowrap text-ink-muted">{r.expenseDate}</Table.Cell>
						<Table.Cell class="text-ink">
							{r.categoryName}
							{#if r.vendorName}<span class="block text-xs text-ink-muted">{r.vendorName}</span>{/if}
						</Table.Cell>
						<Table.Cell class="max-w-[16rem] text-ink-muted">
							{r.description}
							{#if r.vendorInvoiceNo}<span class="block text-xs">#{r.vendorInvoiceNo}</span>{/if}
							{#if r.attachmentUrl}<a href={r.attachmentUrl} target="_blank" class="text-xs underline underline-offset-2">receipt</a>{/if}
						</Table.Cell>
						<Table.Cell class="text-right tabular-nums text-ink">{peso(r.grossCentavos)}</Table.Cell>
						<Table.Cell class="text-right tabular-nums text-ink-muted">{r.inputVatCentavos ? peso(r.inputVatCentavos) : '—'}</Table.Cell>
						<Table.Cell><Badge variant="outline" class={statusClass[r.status]}>{r.status}</Badge></Table.Cell>
						<Table.Cell class="text-right whitespace-nowrap">
							{#if r.status === 'draft' && data.finance.canExpense}
								<form method="POST" action="?/approve" use:enhance class="inline">
									<input type="hidden" name="id" value={r.id} />
									<button class="text-xs text-brand underline underline-offset-2">Approve</button>
								</form>
							{/if}
							{#if (r.status === 'approved' || r.status === 'draft') && data.finance.canExpense}
								<button
									type="button"
									onclick={() => (payingId = payingId === r.id ? null : r.id)}
									class="ml-2 text-xs text-ok underline underline-offset-2"
								>
									Pay
								</button>
							{/if}
							{#if r.status !== 'void' && r.status !== 'paid' && data.finance.canExpense}
								<form method="POST" action="?/void" use:enhance class="inline">
									<input type="hidden" name="id" value={r.id} />
									<input type="hidden" name="reason" value="Voided from list" />
									<button class="ml-2 text-xs text-ink-muted underline underline-offset-2 hover:text-danger">Void</button>
								</form>
							{/if}
						</Table.Cell>
					</Table.Row>
					{#if payingId === r.id}
						<Table.Row>
							<Table.Cell colspan={7} class="bg-surface-2">
								<form method="POST" action="?/pay" use:enhance class="flex flex-wrap items-end gap-2">
									<input type="hidden" name="id" value={r.id} />
									<div>
										<Label class="text-xs">Pay from</Label>
										<select name="paidFromAccountId" required class="mt-1 h-8 rounded-md border border-input bg-transparent px-2 text-sm">
											{#each data.accounts as a (a.id)}<option value={a.id}>{a.name} ({peso(a.currentBalanceCentavos)})</option>{/each}
										</select>
									</div>
									<div>
										<Label class="text-xs">Method</Label>
										<select name="paymentMethod" class="mt-1 h-8 rounded-md border border-input bg-transparent px-2 text-sm">
											{#each data.payMethods as m (m)}<option value={m}>{m.replace('_', ' ')}</option>{/each}
										</select>
									</div>
									<div><Label class="text-xs">Reference</Label><Input name="paymentReferenceNo" class="mt-1 h-8" /></div>
									<div><Label class="text-xs">Paid on</Label><Input name="paidOn" type="date" value={data.today} class="mt-1 h-8" /></div>
									<Button type="submit" size="sm">Confirm payment ({peso(r.grossCentavos)})</Button>
								</form>
							</Table.Cell>
						</Table.Row>
					{/if}
				{:else}
					<Table.Row><Table.Cell colspan={7} class="py-6 text-center text-ink-muted">No expenses.</Table.Cell></Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
	<p class="mt-2 text-right text-xs text-ink-muted">
		Shown: {peso(data.totals.gross)} gross · {peso(data.totals.vat)} input VAT
	</p>
</div>
