<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import PaymentFields from '$lib/components/staff/payment-fields.svelte';
	import OrderPaymentForm from '$lib/components/staff/order-payment-form.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}`);
	const staffBase = $derived(`${base}/management`);
	const peso = (c: number) =>
		`₱${(Math.abs(c) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const toCentavos = (v: string) => Math.max(0, Math.round(parseFloat(v || '0') * 100));

	type Line = PageData['lines'][number];
	let payOpen = $state(false);
	let ledgerLine = $state<Line | null>(null);
	let ledgerAmount = $state('');
	let ledgerSubmitting = $state(false);
	let refundLine = $state<Line | null>(null);
	let splitPayment = $state<PageData['payments'][number] | null>(null);
	let splitRows = $state<Record<string, string>>({});
	let splitSubmitting = $state(false);

	$effect(() => {
		if (form && 'ok' in form && form.ok) toast.success(form.ok);
		else if (form && 'error' in form && form.error) toast.error(form.error);
	});

	const balance = $derived(data.ledger.balanceCentavos);
	const owedRooms = $derived(data.payableLines.filter((l) => l.balanceCentavos > 0));
	const canTakePayment = $derived(data.canCollect && owedRooms.length > 0);
	const multiRoom = $derived(data.lines.length > 1);

	function openLedger(l: Line) {
		ledgerLine = l;
		ledgerAmount = (l.balanceCentavos / 100).toFixed(2);
	}
	function openSplit(p: PageData['payments'][number]) {
		splitPayment = p;
		const init: Record<string, string> = {};
		for (const l of data.payableLines) {
			const a = p.allocations.find((x) => x.lineId === l.id);
			init[l.id] = a ? (a.amountCentavos / 100).toFixed(2) : '';
		}
		// A payment with no explicit split yet: start with the whole amount on its own room.
		if (p.allocations.length === 0) {
			const own = data.payableLines.find((l) => l.title === p.lineTitle) ?? data.payableLines[0];
			if (own) init[own.id] = (p.amountCentavos / 100).toFixed(2);
		}
		splitRows = init;
	}
	const splitTotal = $derived(Object.values(splitRows).reduce((sum, v) => sum + toCentavos(v), 0));
	const splitJson = $derived(
		JSON.stringify(
			data.payableLines
				.map((l) => ({ kind: l.kind, id: l.id, amount: toCentavos(splitRows[l.id] ?? '') / 100 }))
				.filter((a) => a.amount > 0)
		)
	);

	const statusLabel = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
	function statusClass(status: string): string {
		if (status === 'confirmed' || status === 'checked_in' || status === 'completed')
			return 'border-transparent bg-ok/15 text-ok';
		if (status === 'cancelled' || status === 'no_show')
			return 'border-transparent bg-danger/15 text-danger';
		return 'border-border bg-surface-2 text-ink-muted';
	}
	const methodLabel: Record<string, string> = {
		cash: 'Cash',
		card: 'Card',
		gcash: 'GCash',
		maya: 'Maya',
		bank_transfer: 'Bank transfer',
		cheque: 'Cheque',
		paymongo: 'Online (PayMongo)',
		house_use: 'City ledger',
		security_deposit: 'Security deposit'
	};
	const when = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
	const reservationHref = (l: { kind: 'room' | 'hall'; id: string }) =>
		`${staffBase}/reservations/${l.kind}/${l.id}`;
	const canResplit = (p: PageData['payments'][number]) =>
		data.canCollect &&
		multiRoom &&
		!p.voidedAt &&
		p.status === 'paid' &&
		p.amountCentavos > 0 &&
		p.provider !== 'paymongo' &&
		p.method !== 'house_use' &&
		p.method !== 'security_deposit';
</script>

<div class="mx-auto max-w-5xl space-y-6 p-6">
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">{data.guest.fullName}</h1>
			<p class="mt-0.5 text-sm text-ink-muted">
				Booking <span class="font-mono">{data.order.code}</span>
				{#if data.guest.email}· {data.guest.email}{/if}
				{#if data.guest.phone}· {data.guest.phone}{/if}
			</p>
			<div class="mt-2 flex items-center gap-2">
				<Badge variant="outline" class={statusClass(data.order.status)}>
					{statusLabel(data.order.status)}
				</Badge>
				{#if data.order.amountDueNowCentavos != null}
					<Badge variant="outline" class="border-border bg-surface-2 text-ink-muted">
						Online downpayment
					</Badge>
				{/if}
			</div>
		</div>
		<div class="flex items-center gap-2">
			<Button
				variant="outline"
				size="sm"
				href="{base}/print/transaction/{data.order.id}"
				target="_blank">Print transaction</Button
			>
			<Button
				variant="outline"
				size="sm"
				href="{base}/print/invoice/for-order/{data.order.id}"
				target="_blank">Print all invoices</Button
			>
			{#if page.url.searchParams.has('back')}
				<Button
					variant="outline"
					size="sm"
					href="{staffBase}/transactions{page.url.searchParams.get('back')}"
					>← Booking transactions</Button
				>
			{:else if page.url.searchParams.get('roomId')}
				<Button
					variant="outline"
					size="sm"
					href="{staffBase}/front-desk?roomId={page.url.searchParams.get('roomId')}"
					>← Front desk</Button
				>
			{:else}
				<Button variant="outline" size="sm" href="{staffBase}/reservations">← Reservations</Button>
			{/if}
		</div>
	</div>

	<div class="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
		<div class="min-w-0 space-y-6">
			<section class="space-y-3">
				<h2 class="text-sm font-semibold text-ink">Each room's folio</h2>
				{#each data.lines as l (l.id)}
					<div class="rounded-lg border border-border">
						<div
							class="flex flex-wrap items-start justify-between gap-2 border-b border-border px-3 py-2.5"
						>
							<div class="min-w-0">
								<a
									href={reservationHref(l)}
									class="font-medium text-ink underline-offset-2 hover:underline"
								>
									{l.title}
								</a>
								<div class="text-xs text-ink-muted">{l.detail}</div>
							</div>
							<Badge variant="outline" class={statusClass(l.status)}>{statusLabel(l.status)}</Badge>
						</div>

						<div class="divide-y divide-border text-sm">
							{#each l.charges as c (c.id)}
								<div
									class="flex items-start justify-between gap-3 px-3 py-1.5 {c.voided
										? 'opacity-50'
										: ''}"
								>
									<div class="min-w-0">
										<span class="text-ink {c.voided ? 'line-through' : ''}">
											{c.description}{c.quantity > 1 ? ` × ${c.quantity}` : ''}
										</span>
										{#if c.voided}
											<span class="text-xs text-danger"
												>voided{#if c.voidReason} — {c.voidReason}{/if}</span
											>
										{/if}
									</div>
									<span class="shrink-0 tabular-nums text-ink {c.voided ? 'line-through' : ''}">
										{peso(c.totalCentavos)}
									</span>
								</div>
							{/each}

							{#if l.deposit}
								<div class="px-3 py-1.5 text-ink-muted">
									Security deposit {peso(l.deposit.amountCentavos)} —
									{#if l.deposit.status === 'held'}
										<span class="font-medium text-ink">held</span> (not part of the bill)
									{:else if l.deposit.status === 'voided'}
										voided
									{:else}
										settled: {peso(l.deposit.forfeitedCentavos ?? 0)} kept for damage, {peso(
											l.deposit.refundedCentavos ?? 0
										)} refunded
									{/if}
								</div>
							{/if}
							{#if l.depositAppliedCentavos > 0}
								<div class="flex items-start justify-between gap-3 px-3 py-1.5">
									<span class="text-ink-muted">Less: security deposit applied to damage</span>
									<span class="shrink-0 tabular-nums text-ink">−{peso(l.depositAppliedCentavos)}</span>
								</div>
							{/if}
							<div class="flex items-start justify-between gap-3 px-3 py-1.5">
								<span class="text-ink-muted">Less: payments received on this room</span>
								<span class="shrink-0 tabular-nums text-ink">−{peso(l.paymentsCentavos)}</span>
							</div>
							{#if l.cityLedgerMovedCentavos > 0}
								<div class="flex items-start justify-between gap-3 px-3 py-1.5">
									<span class="text-ink-muted">Less: moved to the city ledger</span>
									<span class="shrink-0 tabular-nums text-ink">−{peso(l.cityLedgerMovedCentavos)}</span>
								</div>
							{/if}
							{#each l.cityLedger as r (r.id)}
								<div class="flex items-start justify-between gap-3 bg-surface-2 px-3 py-1.5 text-xs">
									<span class="text-ink-muted">
										City ledger account · {r.billToName}{#if r.billToCompany} · {r.billToCompany}{/if} ·
										<a
											href="{staffBase}/finance/receivables"
											class="underline underline-offset-2 hover:text-ink">open</a
										>
									</span>
									<span class="shrink-0 tabular-nums">
										{peso(r.amountCentavos)} moved
									</span>
								</div>
							{/each}
						</div>

						<div
							class="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-2 px-3 py-2 text-sm"
						>
							<div class="flex items-center gap-2 font-medium">
								<span class="text-ink">{l.balanceCentavos < 0 ? 'Room credit' : 'Room balance'}</span>
								<span class="tabular-nums {l.balanceCentavos > 0 ? 'text-danger' : 'text-ink'}">
									{l.balanceCentavos === 0 ? 'Settled' : peso(l.balanceCentavos)}
								</span>
							</div>
							<div class="flex items-center gap-1.5">
								{#if data.canCityLedger && l.balanceCentavos > 0}
									<Button variant="outline" size="xs" onclick={() => openLedger(l)}>
										Move to city ledger
									</Button>
								{/if}
								{#if data.canCollect && l.balanceCentavos < 0}
									<Button variant="outline" size="xs" onclick={() => (refundLine = l)}>
										Refund credit
									</Button>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</section>

			<section>
				<h2 class="mb-2 text-sm font-semibold text-ink">Payments</h2>
				{#if data.payments.length === 0}
					<p class="text-sm text-ink-muted">No payment recorded yet.</p>
				{:else}
					<div class="divide-y divide-border rounded-lg border border-border">
						{#each data.payments as p (p.id)}
							<div
								class="flex items-start justify-between gap-3 px-3 py-2.5 text-sm {p.voidedAt
									? 'opacity-50'
									: ''}"
							>
								<div class="min-w-0">
									<div class="flex flex-wrap items-center gap-1.5">
										<span class="font-medium text-ink {p.voidedAt ? 'line-through' : ''}">
											{methodLabel[p.method] ?? p.method}
										</span>
										{#if p.purpose === 'deposit'}
											<Badge variant="outline" class="border-border bg-surface-2 text-ink-muted"
												>downpayment</Badge
											>
										{/if}
										{#if p.purpose === 'refund'}
											<Badge variant="outline" class="border-transparent bg-danger/15 text-danger"
												>refund</Badge
											>
										{/if}
										{#if p.status !== 'paid'}
											<Badge variant="outline" class="border-border bg-surface-2 text-ink-muted"
												>{p.status}</Badge
											>
										{/if}
									</div>
									<div class="mt-0.5 text-xs text-ink-muted">
										{#if p.lineTitle}<span class="font-medium text-ink">{p.lineTitle}</span> ·{/if}
										{when(p.paidAt)}
										{#if p.referenceNo}· Ref {p.referenceNo}{/if}
										{#if p.tenderedCentavos != null && p.method === 'cash'}
											· tendered {peso(p.tenderedCentavos)}, change {peso(p.changeCentavos ?? 0)}
										{/if}
									</div>
									{#if p.allocations.length > 0}
										<div class="mt-0.5 text-xs text-ink-muted">
											Split:
											{#each p.allocations as a, i (a.lineId)}
												{i > 0 ? ' · ' : ' '}<span class="text-ink">{a.title}</span>
												{peso(a.amountCentavos)}
											{/each}
										</div>
									{:else if !p.lineTitle && p.provider === 'paymongo' && multiRoom}
										<div class="mt-0.5 text-xs text-ink-muted">
											Online payment — shared across the rooms by price.
										</div>
									{/if}
									{#if p.voidedAt}
										<div class="mt-0.5 text-xs text-danger">
											Voided{#if p.voidReason} — {p.voidReason}{/if}
										</div>
									{/if}
									<div class="mt-1.5 flex flex-wrap items-center gap-1.5">
										{#if !p.voidedAt && p.amountCentavos > 0}
											<Button
												variant="outline"
												size="xs"
												href="{base}/print/receipt/{p.id}"
												target="_blank">Receipt</Button
											>
										{/if}
										{#if canResplit(p)}
											<Button variant="outline" size="xs" onclick={() => openSplit(p)}>
												Re-split across rooms
											</Button>
										{/if}
										{#if data.canCollect && !p.voidedAt && p.status === 'paid' && p.provider !== 'paymongo' && p.method !== 'house_use' && p.method !== 'security_deposit'}
											<form method="POST" action="?/voidPayment" use:enhance>
												<input type="hidden" name="paymentId" value={p.id} />
												<input type="hidden" name="reason" value="Voided at front desk" />
												<Button
													type="submit"
													variant="outline"
													size="xs"
													class="text-danger hover:text-danger">Void payment</Button
												>
											</form>
										{/if}
									</div>
								</div>
								<span class="shrink-0 tabular-nums text-ink {p.voidedAt ? 'line-through' : ''}">
									{p.amountCentavos < 0 ? '−' : ''}{peso(p.amountCentavos)}
								</span>
							</div>
						{/each}
					</div>
				{/if}
			</section>

			{#if data.cityLedgerAccount}
				<section class="rounded-lg border border-border">
					<h2 class="border-b border-border px-3 py-2.5 text-sm font-semibold text-ink">
						City ledger account
					</h2>
					<div class="space-y-1 px-3 py-2.5 text-sm">
						<div class="flex justify-between gap-3">
							<span class="text-ink-muted">Bill to</span>
							<span class="text-ink">
								{data.cityLedgerAccount.billToName}{#if data.cityLedgerAccount.billToCompany}
									· {data.cityLedgerAccount.billToCompany}{/if}
							</span>
						</div>
						<div class="flex justify-between gap-3">
							<span class="text-ink-muted">Moved from the rooms</span>
							<span class="tabular-nums text-ink">{peso(data.cityLedgerAccount.originalCentavos)}</span>
						</div>
						{#each data.cityLedgerAccount.collections as c (c.id)}
							<div class="flex justify-between gap-3 text-xs">
								<span class="text-ink-muted">
									Collected {c.date}{#if c.memo} · {c.memo}{/if}
								</span>
								<span class="shrink-0 tabular-nums text-ink">−{peso(c.amountCentavos)}</span>
							</div>
						{/each}
						<div class="flex justify-between gap-3 font-medium">
							<span class="text-ink">
								{data.cityLedgerAccount.outstandingCentavos === 0
									? 'Collected in full — nothing left to collect'
									: 'Still to collect'}
							</span>
							<span class="tabular-nums text-ink">{peso(data.cityLedgerAccount.outstandingCentavos)}</span>
						</div>
						<a
							href="{staffBase}/finance/receivables"
							class="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
							>Open in Finance → Receivables →</a
						>
					</div>
				</section>
			{/if}

			<section class="rounded-lg border border-border">
				<h2 class="border-b border-border px-3 py-2.5 text-sm font-semibold text-ink">
					Whole booking — the complete picture
				</h2>
				<dl class="divide-y divide-border text-sm">
					{#each data.lines as l (l.id)}
						<div class="flex items-center justify-between gap-3 px-3 py-1.5">
							<dt class="text-ink-muted">{l.title}</dt>
							<dd class="tabular-nums">
								<span class="text-ink">{peso(l.chargesCentavos)}</span>
								<span
									class="ml-2 text-xs {l.balanceCentavos > 0 ? 'text-danger' : 'text-ink-muted'}"
								>
									{l.balanceCentavos === 0
										? 'settled'
										: `${l.balanceCentavos < 0 ? 'credit' : 'owes'} ${peso(l.balanceCentavos)}`}
								</span>
							</dd>
						</div>
					{/each}
					<div class="flex items-center justify-between gap-3 px-3 py-1.5 font-medium">
						<dt class="text-ink">Total charges</dt>
						<dd class="tabular-nums text-ink">{peso(data.ledger.chargesTotalCentavos)}</dd>
					</div>
					{#if data.ledger.depositAppliedTotalCentavos > 0}
						<div class="flex items-center justify-between gap-3 px-3 py-1.5">
							<dt class="text-ink-muted">Less: security deposits applied to damage</dt>
							<dd class="tabular-nums text-ink">−{peso(data.ledger.depositAppliedTotalCentavos)}</dd>
						</div>
					{/if}
					<div class="flex items-center justify-between gap-3 px-3 py-1.5">
						<dt class="text-ink-muted">Less: payments received</dt>
						<dd class="tabular-nums text-ink">−{peso(data.ledger.paymentsReceivedCentavos)}</dd>
					</div>
					{#if data.ledger.cityLedgerTotalCentavos > 0}
						<div class="flex items-center justify-between gap-3 px-3 py-1.5">
							<dt class="text-ink-muted">Less: moved to the city ledger</dt>
							<dd class="tabular-nums text-ink">−{peso(data.ledger.cityLedgerTotalCentavos)}</dd>
						</div>
						{#if data.cityLedgerAccount}
							<div class="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
								<dt class="text-ink-muted">
									… of which collected by the hotel later ({data.cityLedgerAccount.collections.length}
									collection{data.cityLedgerAccount.collections.length === 1 ? '' : 's'})
								</dt>
								<dd class="tabular-nums text-ink">{peso(data.cityLedgerAccount.collectedCentavos)}</dd>
							</div>
							<div class="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
								<dt class="text-ink-muted">… city ledger still to collect</dt>
								<dd class="tabular-nums {data.cityLedgerAccount.outstandingCentavos > 0 ? 'text-danger' : 'text-ink'}">
									{data.cityLedgerAccount.outstandingCentavos === 0 ? 'nothing' : peso(data.cityLedgerAccount.outstandingCentavos)}
								</dd>
							</div>
						{/if}
					{/if}
					<div class="flex items-center justify-between gap-3 px-3 py-2.5">
						<dt class="font-semibold text-ink">
							{balance < 0
								? 'Credit owed to guest'
								: balance === 0
									? 'Balance'
									: 'Still owed by the guest'}
						</dt>
						<dd
							class="text-lg font-semibold tabular-nums {balance > 0 ? 'text-danger' : 'text-ink'}"
						>
							{balance === 0 ? 'Settled' : peso(balance)}
						</dd>
					</div>
				</dl>
			</section>
		</div>

		<aside class="space-y-4 lg:sticky lg:top-6">
			<div class="rounded-lg border border-border p-4">
				<dl class="space-y-1.5 text-sm">
					<div class="flex justify-between">
						<dt class="text-ink-muted">Charges</dt>
						<dd class="tabular-nums text-ink">{peso(data.ledger.chargesTotalCentavos)}</dd>
					</div>
					{#if data.ledger.depositAppliedTotalCentavos > 0}
						<div class="flex justify-between">
							<dt class="text-ink-muted">Deposits applied</dt>
							<dd class="tabular-nums text-ink">−{peso(data.ledger.depositAppliedTotalCentavos)}</dd>
						</div>
					{/if}
					<div class="flex justify-between">
						<dt class="text-ink-muted">Paid</dt>
						<dd class="tabular-nums text-ink">−{peso(data.ledger.paymentsReceivedCentavos)}</dd>
					</div>
					{#if data.ledger.cityLedgerTotalCentavos > 0}
						<div class="flex justify-between">
							<dt class="text-ink-muted">City ledger</dt>
							<dd class="tabular-nums text-ink">−{peso(data.ledger.cityLedgerTotalCentavos)}</dd>
						</div>
					{/if}
				</dl>
				<div class="mt-3 flex items-baseline justify-between border-t border-border pt-3">
					<span class="text-sm font-semibold text-ink">
						{balance < 0 ? 'Credit' : balance === 0 ? 'Balance' : 'Balance due'}
					</span>
					<span
						class="text-2xl font-semibold tabular-nums {balance > 0 ? 'text-danger' : 'text-ink'}"
					>
						{balance === 0 ? 'Settled' : peso(balance)}
					</span>
				</div>
				{#if data.order.amountDueNowCentavos != null && balance > 0}
					<p class="mt-2 text-xs text-ink-muted">
						The guest paid the downpayment online; the rest is collected here.
					</p>
				{/if}
			</div>

			{#if canTakePayment}
				<Button class="w-full" onclick={() => (payOpen = true)}>
					Take payment ({peso(owedRooms.reduce((s, r) => s + r.balanceCentavos, 0))} owed)
				</Button>
			{/if}
			<p class="text-xs text-ink-muted">
				Every room keeps its own payments, deposit and balance. A payment is split across the
				rooms it pays, and a hotel admin can move any one room's bill to the city ledger — the
				others are paid separately.
			</p>
		</aside>
	</div>
</div>

<Dialog.Root bind:open={payOpen}>
	<Dialog.Content class="max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Take payment</Dialog.Title>
			<Dialog.Description>
				Enter what was received, then say which room each part pays.
			</Dialog.Description>
		</Dialog.Header>
		{#if payOpen}
			<OrderPaymentForm
				action="?/takePayment"
				rooms={data.payableLines}
				cashier={data.cashier}
				onDone={() => (payOpen = false)}
			/>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root
	open={ledgerLine != null}
	onOpenChange={(o) => {
		if (!o) ledgerLine = null;
	}}
>
	<Dialog.Content>
		{#if ledgerLine}
			<Dialog.Header>
				<Dialog.Title>Move {ledgerLine.title} to the city ledger</Dialog.Title>
				<Dialog.Description>
					This room owes {peso(ledgerLine.balanceCentavos)}. Only this room's bill moves — the other
					rooms of the booking are untouched and are paid separately.
				</Dialog.Description>
			</Dialog.Header>
			<form
				method="POST"
				action="?/moveToCityLedger"
				use:enhance={() => {
					ledgerSubmitting = true;
					return async ({ update, result }) => {
						await update();
						ledgerSubmitting = false;
						if (result.type === 'success') ledgerLine = null;
					};
				}}
				class="space-y-3"
			>
				<input type="hidden" name="kind" value={ledgerLine.kind} />
				<input type="hidden" name="id" value={ledgerLine.id} />
				{#if data.cityLedgerAccount?.active}
					<p class="rounded-md bg-surface-2 px-3 py-2 text-sm text-ink-muted">
						This booking already has a city-ledger account for
						<span class="font-medium text-ink">{data.cityLedgerAccount.billToName}{#if data.cityLedgerAccount.billToCompany}
								· {data.cityLedgerAccount.billToCompany}{/if}</span>. This room's bill is added to it.
					</p>
				{:else}
					<div>
						<Label for="cl-name">Bill to</Label>
						<Input
							id="cl-name"
							name="billToName"
							required
							maxlength={160}
							value={data.defaultBillTo}
							class="mt-1"
						/>
					</div>
					<div class="grid grid-cols-2 gap-3">
						<div>
							<Label for="cl-company">Company (optional)</Label>
							<Input id="cl-company" name="billToCompany" maxlength={160} class="mt-1" />
						</div>
						<div>
							<Label for="cl-ref">Reference (optional)</Label>
							<Input id="cl-ref" name="referenceNo" maxlength={120} class="mt-1" />
						</div>
					</div>
				{/if}
				<div>
					<Label for="cl-amount">Amount to move (₱) — up to what this room owes</Label>
					<Input
						id="cl-amount"
						name="amount"
						type="number"
						min="0.01"
						step="0.01"
						max={(ledgerLine.balanceCentavos / 100).toFixed(2)}
						bind:value={ledgerAmount}
						class="mt-1"
					/>
				</div>
				<div>
					<Label for="cl-notes">Notes (optional)</Label>
					<Input id="cl-notes" name="notes" maxlength={500} class="mt-1" />
				</div>
				<div class="flex justify-end gap-2 pt-1">
					<Button type="button" variant="outline" onclick={() => (ledgerLine = null)}>Cancel</Button>
					<Button type="submit" disabled={ledgerSubmitting}>Move to city ledger</Button>
				</div>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root
	open={refundLine != null}
	onOpenChange={(o) => {
		if (!o) refundLine = null;
	}}
>
	<Dialog.Content>
		{#if refundLine}
			<Dialog.Header>
				<Dialog.Title>Refund credit — {refundLine.title}</Dialog.Title>
				<Dialog.Description>
					This room is overpaid by {peso(refundLine.balanceCentavos)}. Record the refund handed back.
				</Dialog.Description>
			</Dialog.Header>
			<PaymentFields
				action="?/refundPayment"
				kind={refundLine.kind}
				id={refundLine.id}
				balanceCentavos={-refundLine.balanceCentavos}
				cashier={{
					requireOpenShiftForCashPayment: data.cashier.requireOpenShiftForCashPayment,
					hasBankAccount: data.cashier.hasBankAccount,
					openShift: data.cashier.openShift
				}}
				mode="refund"
				onDone={() => (refundLine = null)}
			/>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root
	open={splitPayment != null}
	onOpenChange={(o) => {
		if (!o) splitPayment = null;
	}}
>
	<Dialog.Content>
		{#if splitPayment}
			<Dialog.Header>
				<Dialog.Title>Re-split this payment</Dialog.Title>
				<Dialog.Description>
					{methodLabel[splitPayment.method] ?? splitPayment.method}
					{peso(splitPayment.amountCentavos)} — choose which room each part pays. The money and its
					receipt do not change.
				</Dialog.Description>
			</Dialog.Header>
			<form
				method="POST"
				action="?/reallocatePayment"
				use:enhance={() => {
					splitSubmitting = true;
					return async ({ update, result }) => {
						await update();
						splitSubmitting = false;
						if (result.type === 'success') splitPayment = null;
					};
				}}
				class="space-y-3"
			>
				<input type="hidden" name="paymentId" value={splitPayment.id} />
				<input type="hidden" name="allocationsJson" value={splitJson} />
				<div class="divide-y divide-border rounded-md border border-border">
					{#each data.payableLines as l (l.id)}
						<div class="flex items-center justify-between gap-3 px-2.5 py-1.5 text-sm">
							<div class="min-w-0">
								<div class="truncate text-ink">{l.title}</div>
								<div class="text-xs text-ink-muted">
									{l.balanceCentavos > 0 ? `owes ${peso(l.balanceCentavos)}` : 'settled'}
								</div>
							</div>
							<Input
								type="number"
								min="0"
								step="0.01"
								bind:value={splitRows[l.id]}
								class="h-8 w-28 text-right"
							/>
						</div>
					{/each}
				</div>
				<p
					class="text-xs {splitTotal === splitPayment.amountCentavos
						? 'text-ink-muted'
						: 'text-danger'}"
				>
					Assigned {peso(splitTotal)} of {peso(splitPayment.amountCentavos)}
				</p>
				<div class="flex justify-end gap-2">
					<Button type="button" variant="outline" onclick={() => (splitPayment = null)}>Cancel</Button>
					<Button
						type="submit"
						disabled={splitSubmitting || splitTotal !== splitPayment.amountCentavos}
						>Save split</Button
					>
				</div>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
