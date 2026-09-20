<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import PaymentFields from '$lib/components/staff/payment-fields.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}`);
	const staffBase = $derived(`${base}/management`);
	const peso = (c: number) => `₱${(Math.abs(c) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	let payOpen = $state(false);
	let refundOpen = $state(false);

	$effect(() => {
		if (form && 'ok' in form && form.ok) toast.success(form.ok);
		else if (form && 'error' in form && form.error) toast.error(form.error);
	});

	const balance = $derived(data.ledger.balanceCentavos);
	const settled = $derived(balance === 0);

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
		iso
			? new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
			: '—';
	const reservationHref = (l: { kind: 'room' | 'hall'; id: string }) =>
		`${staffBase}/reservations/${l.kind}/${l.id}`;
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
				href="{base}/print/invoice/for-order/{data.order.id}"
				target="_blank">Print all invoices</Button
			>
			{#if page.url.searchParams.get('roomId')}
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
			<section>
				<h2 class="mb-2 text-sm font-semibold text-ink">Rooms &amp; events</h2>
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Booking</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head class="text-right">Charges</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.lines as l (l.id)}
							<Table.Row>
								<Table.Cell>
									<a
										href={reservationHref(l)}
										class="font-medium text-ink underline-offset-2 hover:underline"
									>
										{l.title}
									</a>
									<div class="text-xs text-ink-muted">{l.detail}</div>
								</Table.Cell>
								<Table.Cell>
									<Badge variant="outline" class={statusClass(l.status)}>
										{statusLabel(l.status)}
									</Badge>
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{peso(l.chargesCentavos)}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
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
										{when(p.paidAt)}
										{#if p.referenceNo}· Ref {p.referenceNo}{/if}
										{#if p.tenderedCentavos != null && p.method === 'cash'}
											· tendered {peso(p.tenderedCentavos)}, change {peso(p.changeCentavos ?? 0)}
										{/if}
									</div>
									{#if p.voidedAt}
										<div class="mt-0.5 text-xs text-danger">
											Voided{#if p.voidReason} — {p.voidReason}{/if}
										</div>
									{/if}
									<div class="mt-1.5 flex items-center gap-1.5">
										{#if !p.voidedAt && p.amountCentavos > 0}
											<Button
												variant="outline"
												size="xs"
												href="{base}/print/receipt/{p.id}"
												target="_blank">Receipt</Button
											>
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
		</div>

		<aside class="space-y-4 lg:sticky lg:top-6">
			<div class="rounded-lg border border-border p-4">
				<dl class="space-y-1.5 text-sm">
					<div class="flex justify-between">
						<dt class="text-ink-muted">Charges</dt>
						<dd class="tabular-nums text-ink">{peso(data.ledger.chargesTotalCentavos)}</dd>
					</div>
					<div class="flex justify-between">
						<dt class="text-ink-muted">Paid</dt>
						<dd class="tabular-nums text-ink">−{peso(data.ledger.paidTotalCentavos)}</dd>
					</div>
				</dl>
				<div class="mt-3 flex items-baseline justify-between border-t border-border pt-3">
					<span class="text-sm font-semibold text-ink">
						{balance < 0 ? 'Credit' : settled ? 'Balance' : 'Balance due'}
					</span>
					<span
						class="text-2xl font-semibold tabular-nums {balance > 0
							? 'text-danger'
							: 'text-ink'}"
					>
						{settled ? 'Settled' : peso(balance)}
					</span>
				</div>
				{#if data.order.amountDueNowCentavos != null && balance > 0}
					<p class="mt-2 text-xs text-ink-muted">
						The guest paid the downpayment online; the rest is collected here.
					</p>
				{/if}
			</div>

			{#if data.canCollect && data.carrier}
				<div class="flex flex-col gap-2">
					{#if balance > 0}
						<Button onclick={() => (payOpen = true)}>Take payment ({peso(balance)} due)</Button>
					{:else if balance < 0}
						<Button variant="outline" onclick={() => (refundOpen = true)}>
							Refund credit ({peso(balance)})
						</Button>
					{/if}
				</div>
			{/if}
			{#if balance > 0}
				<p class="text-xs text-ink-muted">
					Every room of a multi-room booking is settled together: a room can check out once
					this balance is paid, or a hotel admin moves it to the city ledger at check-out.
				</p>
			{/if}
		</aside>
	</div>
</div>

{#if data.carrier}
	<Dialog.Root bind:open={payOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>Take payment</Dialog.Title>
				<Dialog.Description>
					One payment for the whole booking — {peso(balance)} is due across every room.
				</Dialog.Description>
			</Dialog.Header>
			<PaymentFields
				action="?/recordPayment"
				kind={data.carrier.kind}
				id={data.carrier.id}
				balanceCentavos={balance}
				cashier={{
					requireOpenShiftForCashPayment: data.cashier.requireOpenShiftForCashPayment,
					hasBankAccount: data.cashier.hasBankAccount,
					openShift: data.cashier.openShift
				}}
				onDone={() => (payOpen = false)}
			/>
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root bind:open={refundOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>Refund credit</Dialog.Title>
				<Dialog.Description>
					The booking is overpaid by {peso(balance)}. Record the refund handed back to the guest.
				</Dialog.Description>
			</Dialog.Header>
			<PaymentFields
				action="?/refundPayment"
				kind={data.carrier.kind}
				id={data.carrier.id}
				balanceCentavos={-balance}
				cashier={{
					requireOpenShiftForCashPayment: data.cashier.requireOpenShiftForCashPayment,
					hasBankAccount: data.cashier.hasBankAccount,
					openShift: data.cashier.openShift
				}}
				mode="refund"
				onDone={() => (refundOpen = false)}
			/>
		</Dialog.Content>
	</Dialog.Root>
{/if}
