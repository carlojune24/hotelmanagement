<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import BedIcon from '@lucide/svelte/icons/bed';
	import PartyPopperIcon from '@lucide/svelte/icons/party-popper';
	import CancelBookingDialog from '$lib/components/staff/cancel-booking-dialog.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let cancelOpen = $state(data.autoOpen === 'cancel');
	let confirmingNoShow = $state(data.autoOpen === 'no-show');
	let decliningRequest = $state(false);
	let replying = $state(false);
	let manualConfirmOpen = $state(false);
	let reinstateOpen = $state(false);
	let manualConfirmReason = $state('');
	let reinstateReason = $state('');
	let overrideSubmitting = $state(false);

	const base = $derived(`/${page.params.hotel}`);
	const peso = (centavos: number) => `₱${(centavos / 100).toFixed(2)}`;
	const statusLabel = (s: string) => s.replace(/_/g, ' ');
	const fmtDateTime = (v: string | Date) =>
		new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	const currentStatus = $derived(data.kind === 'room' ? data.detail.booking.status : data.detail.hallBooking.status);
	const MANUAL_CONFIRM_METHODS = [
		{ v: 'cash', label: 'Cash' },
		{ v: 'gcash', label: 'GCash' },
		{ v: 'maya', label: 'Maya' },
		{ v: 'bank_transfer', label: 'Bank transfer' },
		{ v: 'cheque', label: 'Cheque' }
	] as const;
	let manualConfirmMethod = $state<(typeof MANUAL_CONFIRM_METHODS)[number]['v']>('bank_transfer');

	let resending = $state(false);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});

	function statusVariantClass(status: string): string {
		if (['confirmed', 'checked_in', 'checked_out', 'completed'].includes(status)) {
			return 'border-transparent bg-ok/15 text-ok';
		}
		if (['cancelled', 'no_show'].includes(status)) {
			return 'border-transparent bg-danger/15 text-danger';
		}
		return 'border-border bg-surface-2 text-ink-muted';
	}

	function paymentStatusClass(status: string): string {
		if (status === 'paid') return 'border-transparent bg-ok/15 text-ok';
		if (status === 'failed') return 'border-transparent bg-danger/15 text-danger';
		return 'border-border bg-surface-2 text-ink-muted';
	}

	function emailStatusClass(status: string): string {
		if (status === 'sent') return 'border-transparent bg-ok/15 text-ok';
		if (status === 'failed') return 'border-transparent bg-danger/15 text-danger';
		return 'border-border bg-surface-2 text-ink-muted';
	}
</script>

