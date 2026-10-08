<script lang="ts">
	import { enhance, applyAction, deserialize } from '$app/forms';
	import { goto, invalidate, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ChefHatIcon from '@lucide/svelte/icons/chef-hat';
	import NewOrderSheet from './new-order-sheet.svelte';
	import PayDialog from './pay-dialog.svelte';
	import OrderCard from './order-card.svelte';
	import ThreadSheet from './thread-sheet.svelte';
	import RefundDialog from './refund-dialog.svelte';
	import BanknoteArrowUpIcon from '@lucide/svelte/icons/banknote-arrow-up';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Order = PageData['orders'][number];
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const slug = $derived(page.params.hotel!);
	const base = $derived(`/${slug}/management/dining`);

	const COLUMNS = [
		{ key: 'new', label: 'New', hint: 'Waiting for the kitchen', statuses: ['new', 'accepted'] },
		{ key: 'preparing', label: 'Preparing', hint: 'In the kitchen', statuses: ['preparing'] },
		{ key: 'ready', label: 'Ready', hint: 'Waiting to be served', statuses: ['ready'] },
		{ key: 'served', label: 'Served today', hint: 'Served; unpaid ones still need payment', statuses: ['served'] }
	] as const;

	const byColumn = $derived(
		Object.fromEntries(COLUMNS.map((c) => [c.key, data.orders.filter((o) => (c.statuses as readonly string[]).includes(o.status))])) as Record<string, Order[]>
	);
	const toPay = $derived(data.orders.filter((o) => o.paymentStatus === 'unpaid').length);

	let mobileCol = $state('new');

	// ---- the board stays current by polling (no push) ---------------------------------
	let nowMs = $state(Date.now());
	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 30_000);
		const refresh = setInterval(() => {
			if (!document.hidden) invalidate('app:dining-orders');
		}, 20_000);
		return () => {
			clearInterval(clock);
			clearInterval(refresh);
		};
	});

	// ---- venue filter -----------------------------------------------------------------
	const filterLabel = $derived(data.venues.find((v) => v.id === data.venueId)?.title ?? 'All venues');
	function setVenue(v: string) {
		goto(v === 'all' ? '?' : `?venue=${v}`, { keepFocus: true, noScroll: true });
	}

	// ---- actions ----------------------------------------------------------------------
	async function advance(order: Order, to: string) {
		const body = new FormData();
		body.set('orderId', order.id);
		body.set('to', to);
		const res = await fetch('?/advance', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
		const result = deserialize(await res.text());
		await applyAction(result);
		if (result.type === 'success') await invalidateAll();
	}

	let newOpen = $state(false);
	let payOpen = $state(false);
	let payOrderId = $state<string | null>(null);
	let pendingPayId = $state<string | null>(null);
	const payOrder = $derived(data.orders.find((o) => o.id === payOrderId) ?? null);

	function openPay(order: Order) {
		payOrderId = order.id;
		payOpen = true;
	}
	function placed(o: { id: string; code: string }, payNow: boolean) {
		if (payNow) pendingPayId = o.id;
	}
	// "Place & pay": open the payment dialog as soon as the new order is on the board.
	$effect(() => {
		if (!pendingPayId) return;
		const o = data.orders.find((x) => x.id === pendingPayId);
		if (o) {
			pendingPayId = null;
			openPay(o);
		}
	});

	let threadOpen = $state(false);
	let threadOrderId = $state<string | null>(null);
	const threadOrder = $derived(data.orders.find((o) => o.id === threadOrderId) ?? null);
	let respondFor = $state<Order | null>(null);
	let refundOpen = $state(false);
	let refundOrderId = $state<string | null>(null);
	const refundOrder = $derived([...data.refundDue, ...data.orders].find((o) => o.id === refundOrderId) ?? null);
	const refundOwed = (o: { totalCentavos: number; refundedCentavos: number }) => Math.max(0, o.totalCentavos - o.refundedCentavos);

	let cancelFor = $state<Order | null>(null);
	let voidFor = $state<Order | null>(null);
	let invoiceFor = $state<Order | null>(null);

	async function issueReceipt(order: Order) {
		const body = new FormData();
		body.set('orderId', order.id);
		body.set('type', 'official_receipt');
		const res = await fetch('?/issueDocument', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
		const result = deserialize(await res.text());
		await applyAction(result);
		if (result.type === 'success') await invalidateAll();
	}

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok && !form.placed) toast.success(form.ok);
		if (form?.ok) {
			cancelFor = null;
			voidFor = null;
			respondFor = null;
			refundOpen = false;
		}
		const issued = form?.issued as { id: string; type: string; formattedNo: string } | undefined;
		if (issued) {
			invoiceFor = null;
			const path = issued.type === 'invoice' ? 'invoice' : 'receipt';
			toast.success(`${issued.type === 'invoice' ? 'Invoice' : 'Official receipt'} ${issued.formattedNo} issued.`, {
				action: { label: 'Print', onClick: () => window.open(`/${slug}/print/${path}/${issued.id}`, '_blank', 'noopener') }
			});
		}
	});
</script>

