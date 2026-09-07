<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import BedIcon from '@lucide/svelte/icons/bed';
	import PartyPopperIcon from '@lucide/svelte/icons/party-popper';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}`);
	const peso = (centavos: number) => `₱${(centavos / 100).toFixed(2)}`;
	const statusLabel = (s: string) => s.replace(/_/g, ' ');

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