<div class="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div class="flex items-center gap-2">
			{#if data.kind === 'room'}
				<BedIcon class="size-5 text-ink-muted" />
			{:else}
				<PartyPopperIcon class="size-5 text-ink-muted" />
			{/if}
			<div>
				<h1 class="text-xl font-semibold tracking-tight text-ink">
					{data.kind === 'room' ? data.detail.roomType.name : data.detail.hall.name}
				</h1>
				<p class="text-sm text-ink-muted">
					{data.kind === 'room' ? data.detail.ratePlan.name : data.detail.hallBooking.eventType}
				</p>
			</div>
		</div>
		<Button variant="outline" href="{base}/reservations">← Reservations</Button>
	</div>

	<div class="flex items-center gap-2">
		<Badge
			variant="outline"
			class={statusVariantClass(
				data.kind === 'room' ? data.detail.booking.status : data.detail.hallBooking.status
			)}
		>
			{statusLabel(data.kind === 'room' ? data.detail.booking.status : data.detail.hallBooking.status)}
		</Badge>
		<span class="text-xs text-ink-muted">
			Order {statusLabel(data.detail.order.status)}
		</span>
	</div>

	<!-- Guest -->
	<div class="mt-6 rounded-xl border border-border p-4">
		<h2 class="mb-2 text-sm font-semibold text-ink">Guest</h2>
		<div class="text-sm text-ink">{data.detail.guest.fullName}</div>
		<div class="text-sm text-ink-muted">{data.detail.guest.email}</div>
		{#if data.detail.guest.phone}
			<div class="text-sm text-ink-muted">{data.detail.guest.phone}</div>
		{/if}
		{#if data.detail.guest.specialRequests}
			<p class="mt-2 text-xs text-ink-muted">Special requests: {data.detail.guest.specialRequests}</p>
		{/if}
	</div>

	<!-- Stay / Event details -->
	<div class="mt-4 rounded-xl border border-border p-4">
		{#if data.kind === 'room'}
			<h2 class="mb-2 text-sm font-semibold text-ink">Stay</h2>
			<div class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
				<div>
					<div class="text-xs text-ink-muted">Check-in</div>
					<div class="text-ink">{data.detail.booking.checkIn}</div>
				</div>
				<div>
					<div class="text-xs text-ink-muted">Check-out</div>
					<div class="text-ink">{data.detail.booking.checkOut}</div>
				</div>
				<div>
					<div class="text-xs text-ink-muted">Occupancy</div>
					<div class="text-ink">{data.detail.booking.occupancy} guests</div>
				</div>
				<div>
					<div class="text-xs text-ink-muted">Rooms</div>
					<div class="text-ink">{data.detail.bookingRoom.quantity}</div>
				</div>
			</div>

			{#if data.detail.assignedRooms.length > 0}
				<div class="mt-4 border-t border-border pt-4">
					<div class="text-xs text-ink-muted">Assigned</div>
					<div class="text-sm text-ink">
						{data.detail.assignedRooms.map((r) => `Room ${r.roomNumber}`).join(', ')}
					</div>
				</div>
			{:else if data.detail.booking.status === 'confirmed'}
				<form
					method="POST"
					action="?/checkIn"
					use:enhance
					class="mt-4 border-t border-border pt-4"
				>
					<Label>Assign room{data.detail.bookingRoom.quantity > 1 ? 's' : ''} &amp; check in</Label>
					{#if data.eligibleRooms.length === 0}
						<p class="mt-2 text-sm text-ink-muted">
							No rooms of this type are currently free for these dates.
						</p>
					{:else}
						<div class="mt-2 flex flex-wrap items-center gap-2">
							{#each Array(data.detail.bookingRoom.quantity) as _, i (i)}
								<select
									name="roomId"
									required
									class="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm"
								>
									<option value="" disabled selected>Room {i + 1}</option>
									{#each data.eligibleRooms as r (r.id)}
										<option value={r.id}>{r.roomNumber}</option>
									{/each}
								</select>
							{/each}
							<Button type="submit" size="sm">Check in</Button>
						</div>
					{/if}
				</form>
			{/if}
		{:else}
			<h2 class="mb-2 text-sm font-semibold text-ink">Event</h2>
			<div class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
				<div>
					<div class="text-xs text-ink-muted">Event date</div>
					<div class="text-ink">{data.detail.hallBooking.eventDate}</div>
				</div>
				<div>
					<div class="text-xs text-ink-muted">Time</div>
					<div class="text-ink">
						{data.detail.hallBooking.startTime}–{data.detail.hallBooking.endTime}
					</div>
				</div>
				<div>
					<div class="text-xs text-ink-muted">Guests</div>
					<div class="text-ink">{data.detail.hallBooking.guestCount}</div>
				</div>
			</div>
		{/if}
	</div>

	<!-- Bill -->
	<div class="mt-4 rounded-xl border border-border p-4">
		<h2 class="mb-2 text-sm font-semibold text-ink">Bill</h2>
		{#if data.kind === 'room'}
			<Table.Root>
				<Table.Body>
					<Table.Row>
						<Table.Cell class="text-ink-muted">Subtotal</Table.Cell>
						<Table.Cell class="text-right text-ink">{peso(data.detail.booking.subtotalCentavos)}</Table.Cell>
					</Table.Row>
					{#if data.detail.booking.feesCentavos > 0}
						<Table.Row>
							<Table.Cell class="text-ink-muted">Fees</Table.Cell>
							<Table.Cell class="text-right text-ink">{peso(data.detail.booking.feesCentavos)}</Table.Cell>
						</Table.Row>
					{/if}
					<Table.Row>
						<Table.Cell class="text-ink-muted">VAT</Table.Cell>
						<Table.Cell class="text-right text-ink">{peso(data.detail.booking.vatCentavos)}</Table.Cell>
					</Table.Row>
					<Table.Row>
						<Table.Cell class="font-semibold text-ink">Total</Table.Cell>
						<Table.Cell class="text-right font-semibold text-ink"
							>{peso(data.detail.booking.totalCentavos)}</Table.Cell
						>
					</Table.Row>
				</Table.Body>
			</Table.Root>
		{:else}
			<Table.Root>
				<Table.Body>
					<Table.Row>
						<Table.Cell class="text-ink-muted">Subtotal</Table.Cell>
						<Table.Cell class="text-right text-ink"
							>{peso(data.detail.hallBooking.subtotalCentavos)}</Table.Cell
						>
					</Table.Row>
					{#if data.detail.hallBooking.feesCentavos > 0}
						<Table.Row>
							<Table.Cell class="text-ink-muted">Fees</Table.Cell>
							<Table.Cell class="text-right text-ink"
								>{peso(data.detail.hallBooking.feesCentavos)}</Table.Cell
							>
						</Table.Row>
					{/if}
					<Table.Row>
						<Table.Cell class="text-ink-muted">VAT</Table.Cell>
						<Table.Cell class="text-right text-ink">{peso(data.detail.hallBooking.vatCentavos)}</Table.Cell>
					</Table.Row>
					<Table.Row>
						<Table.Cell class="font-semibold text-ink">Total</Table.Cell>
						<Table.Cell class="text-right font-semibold text-ink"
							>{peso(data.detail.hallBooking.totalCentavos)}</Table.Cell
						>
					</Table.Row>
				</Table.Body>
			</Table.Root>
		{/if}
	</div>

	<!-- Payments -->
	<div class="mt-4 rounded-xl border border-border p-4">
		<h2 class="mb-2 text-sm font-semibold text-ink">Payments</h2>
		{#if data.detail.payments.length === 0}
			<p class="text-sm text-ink-muted">No payment recorded yet — this order hasn't been paid.</p>
		{:else}
			<div class="space-y-2">
				{#each data.detail.payments as p (p.id)}
					<div class="flex items-center justify-between text-sm">
						<div>
							<Badge variant="outline" class={paymentStatusClass(p.status)}>{p.status}</Badge>
							<span class="ml-2 text-ink-muted">{p.provider}</span>
							{#if p.paidAt}
								<span class="ml-2 text-xs text-ink-muted">{p.paidAt}</span>
							{/if}
						</div>
						<span class="text-ink">{peso(p.amountCentavos)}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Confirmation email -->
	<div class="mt-4 rounded-xl border border-border p-4">
		<div class="mb-2 flex items-center justify-between gap-3">
			<h2 class="text-sm font-semibold text-ink">Confirmation email</h2>
			{#if data.detail.order.status === 'confirmed'}
				<form
					method="POST"
					action="?/resendConfirmation"
					use:enhance={() => {
						resending = true;
						return async ({ update }) => {
							await update();
							resending = false;
						};
					}}
				>
					<Button type="submit" variant="outline" size="sm" disabled={resending}>
						{resending
							? 'Sending…'
							: data.detail.confirmationEmails.length > 0
								? 'Resend'
								: 'Send now'}
					</Button>
				</form>
			{/if}
		</div>

		{#if data.detail.confirmationEmails.length === 0}
			<p class="text-sm text-ink-muted">
				Not sent yet — it goes out automatically once payment is confirmed.
			</p>
		{:else}
			<div class="space-y-2.5">
				{#each data.detail.confirmationEmails as m (m.id)}
					<div class="flex items-start justify-between gap-3 text-sm">
						<div class="min-w-0">
							<Badge variant="outline" class={emailStatusClass(m.status)}>{m.status}</Badge>
							<span class="ml-2 break-all text-ink">{m.toAddress}</span>
							{#if m.status === 'failed' && m.error}
								<div class="mt-0.5 text-xs text-danger">{m.error}</div>
							{/if}
						</div>
						<span class="shrink-0 text-xs text-ink-muted">{fmtDateTime(m.createdAt)}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Cancel / no-show -->
	{#if data.cancelQuote || data.canMarkNoShow}
		<div class="mt-4 rounded-xl border border-border p-4">
			<h2 class="mb-1 text-sm font-semibold text-ink">
				Cancel {data.kind === 'room' ? 'booking' : 'event'}
			</h2>
			<p class="mb-3 text-xs text-ink-muted">
				{#if data.cancelQuote}
					Releases the {data.kind === 'room' ? 'room' : 'hall'} hold and, for a paid booking,
					records the refund after any cancellation fee.
				{:else}
					This arrival is past its check-in date.
				{/if}
			</p>

			{#if data.openRequest}
				<div class="mb-3 rounded-lg border border-border bg-surface-2 p-3">
					<p class="text-xs font-semibold text-ink">Guest requested cancellation</p>
					<p class="mt-1 text-sm text-ink">{data.openRequest.body}</p>
					{#if decliningRequest}
						<form
							method="POST"
							action="?/declineRequest"
							use:enhance
							class="mt-3 space-y-2"
						>
							<input type="hidden" name="requestId" value={data.openRequest.id} />
							<textarea
								name="note"
								rows="2"
								required
								maxlength={2000}
								placeholder="Explain why you're declining this request…"
								class="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm"
							></textarea>
							<div class="flex items-center gap-2">
								<Button type="submit" variant="destructive" size="sm">Confirm decline</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onclick={() => (decliningRequest = false)}
								>
									Back
								</Button>
							</div>
						</form>
					{:else}
						<div class="mt-2 flex gap-2">
							<Button size="sm" onclick={() => (cancelOpen = true)}>Cancel this booking</Button>
							<Button variant="outline" size="sm" onclick={() => (decliningRequest = true)}>
								Decline request
							</Button>
						</div>
					{/if}
				</div>
			{/if}

			<div class="flex flex-wrap gap-2">
				{#if data.cancelQuote}
					<Button variant="outline" onclick={() => (cancelOpen = true)}>
						Cancel {data.kind === 'room' ? 'booking' : 'event'}
					</Button>
				{/if}
				{#if data.canMarkNoShow}
					{#if confirmingNoShow}
						<form method="POST" action="?/markNoShow" use:enhance class="flex items-center gap-2">
							<Button type="submit" variant="destructive">Confirm no-show</Button>
							<Button type="button" variant="ghost" onclick={() => (confirmingNoShow = false)}>
								Cancel
							</Button>
						</form>
					{:else}
						<Button variant="outline" onclick={() => (confirmingNoShow = true)}>Mark no-show</Button>
					{/if}
				{/if}
			</div>
			{#if data.canMarkNoShow && confirmingNoShow}
				<p class="mt-2 text-xs text-ink-muted">
					The room is released. Any payment is kept — issue a refund separately if your policy
					requires it.
				</p>
			{/if}
		</div>
	{/if}

	<!-- Status override (hotel_admin only) -->
	{#if data.canAdmin && (currentStatus === 'pending_payment' || currentStatus === 'cancelled' || currentStatus === 'no_show')}
		<div class="mt-4 rounded-xl border border-border p-4">
			<h2 class="mb-1 text-sm font-semibold text-ink">Override status</h2>
			<p class="mb-3 text-xs text-ink-muted">
				Admin-only escape hatch for a stuck or wrongly-set status — not a substitute for the
				normal check-in/check-out/cancel flows.
			</p>
			<div class="flex flex-wrap gap-2">
				{#if currentStatus === 'pending_payment'}
					<Button variant="outline" onclick={() => (manualConfirmOpen = true)}>
						Manually confirm this {data.kind === 'room' ? 'booking' : 'event'}
					</Button>
				{/if}
				{#if currentStatus === 'cancelled' || currentStatus === 'no_show'}
					<Button variant="outline" onclick={() => (reinstateOpen = true)}>
						Reinstate this {data.kind === 'room' ? 'booking' : 'event'}
					</Button>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Guest messages -->
	<div class="mt-4 rounded-xl border border-border p-4">
		<h2 class="mb-2 text-sm font-semibold text-ink">Messages</h2>
		{#if data.thread.length === 0}
			<p class="text-sm text-ink-muted">No messages from this guest yet.</p>
		{:else}
			<div class="space-y-3">
				{#each data.thread as m (m.id)}
					<div class="text-sm">
						<div class="flex items-baseline justify-between gap-3">
							<span class="font-medium text-ink">
								{m.direction === 'guest' ? 'Guest' : (m.staffName ?? 'Staff')}
								{#if m.kind === 'cancellation_request'}
									<Badge
										variant="outline"
										class="ml-1.5 {m.status === 'declined'
											? 'border-transparent bg-danger/15 text-danger'
											: m.status === 'actioned'
												? 'border-transparent bg-ok/15 text-ok'
												: 'border-border bg-surface-2 text-ink-muted'}"
									>
										cancellation request{m.status ? ` · ${m.status}` : ''}
									</Badge>
								{/if}
							</span>
							<span class="shrink-0 text-xs text-ink-muted">{fmtDateTime(m.createdAt)}</span>
						</div>
						<p class="mt-0.5 whitespace-pre-wrap text-ink">{m.body}</p>
					</div>
				{/each}
			</div>
		{/if}

		<form
			method="POST"
			action="?/replyMessage"
			use:enhance={() => {
				replying = true;
				return async ({ update }) => {
					await update();
					replying = false;
				};
			}}
			class="mt-4 space-y-2 border-t border-border pt-4"
		>
			<textarea
				name="body"
				rows="2"
				required
				maxlength={2000}
				placeholder="Reply to the guest…"
				class="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm"
			></textarea>
			<Button type="submit" size="sm" disabled={replying}>{replying ? 'Sending…' : 'Reply'}</Button>
		</form>
	</div>

	<!-- Status history -->
	<div class="mt-4 rounded-xl border border-border p-4">
		<h2 class="mb-2 text-sm font-semibold text-ink">Status history</h2>
		{#if data.detail.history.length === 0}
			<p class="text-sm text-ink-muted">No status changes recorded yet.</p>
		{:else}
			<div class="space-y-2">
				{#each data.detail.history as h (h.id)}
					<div class="text-sm">
						<span class="text-ink-muted">{h.fromStatus ? statusLabel(h.fromStatus) : 'created'} →</span>
						<span class="text-ink">{statusLabel(h.toStatus)}</span>
						{#if h.note}<span class="text-ink-muted"> — {h.note}</span>{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

{#if data.cancelQuote}
	<CancelBookingDialog bind:open={cancelOpen} quote={data.cancelQuote} action="?/cancel" />
{/if}

<Dialog.Root bind:open={manualConfirmOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Manually confirm this {data.kind === 'room' ? 'booking' : 'event'}</Dialog.Title>
			<Dialog.Description>
				For a guest who paid outside PayMongo (bank transfer, cash on file, a missed webhook).
				Records a real payment for the full amount and confirms the order.
			</Dialog.Description>
		</Dialog.Header>
		<form
			method="POST"
			action="?/manualConfirm"
			use:enhance={() => {
				overrideSubmitting = true;
				return async ({ update, result }) => {
					await update({ reset: false });
					overrideSubmitting = false;
					if (result.type === 'success') {
						manualConfirmOpen = false;
						manualConfirmReason = '';
					}
				};
			}}
			class="space-y-4"
		>
			<div>
				<Label for="manual-confirm-method" class="text-xs">Method</Label>
				<select
					id="manual-confirm-method"
					name="method"
					bind:value={manualConfirmMethod}
					class="mt-1 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
				>
					{#each MANUAL_CONFIRM_METHODS as m (m.v)}
						<option value={m.v}>{m.label}</option>
					{/each}
				</select>
			</div>
			<div>
				<Label for="manual-confirm-ref" class="text-xs">Reference / notes</Label>
				<Input id="manual-confirm-ref" name="referenceNo" maxlength={120} class="mt-1" />
			</div>
			<div>
				<Label for="manual-confirm-reason" class="text-xs"
					>Reason <span class="text-danger">*</span></Label
				>
				<textarea
					id="manual-confirm-reason"
					name="reason"
					bind:value={manualConfirmReason}
					required
					rows="2"
					placeholder="How was this payment verified?"
					class="mt-1 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
				></textarea>
			</div>
			<div class="flex justify-end gap-2 pt-1">
				<Button
					type="button"
					variant="ghost"
					onclick={() => (manualConfirmOpen = false)}
					disabled={overrideSubmitting}
				>
					Cancel
				</Button>
				<Button type="submit" disabled={overrideSubmitting || manualConfirmReason.trim().length === 0}>
					{overrideSubmitting ? 'Confirming…' : 'Confirm'}
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={reinstateOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Reinstate this {data.kind === 'room' ? 'booking' : 'event'}</Dialog.Title>
			<Dialog.Description>
				Re-checks availability first; if this booking was paid and refunded, the refund is
				reversed.
			</Dialog.Description>
		</Dialog.Header>
		<form
			method="POST"
			action="?/reinstate"
			use:enhance={() => {
				overrideSubmitting = true;
				return async ({ update, result }) => {
					await update({ reset: false });
					overrideSubmitting = false;
					if (result.type === 'success') {
						reinstateOpen = false;
						reinstateReason = '';
					}
				};
			}}
			class="space-y-4"
		>
			<div>
				<Label for="reinstate-reason" class="text-xs">Reason <span class="text-danger">*</span></Label>
				<textarea
					id="reinstate-reason"
					name="reason"
					bind:value={reinstateReason}
					required
					rows="2"
					placeholder="Why is this being reinstated?"
					class="mt-1 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
				></textarea>
			</div>
			<div class="flex justify-end gap-2 pt-1">
				<Button
					type="button"
					variant="ghost"
					onclick={() => (reinstateOpen = false)}
					disabled={overrideSubmitting}
				>
					Never mind
				</Button>
				<Button type="submit" disabled={overrideSubmitting || reinstateReason.trim().length === 0}>
					{overrideSubmitting ? 'Reinstating…' : 'Reinstate'}
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>