<div class="mx-auto w-full max-w-[96rem] px-4 py-6 sm:px-6">
	<div class="mb-4 flex flex-wrap items-center gap-3">
		<p class="text-sm text-ink-muted" aria-live="polite">
			{data.orders.length === 0 ? 'No open orders.' : `${data.orders.length} on the board`}{toPay > 0 ? ` · ${toPay} to pay` : ''}
			{#if data.awaitingPayment > 0}
				<span class="ml-1" title="Online orders the guest has not paid for yet. They reach the kitchen once payment is confirmed.">
					· {data.awaitingPayment} awaiting online payment
				</span>
			{/if}
			<span class="ml-1 text-xs">Updates every 20 seconds.</span>
		</p>
		<div class="ml-auto flex flex-wrap items-center gap-2">
			{#if data.venues.length > 1}
				<Select.Root type="single" value={data.venueId ?? 'all'} onValueChange={setVenue}>
					<Select.Trigger class="w-44" aria-label="Venue">{filterLabel}</Select.Trigger>
					<Select.Content>
						<Select.Item value="all" label="All venues" />
						{#each data.venues as v (v.id)}<Select.Item value={v.id} label={v.title} />{/each}
					</Select.Content>
				</Select.Root>
			{/if}
			{#if data.canWrite}
				<Button onclick={() => (newOpen = true)} disabled={Object.keys(data.menus).length === 0}>
					<PlusIcon class="size-4" /> New order
				</Button>
			{/if}
		</div>
	</div>

	{#if data.refundDue.length > 0}
		<section class="mb-5 rounded-xl border border-border bg-surface" aria-label="Refunds due">
			<h2 class="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-semibold text-ink">
				<BanknoteArrowUpIcon class="size-4 text-brand" aria-hidden="true" />
				Refunds due <span class="font-normal tabular-nums text-ink-muted">· {data.refundDue.length}</span>
			</h2>
			<ul class="divide-y divide-border">
				{#each data.refundDue as o (o.id)}
					<li class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
						<span class="font-mono font-semibold text-ink">{o.code}</span>
						<span class="min-w-0 flex-1 truncate text-ink-muted">
							{o.guestName ?? 'Guest'}{o.guestPhone ? ` · ${o.guestPhone}` : ''} · cancelled{o.refundedCentavos > 0 ? ' · part refunded' : ''}
						</span>
						<span class="font-medium tabular-nums text-ink">{peso(refundOwed(o))}</span>
						{#if o.unreadMessages > 0 || o.source === 'online'}
							<Button variant="ghost" size="sm" onclick={() => { threadOrderId = o.id; threadOpen = true; }}>Messages{o.unreadMessages > 0 ? ` (${o.unreadMessages})` : ''}</Button>
						{/if}
						{#if data.canVoid}
							<Button size="sm" onclick={() => { refundOrderId = o.id; refundOpen = true; }}>Record refund</Button>
						{:else}
							<span class="text-xs text-ink-muted">A manager records the refund</span>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if data.venues.length === 0 || Object.keys(data.menus).length === 0}
		<div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
			<ChefHatIcon class="size-6 text-ink-muted" />
			<p class="text-sm text-ink-muted">Add dishes to a venue's menu, then take orders here.</p>
			<Button href="{base}/menu" variant="outline">Go to the menu</Button>
		</div>
	{:else}
		<!-- On a phone the four columns become tabs -->
		<Tabs.Root bind:value={mobileCol} class="mb-3 lg:hidden">
			<Tabs.List class="w-full">
				{#each COLUMNS as c (c.key)}
					<Tabs.Trigger value={c.key} class="flex-1">
						{c.label} <span class="ml-1 text-xs tabular-nums text-ink-muted">{byColumn[c.key]?.length ?? 0}</span>
					</Tabs.Trigger>
				{/each}
			</Tabs.List>
		</Tabs.Root>

		<div class="grid gap-4 lg:grid-cols-4">
			{#each COLUMNS as c (c.key)}
				<section class="min-w-0 {mobileCol === c.key ? 'block' : 'hidden'} lg:block" aria-label={c.label}>
					<h2 class="mb-2 hidden items-baseline justify-between px-1 lg:flex">
						<span class="text-sm font-semibold text-ink">{c.label}</span>
						<span class="text-xs tabular-nums text-ink-muted">{byColumn[c.key]?.length ?? 0}</span>
					</h2>
					<div class="space-y-3 lg:min-h-48 lg:rounded-xl lg:bg-surface-2/50 lg:p-2">
						{#each byColumn[c.key] ?? [] as order (order.id)}
							<OrderCard
								{order}
								{nowMs}
								{slug}
								timezone={data.timezone}
								canWrite={data.canWrite}
								canVoid={data.canVoid}
								onadvance={advance}
								onpay={openPay}
								oncancel={(o) => (cancelFor = o)}
								onvoid={(o) => (voidFor = o)}
								oninvoice={(o) => (invoiceFor = o)}
								onissuereceipt={issueReceipt}
								ontalk={(o) => { threadOrderId = o.id; threadOpen = true; }}
								onrespond={(o) => (respondFor = o)}
							/>
						{:else}
							<p class="px-2 py-6 text-center text-sm text-ink-muted">{c.hint}</p>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/if}
</div>

<NewOrderSheet bind:open={newOpen} {data} defaultVenueId={data.venueId} onplaced={placed} />
<PayDialog bind:open={payOpen} order={payOrder} shiftOpen={data.shiftOpen} {slug} />
<ThreadSheet bind:open={threadOpen} order={threadOrder ?? data.refundDue.find((o) => o.id === threadOrderId) ?? null} canWrite={data.canWrite} timezone={data.timezone} />
<RefundDialog bind:open={refundOpen} order={refundOrder} />

<!-- Answer a guest's request to cancel a paid order -->
<Dialog.Root open={respondFor !== null} onOpenChange={(o) => { if (!o) respondFor = null; }}>
	<Dialog.Content class="sm:max-w-md">
		{#if respondFor}
			<Dialog.Header>
				<Dialog.Title>{respondFor.code}: cancellation request</Dialog.Title>
				<Dialog.Description>
					{respondFor.guestName ?? 'The guest'} paid {peso(respondFor.totalCentavos)} and asked to cancel{respondFor.cancelRequestNote ? `: “${respondFor.cancelRequestNote}”` : '.'}
					If you approve, the order is cancelled and the amount appears under Refunds due.
				</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/respondCancel" use:enhance class="space-y-3">
				<input type="hidden" name="orderId" value={respondFor.id} />
				<div>
					<Label for="respMsg">Message to the guest (optional)</Label>
					<Textarea id="respMsg" name="message" rows={2} maxlength={500} placeholder="A short note they will see on their order page" class="mt-1 min-h-0" />
				</div>
				<Dialog.Footer class="gap-2">
					<Button type="button" variant="ghost" onclick={() => (respondFor = null)}>Not now</Button>
					<Button type="submit" name="approve" value="false" variant="outline">Decline</Button>
					<Button type="submit" name="approve" value="true">Approve and cancel</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Cancel an unpaid order -->
<Dialog.Root open={cancelFor !== null} onOpenChange={(o) => { if (!o) cancelFor = null; }}>
	<Dialog.Content class="sm:max-w-sm">
		{#if cancelFor}
			<Dialog.Header>
				<Dialog.Title>Cancel {cancelFor.code}?</Dialog.Title>
				<Dialog.Description>The kitchen will stop preparing it. A reason is kept in the audit log.</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/cancel" use:enhance class="space-y-3">
				<input type="hidden" name="orderId" value={cancelFor.id} />
				<div>
					<Label for="cancelReason">Reason</Label>
					<Input id="cancelReason" name="reason" required maxlength={300} placeholder="Guest left, wrong table…" class="mt-1" />
				</div>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (cancelFor = null)}>Keep order</Button>
					<Button type="submit" variant="destructive">Cancel order</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Void a payment (managers) -->
<Dialog.Root open={voidFor !== null} onOpenChange={(o) => { if (!o) voidFor = null; }}>
	<Dialog.Content class="sm:max-w-sm">
		{#if voidFor}
			<Dialog.Header>
				<Dialog.Title>Void the payment for {voidFor.code}?</Dialog.Title>
				<Dialog.Description>
					The money is taken back out of the cash ledger and the official receipt is cancelled (its number is never reused). The order goes back to unpaid.
				</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/voidPayment" use:enhance class="space-y-3">
				<input type="hidden" name="orderId" value={voidFor.id} />
				<div>
					<Label for="voidReason">Reason</Label>
					<Input id="voidReason" name="reason" required maxlength={300} placeholder="Charged twice, wrong amount…" class="mt-1" />
				</div>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (voidFor = null)}>Keep payment</Button>
					<Button type="submit" variant="destructive">Void payment</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Issue an invoice, with optional bill-to details -->
<Dialog.Root open={invoiceFor !== null} onOpenChange={(o) => { if (!o) invoiceFor = null; }}>
	<Dialog.Content class="sm:max-w-md">
		{#if invoiceFor}
			<Dialog.Header>
				<Dialog.Title>Issue an invoice for {invoiceFor.code}</Dialog.Title>
				<Dialog.Description>
					Uses the next number in your BIR invoice series. Fill in the billed party if the guest or a company needs their name or TIN on it.
				</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/issueDocument" use:enhance class="space-y-3">
				<input type="hidden" name="orderId" value={invoiceFor.id} />
				<input type="hidden" name="type" value="invoice" />
				<div>
					<Label for="billName">Billed to (optional)</Label>
					<Input id="billName" name="billToName" maxlength={160} value={invoiceFor.guestName ?? ''} class="mt-1" />
				</div>
				<div>
					<Label for="billTin">TIN (optional)</Label>
					<Input id="billTin" name="billToTin" maxlength={40} class="mt-1" />
				</div>
				<div>
					<Label for="billAddr">Address (optional)</Label>
					<Textarea id="billAddr" name="billToAddress" rows={2} maxlength={300} class="mt-1" />
				</div>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (invoiceFor = null)}>Cancel</Button>
					<Button type="submit">Issue invoice</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
