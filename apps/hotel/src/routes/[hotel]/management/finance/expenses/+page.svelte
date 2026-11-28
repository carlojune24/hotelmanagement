<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import VendorCombobox from '$lib/components/staff/vendor-combobox.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const base = $derived(`/${page.params.hotel}/management/finance`);
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	$effect(() => {
		if (form && 'ok' in form && form.ok) {
			toast.success(form.ok);
			showNew = false;
			payingId = null;
			vendorText = '';
			untrack(clearPhotos); // untracked: reading `photos` here would re-run this effect forever
		}
		if (form && 'error' in form && form.error) toast.error(form.error);
	});

	let showNew = $state(false);
	let payingId = $state<string | null>(null);
	// Own state, not value={data.today}: the staff layout refreshes `data` every 30 s, which would reset a picked date.
	let expenseDate = $state('');
	let paidOn = $state('');

	// Receipt photos picked in the form. The native input would forget the earlier pick on every
	// new one, so keep the files here and write them back into the input.
	const MAX_PHOTOS = 10;
	let photos = $state<{ file: File; url: string }[]>([]);
	function syncPhotos() {
		const input = document.getElementById('exp-photos') as HTMLInputElement | null;
		if (!input) return;
		const dt = new DataTransfer();
		photos.forEach((p) => dt.items.add(p.file));
		input.files = dt.files;
	}
	function clearPhotos() {
		photos.forEach((p) => URL.revokeObjectURL(p.url));
		photos = [];
	}
	function addPhotos(e: Event) {
		const picked = Array.from((e.currentTarget as HTMLInputElement).files ?? []);
		const room = MAX_PHOTOS - photos.length;
		if (picked.length > room) toast.error(`Up to ${MAX_PHOTOS} photos — the extra ones were left out.`);
		photos = [...photos, ...picked.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }))];
		syncPhotos();
	}
	function removePhoto(i: number) {
		URL.revokeObjectURL(photos[i]!.url);
		photos = photos.filter((_, j) => j !== i);
		syncPhotos();
	}

	// Vendor: pick a saved one or type a one-off name (the server matches names case-insensitively).
	let vendorText = $state('');

	const statusClass: Record<string, string> = {
		draft: 'border-border bg-surface-2 text-ink-muted',
		approved: 'border-transparent bg-brand/15 text-brand',
		paid: 'border-transparent bg-ok/15 text-ok',
		void: 'border-transparent bg-danger/15 text-danger'
	};
	const tabs = ['', 'draft', 'approved', 'paid'] as const;
	const tabLabel = (s: string) => (s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1));

	// Every filter link and the export/print keep the other filters.
	function href(path: string, next: Record<string, string> = {}) {
		const f = { status: data.filters.status, src: data.filters.source, from: data.filters.from, to: data.filters.to, ...next };
		const p = new URLSearchParams();
		for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
		const qs = p.toString();
		return qs ? `${path}?${qs}` : path;
	}
	const listPath = $derived(`${base}/expenses`);
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
	<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
		<h1 class="text-xl font-semibold tracking-tight text-ink">Expenses</h1>
		<div class="flex gap-2">
			<a href="{base}/expenses/recurring" class="text-sm text-ink-muted underline underline-offset-2">Recurring</a>
			{#if data.finance.canExpense}
				<Button size="sm" onclick={() => { showNew = !showNew; expenseDate = data.today; clearPhotos(); }}>New expense</Button>
			{/if}
		</div>
	</div>

	{#if showNew}
		<p class="mb-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-ink">
			Buying stock (food, toiletries, linens)? Encode the receipt in
			<a class="font-medium underline" href="/{page.params.hotel}/management/inventory/restock/new">Inventory → Restock</a>
			instead. It adds the items to stock and creates this expense for you, so it is never entered twice.
		</p>
		<form
			method="POST"
			action="?/create"
			enctype="multipart/form-data"
			use:enhance
			class="mb-6 grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-3"
		>
			<div><Label class="text-xs">Date</Label><Input name="expenseDate" type="date" bind:value={expenseDate} required class="mt-1" /></div>
			<div>
				<Label class="text-xs">Category</Label>
				<select name="categoryId" required class="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
					{#each data.categories as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
				</select>
			</div>
			<div>
				<Label for="exp-vendor" class="text-xs">Vendor</Label>
				<VendorCombobox vendors={data.vendors} bind:value={vendorText} id="exp-vendor" />
				<p class="mt-1 text-xs text-ink-muted">Typed names are saved on this expense only.</p>
			</div>
			<div>
				<Label class="text-xs">For</Label>
				<select name="source" required class="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
					<option value="" disabled selected>Hotel or dining?</option>
					<option value="hotel">Hotel</option>
					<option value="dining">Dining</option>
				</select>
			</div>
			<div class="sm:col-span-2"><Label class="text-xs">Description</Label><Input name="description" required maxlength={300} class="mt-1" /></div>
			<div><Label class="text-xs">Vendor invoice/OR no.</Label><Input name="vendorInvoiceNo" maxlength={120} class="mt-1" /></div>
			<div>
				<Label for="exp-gross" class="text-xs">Amount on receipt (₱)</Label>
				<Input id="exp-gross" name="gross" type="number" min="0.01" step="0.01" required class="mt-1" />
				<p class="mt-1 text-xs text-ink-muted">The total you actually pay.</p>
			</div>
			<div class="sm:col-span-2"><Label class="text-xs">Notes</Label><Input name="notes" maxlength={1000} class="mt-1" /></div>
			<div>
				<Label for="exp-photos" class="text-xs">Receipt photos</Label>
				<Input id="exp-photos" name="attachment" type="file" accept="image/*" multiple onchange={addPhotos} class="mt-1" />
				<p class="mt-1 text-xs text-ink-muted">Pick one or more (up to {MAX_PHOTOS}). Pick again to add more.</p>
				{#if photos.length}
					<div class="mt-2 flex flex-wrap gap-2">
						{#each photos as p, i (p.url)}
							<div class="relative">
								<a href={p.url} target="_blank" rel="noopener"><img src={p.url} alt="Selected receipt {i + 1}" class="size-16 rounded-md border border-border object-cover" /></a>
								<button type="button" onclick={() => removePhoto(i)} aria-label="Remove photo {i + 1}" class="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-background text-xs leading-none text-ink shadow-sm hover:bg-surface-2">×</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
			<div class="flex items-end sm:col-span-3">
				<Button type="submit" size="sm">Save expense</Button>
			</div>
		</form>
	{/if}

	<!-- Source, export and print -->
	<div class="mb-3 flex flex-wrap items-center gap-3">
		<div class="inline-flex rounded-lg border border-border bg-surface-2 p-1" role="group" aria-label="Source">
			{#each [['', 'All'], ['hotel', 'Hotel'], ['dining', 'Dining']] as const as [v, label] (v)}
				<a
					href={href(listPath, { src: v })}
					aria-current={data.filters.source === v ? 'true' : undefined}
					class="min-w-20 rounded-md px-4 py-2 text-center text-sm font-semibold {data.filters.source === v ? 'bg-background text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}"
				>{label}</a>
			{/each}
		</div>
		<Button variant="outline" href={href(`${listPath}/export`)} data-sveltekit-reload>
			<DownloadIcon class="size-4" aria-hidden="true" /> Export CSV
		</Button>
		<Button variant="outline" href={href(`/${page.params.hotel}/print/expenses`)} target="_blank" rel="noopener">
			<PrinterIcon class="size-4" aria-hidden="true" /> Print
		</Button>
		<span class="text-xs text-ink-muted">{data.rows.length} expense{data.rows.length === 1 ? '' : 's'} · {peso(data.totals.gross)}</span>
	</div>

	<!-- Status tabs and dates -->
	<div class="mb-3 flex flex-wrap items-end justify-between gap-3">
	<div class="flex gap-1">
		{#each tabs as t (t)}
			<a
				href={href(listPath, { status: t })}
				class="rounded-md px-3 py-1.5 text-sm font-medium {data.filters.status === t
					? 'bg-surface-2 text-ink'
					: 'text-ink-muted hover:text-ink'}"
			>
				{tabLabel(t)}
			</a>
		{/each}
	</div>
	<form method="GET" action={listPath} class="flex flex-wrap items-end gap-2">
		{#if data.filters.status}<input type="hidden" name="status" value={data.filters.status} />{/if}
		{#if data.filters.source}<input type="hidden" name="src" value={data.filters.source} />{/if}
		<label class="text-xs text-ink-muted">From
			<Input type="date" name="from" value={data.filters.from} class="mt-0.5 h-9 w-40" />
		</label>
		<label class="text-xs text-ink-muted">To
			<Input type="date" name="to" value={data.filters.to} class="mt-0.5 h-9 w-40" />
		</label>
		<Button type="submit" size="sm">Apply</Button>
		{#if data.filters.from || data.filters.to}
			<a href={href(listPath, { from: '', to: '' })} class="pb-2 text-xs text-ink-muted underline underline-offset-2">Reset</a>
		{/if}
	</form>
	</div>

	<div class="overflow-x-auto rounded-xl border border-border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Date</Table.Head>
					<Table.Head>For</Table.Head>
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
						<Table.Cell>
							<span class="rounded px-1.5 py-0.5 text-[11px] font-medium {r.source === 'dining' ? 'bg-warning/20 text-ink' : 'bg-brand/10 text-brand'}">{r.source === 'dining' ? 'Dining' : 'Hotel'}</span>
						</Table.Cell>
						<Table.Cell class="text-ink">
							{r.categoryName}
							{#if r.vendorName}<span class="block text-xs text-ink-muted">{r.vendorName}</span>{/if}
						</Table.Cell>
						<Table.Cell class="max-w-[16rem] text-ink-muted">
							<a href="{listPath}/{r.id}" class="hover:text-ink hover:underline underline-offset-2">{r.description}</a>
							{#if r.vendorInvoiceNo}<span class="block text-xs">#{r.vendorInvoiceNo}</span>{/if}
							{#if r.attachmentUrls.length === 1}<a href={r.attachmentUrls[0]} target="_blank" class="text-xs underline underline-offset-2">receipt</a>{:else if r.attachmentUrls.length > 1}<a href="{listPath}/{r.id}" class="text-xs underline underline-offset-2">receipts ({r.attachmentUrls.length})</a>{/if}
						</Table.Cell>
						<Table.Cell class="text-right tabular-nums text-ink">{peso(r.grossCentavos)}</Table.Cell>
						<Table.Cell class="text-right tabular-nums text-ink-muted">{r.inputVatCentavos ? peso(r.inputVatCentavos) : '—'}</Table.Cell>
						<Table.Cell><Badge variant="outline" class={statusClass[r.status]}>{r.status}</Badge></Table.Cell>
						<Table.Cell class="text-right whitespace-nowrap">
							<a href="{listPath}/{r.id}" class="text-xs text-ink underline underline-offset-2">Details</a>
							{#if r.status === 'draft' && data.finance.canExpense}
								<form method="POST" action="?/approve" use:enhance class="inline">
									<input type="hidden" name="id" value={r.id} />
									<button class="ml-2 text-xs text-brand underline underline-offset-2">Approve</button>
								</form>
							{/if}
							{#if (r.status === 'approved' || r.status === 'draft') && data.finance.canExpense}
								<button
									type="button"
									onclick={() => { payingId = payingId === r.id ? null : r.id; paidOn = data.today; }}
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
							<Table.Cell colspan={8} class="bg-surface-2">
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
									<div><Label class="text-xs">Paid on</Label><Input name="paidOn" type="date" bind:value={paidOn} class="mt-1 h-8" /></div>
									<Button type="submit" size="sm">Confirm payment ({peso(r.grossCentavos - r.withholdingTaxCentavos)})</Button>
									{#if r.withholdingTaxCentavos > 0}
										<span class="pb-1.5 text-xs text-ink-muted">{peso(r.withholdingTaxCentavos)} withheld — remit to BIR</span>
									{/if}
								</form>
							</Table.Cell>
						</Table.Row>
					{/if}
				{:else}
					<Table.Row><Table.Cell colspan={8} class="py-6 text-center text-ink-muted">No expenses.</Table.Cell></Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
	<p class="mt-2 text-right text-xs text-ink-muted">
		Shown: {peso(data.totals.gross)} gross · {peso(data.totals.vat)} input VAT
	</p>
</div>
