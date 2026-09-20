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
	import IdCameraCapture from '$lib/components/staff/id-camera-capture.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let depositMethod = $state('cash');
	let depositReferenceNo = $state('');
	// Cash has no real external reference (no card slip / e-wallet transaction id), so
	// auto-fill an internal one staff can still edit or clear. Switching to a method that
	// *does* have a real reference clears the auto-fill instead of leaving a fake one.
	$effect(() => {
		depositReferenceNo =
			depositMethod === 'cash' ? `DEP-${crypto.randomUUID().slice(0, 8).toUpperCase()}` : '';
	});

	let cancelOpen = $state(data.autoOpen === 'cancel');
	let confirmingNoShow = $state(data.autoOpen === 'no-show');
	let decliningRequest = $state(false);
	let replying = $state(false);
	let manualConfirmOpen = $state(false);
	let reinstateOpen = $state(false);
	let manualConfirmReason = $state('');
	let reinstateReason = $state('');
	let overrideSubmitting = $state(false);

	let modifyOpen = $state(false);
	let modifySubmitting = $state(false);
	let modifyCheckIn = $state(data.kind === 'room' ? data.detail.booking.checkIn : '');
	let modifyCheckOut = $state(data.kind === 'room' ? data.detail.booking.checkOut : '');
	// Room type/rate plan/occupancy changes are confirmed-only (see booking-modify.ts) —
	// these stay at the booking's current values (inert) once checked in.
	let modifyRoomTypeId = $state(data.kind === 'room' ? data.detail.bookingRoom.roomTypeId : '');
	let modifyRatePlanId = $state(data.kind === 'room' ? data.detail.bookingRoom.ratePlanId : '');
	let modifyOccupancy = $state(data.kind === 'room' ? data.detail.booking.occupancy : 1);
	// Allowed both before and after check-in — a physical add-on, not a room
	// re-assignment — unlike room type/rate plan/occupancy above.
	let modifyExtraBeds = $state(data.kind === 'room' ? data.detail.bookingRoom.extraBeds : 0);
	let modifyReason = $state('');
	let modifyQuoting = $state(false);
	let modifyQuoteError = $state<string | null>(null);
	let modifyQuote = $state<{
		segments: {
			edge: 'front' | 'back';
			direction: 'added' | 'removed';
			nights: string[];
			amountCentavos: number;
		}[];
		roomChange: {
			newRoomTypeId: string;
			newRatePlanId: string;
			oldTotalCentavos: number;
			newTotalCentavos: number;
		} | null;
		deltaCentavos: number;
		blockingReason: string | null;
		oldExtraBeds: number;
		newExtraBeds: number | null;
		extraBedNote: string | null;
	} | null>(null);
	let modifyQuoteTimer: ReturnType<typeof setTimeout> | undefined;

	// The rate plans offered depend on whichever room type is currently selected.
	const modifyRatePlanOptions = $derived(
		data.kind === 'room'
			? (data.modifyRoomTypeOptions.find((t) => t.id === modifyRoomTypeId)?.ratePlans ?? [])
			: []
	);
	// The server refuses to combine a room type/rate plan change with an extra-bed change
	// in the same submission (the delta math can't cleanly represent both at once) — mirror
	// that here so the field visibly disables instead of silently failing on submit.
	const modifyRoomOrRateChanged = $derived(
		data.kind === 'room' &&
			(modifyRoomTypeId !== data.detail.bookingRoom.roomTypeId ||
				modifyRatePlanId !== data.detail.bookingRoom.ratePlanId)
	);
	const modifyMaxExtraBeds = $derived(
		data.kind === 'room' && data.detail.roomType.extraBedAllowed
			? (data.detail.roomType.maxExtraBeds ?? 0) * data.detail.bookingRoom.quantity
			: 0
	);

	function openModifyDialog() {
		if (data.kind !== 'room') return;
		modifyCheckIn = data.detail.booking.checkIn;
		modifyCheckOut = data.detail.booking.checkOut;
		modifyRoomTypeId = data.detail.bookingRoom.roomTypeId;
		modifyRatePlanId = data.detail.bookingRoom.ratePlanId;
		modifyOccupancy = data.detail.booking.occupancy;
		modifyExtraBeds = data.detail.bookingRoom.extraBeds;
		modifyReason = '';
		modifyQuote = null;
		modifyQuoteError = null;
		modifyOpen = true;
	}

	function onModifyRoomTypeChange() {
		// Switching room type invalidates whatever rate plan was picked — a rate plan
		// only ever belongs to one room type.
		modifyRatePlanId = modifyRatePlanOptions[0]?.id ?? '';
		requestModifyQuote();
	}

	function requestModifyQuote() {
		clearTimeout(modifyQuoteTimer);
		modifyQuote = null;
		modifyQuoteError = null;
		if (!modifyCheckIn || !modifyCheckOut) return;
		modifyQuoteTimer = setTimeout(async () => {
			modifyQuoting = true;
			try {
				const res = await fetch(`${staffBase}/reservations/room/${page.params.id}/api/modify-quote`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						checkIn: modifyCheckIn,
						checkOut: modifyCheckOut,
						roomTypeId: modifyRoomTypeId || undefined,
						ratePlanId: modifyRatePlanId || undefined,
						occupancy: modifyOccupancy,
						extraBeds: modifyRoomOrRateChanged ? undefined : modifyExtraBeds
					})
				});
				if (!res.ok) {
					modifyQuoteError = (await res.text()) || 'Could not quote this change.';
					return;
				}
				modifyQuote = await res.json();
			} catch {
				modifyQuoteError = 'Could not reach the server.';
			} finally {
				modifyQuoting = false;
			}
		}, 400);
	}

	function modifySegmentLabel(s: {
		edge: 'front' | 'back';
		direction: 'added' | 'removed';
		nights: string[];
	}) {
		const n = `${s.nights.length} night${s.nights.length === 1 ? '' : 's'}`;
		const desc =
			s.edge === 'front'
				? s.direction === 'added'
					? 'earlier arrival'
					: 'later arrival'
				: s.direction === 'added'
					? 'later departure'
					: 'earlier departure';
		return `${s.direction === 'added' ? '+' : '-'}${n} (${desc})`;
	}

	const base = $derived(`/${page.params.hotel}`);
	/** As opposed to `base`, still used bare for the print routes below, which don't live
	    under `/management`. */
	const staffBase = $derived(`${base}/management`);
	const peso = (centavos: number) => `₱${(centavos / 100).toFixed(2)}`;
	const statusLabel = (s: string) => s.replace(/_/g, ' ');
	const fmtDateTime = (v: string | Date) =>
		new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	const currentStatus = $derived(
		data.kind === 'room' ? data.detail.booking.status : data.detail.hallBooking.status
	);
	const MANUAL_CONFIRM_METHODS = [
		{ v: 'cash', label: 'Cash' },
		{ v: 'gcash', label: 'GCash' },
		{ v: 'maya', label: 'Maya' },
		{ v: 'bank_transfer', label: 'Bank transfer' },
		{ v: 'cheque', label: 'Cheque' }
	] as const;
	let manualConfirmMethod = $state<(typeof MANUAL_CONFIRM_METHODS)[number]['v']>('bank_transfer');

	let resending = $state(false);

	// Splits the Bill's opaque "Fees" total into what a staff member/guest can actually
	// read — the extra-bed portion (derivable from `bookingRoom.extraBeds` × the rate
	// plan's own fee) plus whatever's left over (hotel-wide taxes/fees, if configured),
	// instead of one unlabeled number ("what fees?").
	const extraBedFeeTotal = $derived(
		data.kind === 'room' && data.detail.bookingRoom.extraBeds > 0
			? data.detail.bookingRoom.extraBeds * (data.detail.ratePlan.extraBedFeeCentavos ?? 0)
			: 0
	);
	const otherFeesTotal = $derived(
		data.kind === 'room' ? data.detail.booking.feesCentavos - extraBedFeeTotal : 0
	);

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

	const paymentMethodLabel: Record<string, string> = {
		cash: 'Cash',
		card: 'Card',
		gcash: 'GCash',
		maya: 'Maya',
		bank_transfer: 'Bank transfer',
		cheque: 'Cheque',
		paymongo: 'Online (PayMongo)',
		house_use: 'City ledger',
		security_deposit: 'Applied from security deposit'
	};
	const paymentPurposeLabel: Record<string, string> = {
		deposit: 'deposit',
		settlement: 'settlement',
		balance: 'balance',
		refund: 'refund'
	};

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
		<div class="flex items-center gap-2">
			<Button
				variant="outline"
				size="sm"
				href="{base}/print/invoice/for/{data.kind === 'room' ? 'booking' : 'hall'}/{page.params.id}"
				target="_blank">Print invoice</Button
			>
			{#if data.detail.siblings.length > 0}
				<Button
					variant="outline"
					size="sm"
					href="{base}/print/invoice/for-order/{data.detail.order.id}"
					target="_blank">Print all invoices</Button
				>
			{/if}
			{#if page.url.searchParams.get('from') === 'front-desk'}
				{@const roomId = page.url.searchParams.get('roomId')}
				<Button variant="outline" href="{staffBase}/front-desk{roomId ? `?roomId=${roomId}` : ''}"
					>← Front desk</Button
				>
			{:else}
				<Button variant="outline" href="{staffBase}/reservations">← Reservations</Button>
			{/if}
		</div>
	</div>

	<div class="flex items-center gap-2">
		<Badge
			variant="outline"
			class={statusVariantClass(
				data.kind === 'room' ? data.detail.booking.status : data.detail.hallBooking.status
			)}
		>
			{statusLabel(
				data.kind === 'room' ? data.detail.booking.status : data.detail.hallBooking.status
			)}
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
			<p class="mt-2 text-xs text-ink-muted">
				Special requests: {data.detail.guest.specialRequests}
			</p>
		{/if}
	</div>

	{#if data.detail.siblings.length > 0}
		<!-- Same order, different room/hall line — see `siblingLines` in reservations.ts:
		     a multi-room-type walk-in (or online order) settled in one payment still
		     becomes one reservation line per room/hall, so surface the others here or
		     staff opening one line has no way to tell the rest of the sale exists. -->
		<div class="mt-4 rounded-xl border border-border p-4">
			<h2 class="mb-2 text-sm font-semibold text-ink">Also in this booking</h2>
			<div class="flex flex-col gap-2">
				{#each data.detail.siblings as s (s.id)}
					<a
						href="{staffBase}/reservations/{s.kind}/{s.id}"
						class="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-2"
					>
						<span>
							<span class="text-ink">{s.title}</span>
							<span class="text-ink-muted"> · {s.subtitle}</span>
						</span>
						<Badge variant="outline" class={statusVariantClass(s.status)}>
							{statusLabel(s.status)}
						</Badge>
					</a>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Stay / Event details -->
	<div class="mt-4 rounded-xl border border-border p-4">
		{#if data.kind === 'room'}
			{#snippet securityDepositFields()}
				{#if data.kind === 'room' && data.securityDeposit?.status === 'held'}
					<p class="mt-3 text-sm text-ink-muted">
						Security deposit held: ₱{(data.securityDeposit.amountCentavos / 100).toFixed(2)}
					</p>
				{:else if data.kind === 'room' && data.securityDepositPolicy}
					<div class="mt-3 space-y-2 rounded-md border border-border p-3">
						<Label>Security deposit</Label>
						<input
							type="hidden"
							name="securityDepositPolicyId"
							value={data.securityDepositPolicy.id}
						/>
						<div class="flex flex-wrap items-end gap-2">
							<div>
								<Label for="depositAmount" class="text-xs">Amount (₱)</Label>
								<Input
									id="depositAmount"
									name="depositAmount"
									type="number"
									min="0"
									step="0.01"
									value={(data.securityDepositPolicy.amountCentavos / 100).toFixed(2)}
									class="mt-1 w-28"
								/>
							</div>
							<div>
								<Label for="depositMethod" class="text-xs">Method</Label>
								<select
									id="depositMethod"
									name="depositMethod"
									bind:value={depositMethod}
									class="mt-1 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm"
								>
									<option value="cash">Cash</option>
									<option value="card">Card</option>
									<option value="gcash">GCash</option>
									<option value="maya">Maya</option>
									<option value="bank_transfer">Bank transfer</option>
									<option value="cheque">Cheque</option>
								</select>
							</div>
							<div>
								<Label for="depositReferenceNo" class="text-xs">Reference no.</Label>
								<Input
									id="depositReferenceNo"
									name="depositReferenceNo"
									bind:value={depositReferenceNo}
									placeholder={depositMethod === 'cash' ? '' : 'Approval / transaction no.'}
									class="mt-1 w-32"
								/>
							</div>
						</div>
					</div>
				{/if}
			{/snippet}
			<div class="mb-2 flex items-center justify-between gap-3">
				<h2 class="text-sm font-semibold text-ink">Stay</h2>
				{#if data.canModifyStay}
					<Button variant="outline" size="sm" onclick={openModifyDialog}>Modify booking</Button>
				{/if}
			</div>
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
				{#if data.detail.bookingRoom.extraBeds > 0}
					<div>
						<div class="text-xs text-ink-muted">Extra beds</div>
						<div class="text-ink">{data.detail.bookingRoom.extraBeds}</div>
					</div>
				{/if}
			</div>

			{#if data.detail.booking.status === 'checked_in'}
				<div class="mt-4 border-t border-border pt-4">
					<div class="text-xs text-ink-muted">Assigned</div>
					<div class="text-sm text-ink">
						{data.detail.assignedRooms.map((r) => `Room ${r.roomNumber}`).join(', ')}
					</div>
					{#if data.securityDeposit?.status === 'held'}
						<div class="mt-2 text-xs text-ink-muted">
							Security deposit held: ₱{(data.securityDeposit.amountCentavos / 100).toFixed(2)}
						</div>
					{/if}
				</div>
			{:else if data.detail.booking.status === 'confirmed'}
				<form
					method="POST"
					action="?/checkIn"
					enctype="multipart/form-data"
					use:enhance
					class="mt-4 border-t border-border pt-4"
				>
					{#if data.detail.assignedRooms.length > 0}
						<!-- Front-desk grid pick mode already claimed the exact room(s) for this
						     booking at creation time — check-in here just confirms them, no picker. -->
						<Label>Room{data.detail.bookingRoom.quantity > 1 ? 's' : ''} already assigned</Label>
						<div class="mt-2 flex flex-wrap items-center gap-2">
							{#each data.detail.assignedRooms as r (r.roomNumber)}
								<span
									class="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-ink"
								>
									Room {r.roomNumber}
								</span>
							{/each}
						</div>
						<div class="mt-3">
							<IdCameraCapture />
						</div>
						{@render securityDepositFields()}
						<div class="mt-3">
							<Button type="submit" size="sm">Check in</Button>
						</div>
					{:else}
						<Label
							>Assign room{data.detail.bookingRoom.quantity > 1 ? 's' : ''} &amp; check in</Label
						>
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
							</div>
							<div class="mt-3">
								<IdCameraCapture />
							</div>
							{@render securityDepositFields()}
							<div class="mt-3">
								<Button type="submit" size="sm">Check in</Button>
							</div>
						{/if}
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
						<Table.Cell class="text-right text-ink"
							>{peso(data.detail.booking.subtotalCentavos)}</Table.Cell
						>
					</Table.Row>
					{#if extraBedFeeTotal > 0}
						<Table.Row>
							<Table.Cell class="text-ink-muted"
								>Extra bed{data.detail.bookingRoom.extraBeds === 1 ? '' : 's'} × {data.detail
									.bookingRoom.extraBeds}</Table.Cell
							>
							<Table.Cell class="text-right text-ink">{peso(extraBedFeeTotal)}</Table.Cell>
						</Table.Row>
					{/if}
					{#if otherFeesTotal > 0}
						<Table.Row>
							<Table.Cell class="text-ink-muted">Other fees</Table.Cell>
							<Table.Cell class="text-right text-ink">{peso(otherFeesTotal)}</Table.Cell>
						</Table.Row>
					{/if}
					<Table.Row>
						<Table.Cell class="text-ink-muted">VAT</Table.Cell>
						<Table.Cell class="text-right text-ink"
							>{peso(data.detail.booking.vatCentavos)}</Table.Cell
						>
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
						<Table.Cell class="text-right text-ink"
							>{peso(data.detail.hallBooking.vatCentavos)}</Table.Cell
						>
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
		{#if data.detail.folio}
			{@const f = data.detail.folio}
			{@const multi = f.orderLineCount > 1}
			<div class="mb-3 space-y-1 border-b border-border pb-3 text-sm">
				<div class="flex justify-between">
					<span class="text-ink-muted">Charges{multi ? ` (this ${data.kind === 'room' ? 'room' : 'event'})` : ''}</span>
					<span class="text-ink">{peso(f.chargesTotalCentavos)}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-ink-muted">Paid{multi ? ' on this room' : ''}</span>
					<span class="text-ink">−{peso(f.paidTotalCentavos)}</span>
				</div>
				<div class="flex justify-between font-semibold {f.balanceCentavos > 0 ? 'text-danger' : 'text-ink'}">
					<span>{f.balanceCentavos < 0 ? 'Room credit' : 'Room balance due'}</span>
					<span>{peso(Math.abs(f.balanceCentavos))}</span>
				</div>
				{#if multi}
					<div class="flex justify-between pt-1 text-xs text-ink-muted">
						<span>Whole booking ({f.orderLineCount} rooms/events): {peso(f.orderChargesTotalCentavos)}</span>
						<span>{f.orderBalanceCentavos > 0 ? `owes ${peso(f.orderBalanceCentavos)}` : 'settled'}</span>
					</div>
					<div class="pt-1">
						<Button variant="outline" size="sm" href="{staffBase}/transactions/{data.detail.order.id}">
							Open transaction
						</Button>
					</div>
				{/if}
			</div>
		{/if}
		{#if data.detail.payments.length === 0}
			<p class="text-sm text-ink-muted">No payment recorded yet — this order hasn't been paid.</p>
		{:else}
			<div class="space-y-3">
				{#each data.detail.payments as p (p.id)}
					<div
						class="flex items-start justify-between gap-2 text-sm {p.voidedAt ? 'opacity-50' : ''}"
					>
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-1.5">
								<Badge variant="outline" class={paymentStatusClass(p.status)}>{p.status}</Badge>
								<span class="font-medium text-ink {p.voidedAt ? 'line-through' : ''}">
									{paymentMethodLabel[p.method] ?? p.method}
								</span>
								{#if p.purpose !== 'settlement'}
									<Badge variant="outline" class="border-border bg-surface-2 text-ink-muted">
										{paymentPurposeLabel[p.purpose] ?? p.purpose}
									</Badge>
								{/if}
							</div>
							<div class="mt-0.5 text-xs text-ink-muted">
								{#if p.paidAt}{p.paidAt}{/if}
								{#if p.referenceNo}{p.paidAt ? ' · ' : ''}Ref {p.referenceNo}{/if}
								{#if p.tenderedCentavos != null && p.method === 'cash'}
									{p.paidAt || p.referenceNo ? ' · ' : ''}tendered {peso(p.tenderedCentavos)}, change {peso(
										p.changeCentavos
									)}
								{/if}
							</div>
							{#if p.voidedAt}
								<div class="mt-0.5 text-xs text-danger">
									Voided{#if p.voidReason}
										— {p.voidReason}{/if}
								</div>
							{/if}
						</div>
						<div class="flex shrink-0 items-center gap-2">
							{#if !p.voidedAt && p.amountCentavos > 0}
								<a
									href="{base}/print/receipt/{p.id}"
									target="_blank"
									class="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
								>
									Receipt
								</a>
							{/if}
							{#if p.attachmentUrl}
								<a
									href={p.attachmentUrl}
									target="_blank"
									class="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
								>
									Proof
								</a>
							{/if}
							<span class="text-ink">{peso(p.amountCentavos)}</span>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Confirmation email -->
	<div class="mt-4 rounded-xl border border-border p-4">
		<div class="mb-2 flex items-center justify-between gap-3">
			<h2 class="text-sm font-semibold text-ink">Confirmation email</h2>
			{#if data.detail.order.status === 'pending_payment'}
				<form
					method="POST"
					action="?/sendPaymentLink"
					use:enhance={() => {
						resending = true;
						return async ({ update }) => {
							await update();
							resending = false;
						};
					}}
				>
					<Button type="submit" variant="outline" size="sm" disabled={resending}>
						{resending ? 'Sending…' : 'Email payment link'}
					</Button>
				</form>
			{:else if data.detail.order.status === 'confirmed'}
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
					Releases the {data.kind === 'room' ? 'room' : 'hall'} hold and, for a paid booking, records
					the refund after any cancellation fee.
				{:else}
					This arrival is past its check-in date.
				{/if}
			</p>

			{#if data.openRequest}
				<div class="mb-3 rounded-lg border border-border bg-surface-2 p-3">
					<p class="text-xs font-semibold text-ink">Guest requested cancellation</p>
					<p class="mt-1 text-sm text-ink">{data.openRequest.body}</p>
					{#if decliningRequest}
						<form method="POST" action="?/declineRequest" use:enhance class="mt-3 space-y-2">
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
						<Button variant="outline" onclick={() => (confirmingNoShow = true)}>Mark no-show</Button
						>
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
				Admin-only escape hatch for a stuck or wrongly-set status — not a substitute for the normal
				check-in/check-out/cancel flows.
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
						<span class="text-ink-muted"
							>{h.fromStatus ? statusLabel(h.fromStatus) : 'created'} →</span
						>
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

{#if data.kind === 'room' && data.canModifyStay}
	<Dialog.Root bind:open={modifyOpen}>
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Modify booking</Dialog.Title>
				<Dialog.Description>
					{data.detail.booking.status === 'checked_in'
						? 'The guest is already checked in — only the departure date can move; room type and guest count are locked to what was checked in.'
						: 'Re-checks availability for any date/room-type change.'}
				</Dialog.Description>
			</Dialog.Header>
			<form
				method="POST"
				action="?/modifyStay"
				use:enhance={() => {
					modifySubmitting = true;
					return async ({ update, result }) => {
						await update({ reset: false });
						modifySubmitting = false;
						if (result.type === 'success') {
							modifyOpen = false;
							modifyReason = '';
							modifyQuote = null;
						}
					};
				}}
				class="space-y-4"
			>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="modify-check-in" class="text-xs">Check-in</Label>
						<Input
							id="modify-check-in"
							name="checkIn"
							type="date"
							bind:value={modifyCheckIn}
							disabled={data.detail.booking.status === 'checked_in'}
							oninput={requestModifyQuote}
							class="mt-1"
						/>
					</div>
					<div>
						<Label for="modify-check-out" class="text-xs">Check-out</Label>
						<Input
							id="modify-check-out"
							name="checkOut"
							type="date"
							bind:value={modifyCheckOut}
							oninput={requestModifyQuote}
							class="mt-1"
						/>
					</div>
				</div>

				{#if data.detail.booking.status === 'confirmed'}
					<div class="grid grid-cols-2 gap-3">
						<div>
							<Label for="modify-room-type" class="text-xs">Room type</Label>
							<select
								id="modify-room-type"
								name="roomTypeId"
								bind:value={modifyRoomTypeId}
								onchange={onModifyRoomTypeChange}
								class="mt-1 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
							>
								{#each data.modifyRoomTypeOptions as t (t.id)}
									<option value={t.id}>{t.name}</option>
								{/each}
							</select>
						</div>
						<div>
							<Label for="modify-rate-plan" class="text-xs">Rate plan</Label>
							<select
								id="modify-rate-plan"
								name="ratePlanId"
								bind:value={modifyRatePlanId}
								onchange={requestModifyQuote}
								class="mt-1 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
							>
								{#each modifyRatePlanOptions as p (p.id)}
									<option value={p.id}>{p.name}</option>
								{/each}
							</select>
						</div>
					</div>
					<div>
						<Label for="modify-occupancy" class="text-xs">Guests</Label>
						<Input
							id="modify-occupancy"
							name="occupancy"
							type="number"
							min="1"
							bind:value={modifyOccupancy}
							oninput={requestModifyQuote}
							class="mt-1 w-24"
						/>
					</div>
				{:else}
					<input type="hidden" name="roomTypeId" value={modifyRoomTypeId} />
					<input type="hidden" name="ratePlanId" value={modifyRatePlanId} />
					<input type="hidden" name="occupancy" value={modifyOccupancy} />
				{/if}

				{#if data.detail.roomType.extraBedAllowed}
					<div>
						<Label for="modify-extra-beds" class="text-xs">Extra beds</Label>
						<Input
							id="modify-extra-beds"
							type="number"
							min="0"
							max={modifyMaxExtraBeds}
							bind:value={modifyExtraBeds}
							disabled={modifyRoomOrRateChanged}
							oninput={requestModifyQuote}
							class="mt-1 w-24"
						/>
						<input
							type="hidden"
							name="extraBeds"
							value={modifyRoomOrRateChanged ? data.detail.bookingRoom.extraBeds : modifyExtraBeds}
						/>
						{#if modifyRoomOrRateChanged}
							<p class="mt-1 text-xs text-ink-muted">
								Locked while the room type/rate plan is also changing — apply that first, then
								modify extra beds separately.
							</p>
						{:else}
							<p class="mt-1 text-xs text-ink-muted">Up to {modifyMaxExtraBeds} for this room.</p>
						{/if}
					</div>
				{/if}

				{#if modifyQuoting}
					<p class="text-xs text-ink-muted">Checking availability and pricing…</p>
				{:else if modifyQuoteError}
					<p class="text-xs text-danger">{modifyQuoteError}</p>
				{:else if modifyQuote}
					{#if modifyQuote.roomChange}
						<div class="rounded-lg border border-border bg-surface-2 p-3 text-sm">
							<div class="flex items-center justify-between text-xs">
								<span class="text-ink-muted">Re-priced for the new room type/rate plan</span>
								<span class="text-ink"
									>₱{(modifyQuote.roomChange.oldTotalCentavos / 100).toFixed(2)} → ₱{(
										modifyQuote.roomChange.newTotalCentavos / 100
									).toFixed(2)}</span
								>
							</div>
							<div
								class="mt-2 flex items-center justify-between border-t border-border pt-2 font-semibold"
							>
								<span class="text-ink"
									>{modifyQuote.deltaCentavos >= 0 ? 'Folio charge' : 'Folio credit'}</span
								>
								<span class="text-ink"
									>₱{(Math.abs(modifyQuote.deltaCentavos) / 100).toFixed(2)}</span
								>
							</div>
						</div>
					{:else if modifyQuote.segments.length === 0 && modifyQuote.newExtraBeds != null}
						<div class="rounded-lg border border-border bg-surface-2 p-3 text-sm">
							<div class="flex items-center justify-between text-xs">
								<span class="text-ink-muted"
									>Extra beds {modifyQuote.oldExtraBeds} → {modifyQuote.newExtraBeds}</span
								>
							</div>
							{#if modifyQuote.deltaCentavos !== 0}
								<div
									class="mt-2 flex items-center justify-between border-t border-border pt-2 font-semibold"
								>
									<span class="text-ink"
										>{modifyQuote.deltaCentavos >= 0 ? 'Folio charge' : 'Folio credit'}</span
									>
									<span class="text-ink"
										>₱{(Math.abs(modifyQuote.deltaCentavos) / 100).toFixed(2)}</span
									>
								</div>
							{/if}
						</div>
						{#if modifyQuote.blockingReason}
							<p class="text-xs text-danger">{modifyQuote.blockingReason}</p>
						{/if}
					{:else if modifyQuote.segments.length === 0}
						<p class="text-xs text-ink-muted">
							{modifyQuote.blockingReason ?? 'No pricing change.'}
						</p>
					{:else}
						<div class="rounded-lg border border-border bg-surface-2 p-3 text-sm">
							{#each modifyQuote.segments as s, i (i)}
								<div class="flex items-center justify-between text-xs">
									<span class="text-ink-muted">{modifySegmentLabel(s)}</span>
									<span class="text-ink">
										{s.direction === 'added' ? '+' : '−'}₱{(s.amountCentavos / 100).toFixed(2)}
									</span>
								</div>
							{/each}
							<div
								class="mt-2 flex items-center justify-between border-t border-border pt-2 font-semibold"
							>
								<span class="text-ink"
									>{modifyQuote.deltaCentavos >= 0 ? 'Folio charge' : 'Folio credit'}</span
								>
								<span class="text-ink"
									>₱{(Math.abs(modifyQuote.deltaCentavos) / 100).toFixed(2)}</span
								>
							</div>
						</div>
						{#if modifyQuote.blockingReason}
							<p class="text-xs text-danger">{modifyQuote.blockingReason}</p>
						{/if}
					{/if}
				{/if}

				<div>
					<Label for="modify-reason" class="text-xs"
						>Reason <span class="text-danger">*</span></Label
					>
					<textarea
						id="modify-reason"
						name="reason"
						bind:value={modifyReason}
						required
						rows="2"
						placeholder="Why is this booking changing?"
						class="mt-1 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
					></textarea>
				</div>

				<div class="flex justify-end gap-2 pt-1">
					<Button
						type="button"
						variant="ghost"
						onclick={() => (modifyOpen = false)}
						disabled={modifySubmitting}
					>
						Cancel
					</Button>
					<Button
						type="submit"
						disabled={modifySubmitting ||
							modifyReason.trim().length === 0 ||
							!!modifyQuote?.blockingReason ||
							modifyQuoting}
					>
						{modifySubmitting ? 'Saving…' : 'Apply change'}
					</Button>
				</div>
			</form>
		</Dialog.Content>
	</Dialog.Root>
{/if}

<Dialog.Root bind:open={manualConfirmOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Manually confirm this {data.kind === 'room' ? 'booking' : 'event'}</Dialog.Title
			>
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
				<Button
					type="submit"
					disabled={overrideSubmitting || manualConfirmReason.trim().length === 0}
				>
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
				Re-checks availability first; if this booking was paid and refunded, the refund is reversed.
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
				<Label for="reinstate-reason" class="text-xs"
					>Reason <span class="text-danger">*</span></Label
				>
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
