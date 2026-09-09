<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import SearchIcon from '@lucide/svelte/icons/search';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import BanknoteIcon from '@lucide/svelte/icons/banknote';
	import PartyPopperIcon from '@lucide/svelte/icons/party-popper';
	import ReceiptIcon from '@lucide/svelte/icons/receipt';
	import PaymentFields from '$lib/components/staff/payment-fields.svelte';
	import WalkinPaymentFields from '$lib/components/staff/walkin-payment-fields.svelte';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import type { ActionData, PageData } from './$types';
	import type { HallGridCell, RoomGridCell } from '$lib/server/front-desk';
	import type { HallPriceBreakdown } from '$lib/server/pricing';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}`);
	const peso = (centavos: number) => `₱${(centavos / 100).toFixed(2)}`;
	const canChargeCityLedger = $derived(data.role === 'hotel_admin');

	const formOk = $derived(form && 'ok' in form ? form.ok : undefined);
	const formError = $derived(form && 'error' in form ? form.error : undefined);
	const formPaymentOk = $derived(form && 'paymentOk' in form ? form.paymentOk : undefined);
	const formShiftError = $derived(form && 'shiftError' in form ? form.shiftError : undefined);
	const formWalkInError = $derived(form && 'walkInError' in form ? form.walkInError : undefined);
	const formWalkInSearch = $derived(form && 'walkInSearch' in form ? form.walkInSearch : undefined);
	const formAvailableRoomTypes = $derived(
		form && 'availableRoomTypes' in form ? form.availableRoomTypes : undefined
	);
	const formRoomDetail = $derived(form && 'roomDetail' in form ? form.roomDetail : undefined);
	const formFolio = $derived(form && 'folio' in form ? form.folio : undefined);
	const formFolioError = $derived(form && 'folioError' in form ? form.folioError : undefined);
	const formHallBookingDetail = $derived(
		form && 'hallBookingDetail' in form ? form.hallBookingDetail : undefined
	);
	const formHallFolio = $derived(form && 'hallFolio' in form ? form.hallFolio : undefined);
	const formHallWalkInError = $derived(
		form && 'hallWalkInError' in form ? form.hallWalkInError : undefined
	);
	const formHallWalkInOk = $derived(form && 'hallWalkInOk' in form ? form.hallWalkInOk : undefined);

	$effect(() => {
		if (formOk) toast.success(formOk);
		if (formError) toast.error(formError);
		if (formPaymentOk) {
			toast.success(formPaymentOk);
			roomPayOpen = false;
			roomRefundOpen = false;
			hallPayOpen = false;
			hallRefundOpen = false;
		}
		if (formShiftError) toast.error(formShiftError);
		if (formWalkInError) toast.error(formWalkInError);
		if (formFolioError) toast.error(formFolioError);
		if (formHallWalkInError) toast.error(formHallWalkInError);
		if (formHallWalkInOk) {
			toast.success(formHallWalkInOk);
			hallWalkInOpen = false;
		}
		// Check-out ends the in-house view — close the room dialog instead of
		// leaving it open with no `roomDetail` payload behind it (empty shell).
		if (form && 'checkedOut' in form) {
			detailDialogOpen = false;
			checkoutCityLedger = false;
			selectedRoomId = null;
		}
	});

	let detailDialogOpen = $state(false);
	$effect(() => {
		if (formRoomDetail) detailDialogOpen = true;
	});

	// Folio payment / refund panels (room + hall dialogs), and the checkout city-ledger form.
	let roomPayOpen = $state(false);
	let roomRefundOpen = $state(false);
	let hallPayOpen = $state(false);
	let hallRefundOpen = $state(false);
	let checkoutCityLedger = $state(false);
	let shiftFloat = $state('');
	let shiftDrawer = $state('');

	let hallDetailDialogOpen = $state(false);
	$effect(() => {
		if (formHallBookingDetail) hallDetailDialogOpen = true;
	});

	// --- Room grid filtering ---
	let search = $state('');
	let typeFilter = $state('all');
	let selectedRoomId = $state<string | null>(null);
	let railTab = $state<'arrivals' | 'departures'>('arrivals');

	const roomTypeNames = $derived([...new Set(data.cells.map((c) => c.roomTypeName))].sort());

	const walkInSelectedTotal = $derived.by(() => {
		if (!walkInSelection || !formAvailableRoomTypes) return null;
		const [rtId, planId] = walkInSelection.split('|');
		const rt = formAvailableRoomTypes.find((r) => r.id === rtId);
		const plan = rt?.ratePlans.find((p) => p.id === planId);
		const per = plan?.price.totalCentavos ?? null;
		return per == null ? null : per * (formWalkInSearch?.roomCount ?? 1);
	});

	const filteredCells = $derived(
		data.cells.filter((c) => {
			if (typeFilter !== 'all' && c.roomTypeName !== typeFilter) return false;
			if (!search.trim()) return true;
			const q = search.trim().toLowerCase();
			return (
				c.roomNumber.toLowerCase().includes(q) ||
				c.roomTypeName.toLowerCase().includes(q) ||
				(c.occupant?.guestName ?? '').toLowerCase().includes(q)
			);
		})
	);

	const floorGroups = $derived.by(() => {
		const map = new Map<string, RoomGridCell[]>();
		for (const c of filteredCells) {
			const key = c.floor ?? 'Unassigned floor';
			const list = map.get(key) ?? [];
			list.push(c);
			map.set(key, list);
		}
		return [...map.entries()];
	});

	const selectedRoom = $derived(data.cells.find((c) => c.roomId === selectedRoomId) ?? null);

	function statusCardClass(status: string): string {
		switch (status) {
			case 'occupied':
			case 'departing':
				return 'border-ok/40 bg-ok/10';
			case 'reserved':
				return 'border-dashed border-brand/50';
			case 'ooo':
				return 'border-danger/30 bg-danger/10 opacity-80';
			default:
				return 'border-border';
		}
	}
	function statusPillClass(status: string): string {
		switch (status) {
			case 'occupied':
			case 'departing':
				return 'border-transparent bg-ok/15 text-ok';
			case 'reserved':
				return 'border-transparent bg-brand/15 text-brand';
			case 'ooo':
				return 'border-transparent bg-danger/15 text-danger';
			default:
				return 'border-border bg-surface-2 text-ink-muted';
		}
	}
	const statusLabel: Record<string, string> = {
		vacant: 'Vacant',
		occupied: 'Occupied',
		departing: 'Occupied',
		reserved: 'Reserved',
		ooo: 'Out of order'
	};
	function channelLabel(channel: string): string {
		return channel === 'cash' ? 'Walk-in' : 'Booked online';
	}
	function humanize(s: string): string {
		return s.replace(/_/g, ' ');
	}
	function paymentStatusClass(status: string): string {
		if (status === 'paid') return 'border-transparent bg-ok/15 text-ok';
		if (status === 'failed') return 'border-transparent bg-danger/15 text-danger';
		return 'border-border bg-surface-2 text-ink-muted';
	}

	// --- Walk-in drawer ---
	let walkInOpen = $state(false);
	let walkInSelection = $state('');
	let walkInPrefillType = $state<string | null>(null);

	function todayPlus(days: number): string {
		const d = new Date(`${data.businessDate}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() + days);
		return d.toISOString().slice(0, 10);
	}

	function openWalkIn(prefillType?: string) {
		walkInPrefillType = prefillType ?? null;
		walkInSelection = '';
		walkInOpen = true;
	}

	$effect(() => {
		if (walkInPrefillType && formAvailableRoomTypes && formAvailableRoomTypes.length > 0) {
			const match = formAvailableRoomTypes.find((rt) => rt.name === walkInPrefillType);
			if (match?.ratePlans[0]) {
				walkInSelection = `${match.id}|${match.ratePlans[0].id}`;
			}
			walkInPrefillType = null;
		}
	});

	// --- Function hall walk-in drawer ---
	let hallWalkInOpen = $state(false);
	let hallWalkInHall = $state<HallGridCell | null>(null);
	let heEventDate = $state(data.businessDate);
	let heStartTime = $state('09:00');
	let heEndTime = $state('11:00');
	let hallQuote = $state<HallPriceBreakdown | null>(null);
	let hallQuoteError = $state<string | null>(null);
	let hallQuoteLoading = $state(false);

	/** Same wraparound-safe hour math the storefront's hall mini-form already uses. */
	function addHours(time: string, hours: number): string {
		const [h, m] = time.split(':').map(Number);
		const total = (((h! * 60 + m! + hours * 60) % (24 * 60)) + 24 * 60) % (24 * 60);
		return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
	}

	function openHallWalkIn(hall: HallGridCell) {
		hallWalkInHall = hall;
		heEventDate = data.businessDate;
		heStartTime = '09:00';
		heEndTime = addHours('09:00', hall.baseHours);
		hallQuote = null;
		hallQuoteError = null;
		hallWalkInOpen = true;
		fetchHallQuote();
	}

	/** Live price quote as the front desk adjusts date/time — same `/book/api/hall-quote`
	 *  endpoint the guest-facing storefront's own hall mini-form calls; hourly math never
	 *  happens client-side, so what's quoted here can never drift from what actually gets charged. */
	async function fetchHallQuote() {
		if (!hallWalkInHall) return;
		if (heStartTime >= heEndTime) {
			hallQuote = null;
			hallQuoteError = 'End time must be after start time.';
			return;
		}
		hallQuoteLoading = true;
		hallQuoteError = null;
		try {
			const res = await fetch(`${base}/front-desk/api/hall-quote`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					functionHallId: hallWalkInHall.functionHallId,
					eventDate: heEventDate,
					startTime: heStartTime,
					endTime: heEndTime
				})
			});
			if (!res.ok) {
				hallQuote = null;
				hallQuoteError =
					((await res.json().catch(() => null)) as { message?: string } | null)?.message ??
					'Could not price that booking.';
				return;
			}
			const result = (await res.json()) as { available: boolean; price?: HallPriceBreakdown };
			if (!result.available) {
				hallQuote = null;
				hallQuoteError = 'This hall is already booked for that time — pick a different slot.';
				return;
			}
			hallQuote = result.price ?? null;
		} catch {
			hallQuote = null;
			hallQuoteError = 'Could not reach the server. Try again.';
		} finally {
			hallQuoteLoading = false;
		}
	}

	function statusPillClassGeneric(status: string): string {
		if (status === 'confirmed' || status === 'completed')
			return 'border-transparent bg-ok/15 text-ok';
		if (status === 'cancelled') return 'border-transparent bg-danger/15 text-danger';
		return 'border-border bg-surface-2 text-ink-muted';
	}

	const methodLabels: Record<string, string> = {
		cash: 'Cash',
		card: 'Card',
		gcash: 'GCash',
		maya: 'Maya',
		bank_transfer: 'Bank transfer',
		cheque: 'Cheque',
		paymongo: 'Online',
		house_use: 'City ledger'
	};
</script>

{#snippet paymentRow(p: any, kind: 'room' | 'hall', id: string)}
	<div class="flex items-start justify-between gap-2 text-sm {p.voidedAt ? 'opacity-50' : ''}">
		<div class="min-w-0">
			<div class="flex flex-wrap items-center gap-1.5">
				<span class="font-medium text-ink {p.voidedAt ? 'line-through' : ''}">
					{methodLabels[p.method] ?? p.method}
				</span>
				{#if p.purpose === 'deposit'}<Badge
						variant="outline"
						class="border-border bg-surface-2 text-ink-muted">deposit</Badge
					>{/if}
				{#if p.purpose === 'refund'}<Badge
						variant="outline"
						class="border-transparent bg-danger/15 text-danger">refund</Badge
					>{/if}
				{#if p.voidedAt}<span class="text-xs text-danger"
						>voided{#if p.voidReason}
							— {p.voidReason}{/if}</span
					>{/if}
			</div>
			<div class="text-xs text-ink-muted">
				{#if p.referenceNo}Ref {p.referenceNo}{/if}
				{#if p.tenderedCentavos != null && p.method === 'cash'}
					{p.referenceNo ? ' · ' : ''}tendered {peso(p.tenderedCentavos)}, change {peso(
						p.changeCentavos
					)}
				{/if}
			</div>
			<div class="mt-0.5 flex gap-3">
				{#if !p.voidedAt && p.amountCentavos > 0}
					<a
						href="{base}/print/receipt/{p.id}"
						target="_blank"
						class="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
					>
						Receipt
					</a>
				{/if}
				{#if !p.voidedAt && p.status === 'paid' && p.provider !== 'paymongo' && p.method !== 'house_use'}
					<form method="POST" action="?/voidPayment" use:enhance>
						<input type="hidden" name="kind" value={kind} />
						<input type="hidden" name="id" value={id} />
						<input type="hidden" name="paymentId" value={p.id} />
						<input type="hidden" name="reason" value="Voided at front desk" />
						<button
							type="submit"
							class="text-xs text-ink-muted underline underline-offset-2 hover:text-danger"
						>
							Void payment
						</button>
					</form>
				{/if}
			</div>
		</div>
		<span class="shrink-0 text-ink {p.voidedAt ? 'line-through' : ''}">
			{p.amountCentavos < 0 ? '−' : ''}{peso(Math.abs(p.amountCentavos))}
		</span>
	</div>
{/snippet}

<div class="flex h-[calc(100dvh-1px)] flex-col">
	<div class="flex items-center justify-between gap-4 border-b border-border px-6 py-3.5">
		<div>
			<h1 class="text-base font-semibold tracking-tight text-ink">Front desk</h1>
			<p class="text-xs text-ink-muted">{data.businessDate}</p>
		</div>
		<div class="flex items-center gap-3">
			{#if data.cashier.openShift}
				<a
					href="{base}/finance/shifts"
					class="flex items-center gap-1.5 rounded-md border border-ok/40 bg-ok/10 px-2.5 py-1.5 text-xs font-medium text-ok"
				>
					<BanknoteIcon class="size-3.5" />
					Shift open · float {peso(data.cashier.openShift.openingFloatCentavos)}
				</a>
			{:else if data.cashier.hasDrawerAccount}
				<form method="POST" action="?/openShift" use:enhance class="flex items-center gap-1.5">
					{#if data.cashier.drawers.length > 1}
						<select
							name="cashAccountId"
							bind:value={shiftDrawer}
							class="rounded-md border border-input bg-transparent px-2 py-1.5 text-xs"
						>
							<option value="" disabled selected>Drawer…</option>
							{#each data.cashier.drawers as d (d.id)}
								<option value={d.id}>{d.name}</option>
							{/each}
						</select>
					{:else if data.cashier.drawers[0]}
						<input type="hidden" name="cashAccountId" value={data.cashier.drawers[0].id} />
					{/if}
					<input
						name="openingFloat"
						type="number"
						min="0"
						step="0.01"
						bind:value={shiftFloat}
						placeholder="Float ₱"
						class="w-24 rounded-md border border-input bg-transparent px-2 py-1.5 text-xs"
						required
					/>
					<Button type="submit" size="sm" variant="outline">
						<ClockIcon class="size-3.5" />
						Open shift
					</Button>
				</form>
			{:else}
				<a
					href="{base}/finance/settings"
					class="text-xs text-ink-muted underline underline-offset-2"
				>
					Set up a cash drawer →
				</a>
			{/if}
			<Button onclick={() => openWalkIn()}>
				<UserPlusIcon />
				Walk-in
			</Button>
		</div>
	</div>

	<div
		class="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-2 px-6 py-2.5"
	>
		<div class="flex flex-wrap items-center gap-4 text-xs text-ink-muted">
			<div class="flex items-center gap-1.5">
				<span class="size-3 rounded border border-border"></span>Vacant
			</div>
			<div class="flex items-center gap-1.5">
				<span class="size-3 rounded border border-ok/40 bg-ok/15"></span>Occupied
			</div>
			<div class="flex items-center gap-1.5">
				<span class="relative size-3 rounded border border-ok/40 bg-ok/15">
					<LogOutIcon class="absolute -top-1 -right-1 size-2.5 text-ok" />
				</span>Departing today
			</div>
			<div class="flex items-center gap-1.5">
				<span class="size-3 rounded border border-dashed border-brand/50"></span>Reserved
			</div>
			<div class="flex items-center gap-1.5">
				<span class="size-3 rounded border border-danger/30 bg-danger/15"></span>Out of order
			</div>
		</div>
		<div class="flex items-center gap-2">
			<Select.Root type="single" bind:value={typeFilter}>
				<Select.Trigger class="w-44 shrink-0">
					{typeFilter === 'all' ? 'All room types' : typeFilter}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all" label="All room types" />
					{#each roomTypeNames as t (t)}
						<Select.Item value={t} label={t} />
					{/each}
				</Select.Content>
			</Select.Root>
			<div class="relative">
				<SearchIcon class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
				<Input placeholder="Find a room or guest…" bind:value={search} class="w-56 pl-8" />
			</div>
		</div>
	</div>

	<div class="flex min-h-0 flex-1">
		<div class="min-w-0 flex-1 overflow-y-auto p-6">
			{#if floorGroups.length === 0}
				<p class="text-sm text-ink-muted">No rooms match this filter.</p>
			{:else}
				{#each floorGroups as [floor, cells] (floor)}
					<div class="mb-7 last:mb-0">
						<div class="mb-2 flex items-baseline gap-2">
							<h2 class="text-xs font-bold tracking-wide text-ink-muted uppercase">
								Floor {floor}
							</h2>
							<span class="text-xs text-ink-muted"
								>{cells.length} room{cells.length === 1 ? '' : 's'}</span
							>
						</div>
						<div class="grid grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-2.5">
							{#each cells as c (c.roomId)}
								<button
									type="button"
									onclick={() => (selectedRoomId = c.roomId)}
									class="relative rounded-lg border p-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-sm {statusCardClass(
										c.status
									)} {selectedRoomId === c.roomId ? 'ring-2 ring-brand' : ''}"
								>
									{#if c.status === 'departing'}
										<LogOutIcon class="absolute top-1.5 right-1.5 size-3 text-ok" />
									{:else if c.status === 'reserved'}
										<span class="absolute top-2 right-2 size-1.5 rounded-full bg-brand"></span>
									{/if}
									<div class="text-base font-bold text-ink tabular-nums">{c.roomNumber}</div>
									<div class="truncate text-[11px] text-ink-muted">{c.roomTypeName}</div>
								</button>
							{/each}
						</div>
					</div>
				{/each}
			{/if}

			{#if data.hallGrid.length > 0}
				<div class="mt-8 border-t border-border pt-6">
					<h2 class="mb-3 text-xs font-bold tracking-wide text-ink-muted uppercase">
						Function halls
					</h2>
					<div class="space-y-3">
						{#each data.hallGrid as hall (hall.functionHallId)}
							<div class="rounded-lg border border-border p-4">
								<div class="mb-3 flex items-center justify-between gap-3">
									<div class="flex items-center gap-2">
										<PartyPopperIcon class="size-4 text-ink-muted" />
										<div>
											<div class="text-sm font-semibold text-ink">{hall.hallName}</div>
											<div class="text-xs text-ink-muted">Capacity {hall.capacity}</div>
										</div>
									</div>
									<Button size="sm" onclick={() => openHallWalkIn(hall)}>
										<UserPlusIcon class="size-3.5" />
										Walk-in event
									</Button>
								</div>
								{#if hall.events.length === 0}
									<p class="text-sm text-ink-muted">No events today.</p>
								{:else}
									<div class="divide-y divide-border rounded-md border border-border">
										{#each hall.events as e (e.hallBookingId)}
											<div class="flex items-center justify-between gap-3 px-3 py-2.5">
												<div>
													<div class="text-sm font-medium text-ink">
														{e.guestName} · {e.eventType}
													</div>
													<div class="text-xs text-ink-muted">
														{e.startTime.slice(0, 5)}–{e.endTime.slice(0, 5)} · {e.guestCount} guests
														· {channelLabel(e.channel)} · {peso(e.totalCentavos)}
													</div>
												</div>
												<div class="flex items-center gap-2">
													<Badge variant="outline" class={statusPillClassGeneric(e.status)}>
														{humanize(e.status)}
													</Badge>
													{#if e.status === 'confirmed'}
														<form method="POST" action="?/completeHall" use:enhance>
															<input type="hidden" name="hallBookingId" value={e.hallBookingId} />
															<Button type="submit" size="sm" variant="outline"
																>Mark completed</Button
															>
														</form>
													{/if}
													<form method="POST" action="?/hallDetail" use:enhance>
														<input type="hidden" name="hallBookingId" value={e.hallBookingId} />
														<Button type="submit" size="sm" variant="outline">Full details</Button>
													</form>
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<div class="hidden w-100 shrink-0 overflow-y-auto border-l border-border lg:block">
			{#if selectedRoom}
				<div class="p-4">
					<button
						type="button"
						onclick={() => (selectedRoomId = null)}
						class="mb-3 flex items-center gap-1 text-xs font-semibold text-ink-muted hover:text-ink"
					>
						<ChevronLeftIcon class="size-3.5" />
						Back to today's list
					</button>
					<h3 class="text-lg font-bold text-ink tabular-nums">Room {selectedRoom.roomNumber}</h3>
					<p class="mb-2 text-xs text-ink-muted">
						{selectedRoom.roomTypeName} · Floor {selectedRoom.floor ?? '—'}
					</p>
					<div class="mb-4 flex flex-wrap items-center gap-2">
						<Badge variant="outline" class={statusPillClass(selectedRoom.status)}>
							{statusLabel[selectedRoom.status]}
						</Badge>
						{#if selectedRoom.occupant}
							<Badge variant="outline" class="gap-1 border-border bg-surface-2 text-ink-muted">
								{#if selectedRoom.occupant.channel === 'cash'}
									<BanknoteIcon class="size-3" />
								{:else}
									<GlobeIcon class="size-3" />
								{/if}
								{channelLabel(selectedRoom.occupant.channel)}
							</Badge>
						{/if}
					</div>

					{#if selectedRoom.occupant}
						{@const o = selectedRoom.occupant}
						<dl class="mb-4 space-y-2 text-sm">
							<div class="flex justify-between gap-3 border-b border-border pb-2">
								<dt class="text-ink-muted">Guest</dt>
								<dd class="text-right font-medium text-ink">{o.guestName}</dd>
							</div>
							<div class="flex justify-between gap-3 border-b border-border pb-2">
								<dt class="text-ink-muted">Email</dt>
								<dd class="text-right text-ink">{o.guestEmail}</dd>
							</div>
							{#if o.guestPhone}
								<div class="flex justify-between gap-3 border-b border-border pb-2">
									<dt class="text-ink-muted">Phone</dt>
									<dd class="text-right text-ink">{o.guestPhone}</dd>
								</div>
							{/if}
							<div class="flex justify-between gap-3 border-b border-border pb-2">
								<dt class="text-ink-muted">Check-in</dt>
								<dd class="text-right text-ink">{o.checkIn}</dd>
							</div>
							<div class="flex justify-between gap-3 border-b border-border pb-2">
								<dt class="text-ink-muted">Check-out</dt>
								<dd class="text-right text-ink">{o.checkOut}</dd>
							</div>
							<div class="flex justify-between gap-3 border-b border-border pb-2">
								<dt class="text-ink-muted">Occupancy</dt>
								<dd class="text-right text-ink">{o.occupancy} guests</dd>
							</div>
							<div class="flex justify-between gap-3 border-b border-border pb-2">
								<dt class="text-ink-muted">Rate plan</dt>
								<dd class="text-right text-ink">{o.ratePlanName}</dd>
							</div>
							<div class="flex justify-between gap-3 border-b border-border pb-2">
								<dt class="text-ink-muted">Total</dt>
								<dd class="text-right font-semibold text-ink">{peso(o.totalCentavos)}</dd>
							</div>
						</dl>
						{#if o.specialRequests}
							<p class="mb-4 text-xs text-ink-muted">
								<strong class="text-ink">Special requests:</strong>
								{o.specialRequests}
							</p>
						{/if}
						{#if selectedRoom.status === 'departing' && data.lateCheckoutFeePerHourCentavos > 0}
							<p class="mb-3 rounded-md bg-surface-2 px-3 py-2 text-xs text-ink-muted">
								Wants to keep the room past {data.checkOutTime.slice(0, 5)}? Late checkout fee:
								<strong class="text-ink">{peso(data.lateCheckoutFeePerHourCentavos)}/hour</strong> — add
								it to the folio in Full details before checking out.
							</p>
						{/if}
						<div class="flex gap-2">
							{#if selectedRoom.status === 'departing' || selectedRoom.status === 'occupied'}
								<form method="POST" action="?/checkOut" use:enhance class="flex-1">
									<input type="hidden" name="bookingId" value={o.bookingId} />
									<Button type="submit" class="w-full">
										{selectedRoom.status === 'departing' ? 'Check out' : 'Check out early'}
									</Button>
								</form>
							{/if}
							<form method="POST" action="?/roomDetail" use:enhance class="flex-1">
								<input type="hidden" name="bookingId" value={o.bookingId} />
								<Button type="submit" variant="outline" class="w-full">Full details</Button>
							</form>
						</div>
					{:else if selectedRoom.status === 'reserved'}
						<div class="mb-3 text-xs font-bold tracking-wide text-ink-muted uppercase">
							Expected today · {selectedRoom.expectedArrivals.length} arrival{selectedRoom
								.expectedArrivals.length > 1
								? 's'
								: ''}
						</div>
						<div class="mb-4 divide-y divide-border rounded-lg border border-border">
							{#each selectedRoom.expectedArrivals as a (a.bookingId)}
								<div class="flex items-center justify-between px-3 py-2.5">
									<div>
										<div class="text-sm font-medium text-ink">{a.guestName}</div>
										<div class="text-xs text-ink-muted">{channelLabel(a.channel)}</div>
									</div>
									<Badge variant="outline" class="border-transparent bg-ok/15 text-ok">
										from {data.checkInTime.slice(0, 5)}
									</Badge>
								</div>
							{/each}
						</div>
						<p class="mb-3 text-xs text-ink-muted">
							This room is vacant right now — {selectedRoom.expectedArrivals.length > 1
								? 'these are'
								: 'this is'} confirmed {selectedRoom.roomTypeName} booking{selectedRoom
								.expectedArrivals.length > 1
								? 's'
								: ''} arriving today, not yet assigned to a specific room. Assign one at check-in from
							the booking's own page.
						</p>
						{#if data.earlyCheckInFeePerHourCentavos > 0}
							<p class="mb-4 rounded-md bg-surface-2 px-3 py-2 text-xs text-ink-muted">
								Wants to move in before {data.checkInTime.slice(0, 5)}? Early check-in fee:
								<strong class="text-ink">{peso(data.earlyCheckInFeePerHourCentavos)}/hour</strong> — add
								it to the folio in Full details once they've checked in.
							</p>
						{/if}
						<Button variant="outline" class="w-full" href="{base}/reservations">
							View today's {selectedRoom.roomTypeName} arrivals →
						</Button>
					{:else if selectedRoom.status === 'vacant'}
						<p class="mb-4 text-sm text-ink-muted">No booking for this room right now.</p>
						<Button class="w-full" onclick={() => openWalkIn(selectedRoom.roomTypeName)}>
							Walk-in this room type
						</Button>
					{:else if selectedRoom.status === 'ooo'}
						<p class="text-sm text-ink-muted">{selectedRoom.notes ?? 'Marked out of order.'}</p>
					{/if}
				</div>
			{:else}
				<div class="p-4">
					<div class="mb-3 flex gap-1 rounded-lg bg-surface-2 p-1">
						<button
							type="button"
							class="flex-1 rounded-md px-2 py-1.5 text-xs font-semibold {railTab === 'arrivals'
								? 'bg-surface text-ink shadow-sm'
								: 'text-ink-muted'}"
							onclick={() => (railTab = 'arrivals')}
						>
							Arrivals · {data.arrivals.length}
						</button>
						<button
							type="button"
							class="flex-1 rounded-md px-2 py-1.5 text-xs font-semibold {railTab === 'departures'
								? 'bg-surface text-ink shadow-sm'
								: 'text-ink-muted'}"
							onclick={() => (railTab = 'departures')}
						>
							Departures · {data.departures.length}
						</button>
					</div>
					{#if railTab === 'arrivals'}
						{#if data.arrivals.length === 0}
							<p class="text-sm text-ink-muted">No arrivals expected today.</p>
						{:else}
							<div class="divide-y divide-border">
								{#each data.arrivals as a (a.bookingId)}
									<div class="flex items-center justify-between py-2.5">
										<div>
											<div class="text-sm font-medium text-ink">{a.guestName}</div>
											<div class="text-xs text-ink-muted">
												{a.roomTypeName} · {channelLabel(a.channel)}
											</div>
										</div>
										<Badge variant="outline" class="border-transparent bg-ok/15 text-ok">
											from {data.checkInTime.slice(0, 5)}
										</Badge>
									</div>
								{/each}
							</div>
						{/if}
					{:else if data.departures.length === 0}
						<p class="text-sm text-ink-muted">No departures expected today.</p>
					{:else}
						<div class="divide-y divide-border">
							{#each data.departures as d (d.bookingId)}
								<button
									type="button"
									class="flex w-full items-center justify-between py-2.5 text-left hover:opacity-80"
									onclick={() => (selectedRoomId = d.roomId)}
								>
									<div>
										<div class="text-sm font-medium text-ink">{d.guestName}</div>
										<div class="text-xs text-ink-muted">Room {d.roomNumber} · {d.roomTypeName}</div>
									</div>
									<Badge variant="outline" class="border-transparent bg-ok/15 text-ok">
										by {data.checkOutTime.slice(0, 5)}
									</Badge>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>

<Sheet.Root bind:open={walkInOpen}>
	<Sheet.Content side="right" class="w-full overflow-y-auto sm:max-w-md">
		<Sheet.Header>
			<Sheet.Title>Walk-in booking</Sheet.Title>
		</Sheet.Header>
		<div class="px-4 pb-6">
			<form
				method="POST"
				action="?/walkInSearch"
				use:enhance={() => {
					return async ({ update }) => {
						await update({ reset: false });
					};
				}}
				class="space-y-3"
			>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="wiCheckIn">Check-in</Label>
						<Input
							id="wiCheckIn"
							type="date"
							name="checkIn"
							value={formWalkInSearch?.checkIn ?? data.businessDate}
						/>
					</div>
					<div>
						<Label for="wiCheckOut">Check-out</Label>
						<Input
							id="wiCheckOut"
							type="date"
							name="checkOut"
							value={formWalkInSearch?.checkOut ?? todayPlus(1)}
						/>
					</div>
					<div>
						<Label for="wiOccupancy">Guests</Label>
						<Input
							id="wiOccupancy"
							type="number"
							min="1"
							max="20"
							name="occupancy"
							value={formWalkInSearch?.occupancy ?? 1}
						/>
					</div>
					<div>
						<Label for="wiRoomCount">Rooms</Label>
						<Input
							id="wiRoomCount"
							type="number"
							min="1"
							max="8"
							name="roomCount"
							value={formWalkInSearch?.roomCount ?? 1}
						/>
					</div>
				</div>
				<Button type="submit" variant="outline" class="w-full">Check availability</Button>
			</form>

			{#if formAvailableRoomTypes}
				{#if formAvailableRoomTypes.length === 0}
					<p class="mt-4 text-sm text-ink-muted">No rooms available for these dates/occupancy.</p>
				{:else}
					<div class="mt-4 divide-y divide-border rounded-lg border border-border">
						{#each formAvailableRoomTypes as rt (rt.id)}
							{#each rt.ratePlans as plan (plan.id)}
								{@const value = `${rt.id}|${plan.id}`}
								<label
									class="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 hover:bg-surface-2"
								>
									<div class="flex items-center gap-2">
										<input
											type="radio"
											name="selectionRadio"
											{value}
											bind:group={walkInSelection}
											class="size-4"
										/>
										<div>
											<div class="text-sm font-medium text-ink">{rt.name}</div>
											<div class="text-xs text-ink-muted">
												{plan.name} · {rt.availableRooms} free
											</div>
										</div>
									</div>
									<div class="text-sm font-medium text-ink">{peso(plan.price.totalCentavos)}</div>
								</label>
							{/each}
						{/each}
					</div>
				{/if}
			{/if}

			{#if walkInSelection && formWalkInSearch}
				{@const [roomTypeId, ratePlanId] = walkInSelection.split('|')}
				<form
					method="POST"
					action="?/walkInCreate"
					use:enhance
					class="mt-4 space-y-3 border-t border-border pt-4"
				>
					<input type="hidden" name="checkIn" value={formWalkInSearch.checkIn} />
					<input type="hidden" name="checkOut" value={formWalkInSearch.checkOut} />
					<input type="hidden" name="occupancy" value={formWalkInSearch.occupancy} />
					<input type="hidden" name="roomCount" value={formWalkInSearch.roomCount} />
					<input type="hidden" name="roomTypeId" value={roomTypeId} />
					<input type="hidden" name="ratePlanId" value={ratePlanId} />
					<div>
						<Label for="wiFullName">Full name</Label>
						<Input id="wiFullName" name="fullName" required maxlength={160} />
					</div>
					<div class="grid grid-cols-2 gap-3">
						<div>
							<Label for="wiEmail">Email</Label>
							<Input id="wiEmail" name="email" type="email" required />
						</div>
						<div>
							<Label for="wiPhone">Phone</Label>
							<Input id="wiPhone" name="phone" maxlength={40} />
						</div>
					</div>
					<div>
						<Label for="wiSpecialRequests">Special requests</Label>
						<textarea
							id="wiSpecialRequests"
							name="specialRequests"
							maxlength={1000}
							rows="2"
							class="w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
						></textarea>
					</div>
					<WalkinPaymentFields totalCentavos={walkInSelectedTotal} cashier={data.cashier} />
					<Button type="submit" class="w-full">Create &amp; settle booking</Button>
				</form>
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>

<Dialog.Root bind:open={detailDialogOpen}>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-lg">
		{#if formRoomDetail}
			<Dialog.Header>
				<Dialog.Title
					>Room {formRoomDetail.assignedRooms?.[0]?.roomNumber ?? ''} — {formRoomDetail.guest
						.fullName}</Dialog.Title
				>
				<Dialog.Description>{formRoomDetail.roomType.name}</Dialog.Description>
			</Dialog.Header>

			<div class="space-y-4">
				<div class="rounded-lg border border-border p-4">
					<h3 class="mb-2 text-sm font-semibold text-ink">Guest</h3>
					<div class="text-sm text-ink">{formRoomDetail.guest.fullName}</div>
					<div class="text-sm text-ink-muted">{formRoomDetail.guest.email}</div>
					{#if formRoomDetail.guest.phone}
						<div class="text-sm text-ink-muted">{formRoomDetail.guest.phone}</div>
					{/if}
					{#if formRoomDetail.guest.specialRequests}
						<p class="mt-2 text-xs text-ink-muted">
							Special requests: {formRoomDetail.guest.specialRequests}
						</p>
					{/if}
				</div>

				<div class="rounded-lg border border-border p-4">
					<h3 class="mb-2 text-sm font-semibold text-ink">Stay</h3>
					<div class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
						<div>
							<div class="text-xs text-ink-muted">Check-in</div>
							<div class="text-ink">{formRoomDetail.booking.checkIn}</div>
						</div>
						<div>
							<div class="text-xs text-ink-muted">Check-out</div>
							<div class="text-ink">{formRoomDetail.booking.checkOut}</div>
						</div>
						<div>
							<div class="text-xs text-ink-muted">Occupancy</div>
							<div class="text-ink">{formRoomDetail.booking.occupancy} guests</div>
						</div>
						<div>
							<div class="text-xs text-ink-muted">Rate plan</div>
							<div class="text-ink">{formRoomDetail.ratePlan.name}</div>
						</div>
						<div>
							<div class="text-xs text-ink-muted">Rooms</div>
							<div class="text-ink">{formRoomDetail.bookingRoom.quantity}</div>
						</div>
						{#if formRoomDetail.assignedRooms.length > 0}
							<div>
								<div class="text-xs text-ink-muted">Assigned</div>
								<div class="text-ink">
									{formRoomDetail.assignedRooms.map((r) => r.roomNumber).join(', ')}
								</div>
							</div>
						{/if}
					</div>
				</div>

				<div class="rounded-lg border border-border p-4">
					<div class="mb-2 flex items-center justify-between">
						<h3 class="text-sm font-semibold text-ink">Folio</h3>
						{#if formFolio}
							<Badge
								variant="outline"
								class={formFolio.balanceCentavos > 0
									? 'border-transparent bg-danger/15 text-danger'
									: 'border-transparent bg-ok/15 text-ok'}
							>
								{formFolio.balanceCentavos > 0
									? `Balance due ${peso(formFolio.balanceCentavos)}`
									: 'Settled'}
							</Badge>
						{/if}
					</div>

					{#if formFolio}
						<Table.Root>
							<Table.Body>
								{#each formFolio.charges as c (c.id)}
									<Table.Row class={c.voidedAt ? 'opacity-50' : ''}>
										<Table.Cell class="text-ink-muted">
											<span class={c.voidedAt ? 'line-through' : ''}>
												{c.description}{#if c.quantity > 1}<span class="text-xs">
														× {c.quantity}</span
													>{/if}
											</span>
											{#if c.voidedAt}
												<span class="ml-1.5 text-xs text-danger"
													>Voided{#if c.voidReason}
														— {c.voidReason}{/if}</span
												>
											{/if}
										</Table.Cell>
										<Table.Cell class="text-right text-ink">
											<span class={c.voidedAt ? 'line-through' : ''}>{peso(c.totalCentavos)}</span>
										</Table.Cell>
										<Table.Cell class="w-8 text-right">
											{#if !c.isBaseCharge && !c.voidedAt}
												<form method="POST" action="?/voidCharge" use:enhance>
													<input type="hidden" name="bookingId" value={formRoomDetail.booking.id} />
													<input type="hidden" name="chargeId" value={c.id} />
													<button
														type="submit"
														class="text-xs text-ink-muted underline underline-offset-2 hover:text-danger"
													>
														Void
													</button>
												</form>
											{/if}
										</Table.Cell>
									</Table.Row>
								{/each}
								<Table.Row>
									<Table.Cell class="text-ink-muted">Paid</Table.Cell>
									<Table.Cell class="text-right text-ink"
										>−{peso(formFolio.paidTotalCentavos)}</Table.Cell
									>
									<Table.Cell></Table.Cell>
								</Table.Row>
								<Table.Row>
									<Table.Cell class="font-semibold text-ink">Balance</Table.Cell>
									<Table.Cell class="text-right font-semibold text-ink"
										>{peso(formFolio.balanceCentavos)}</Table.Cell
									>
									<Table.Cell></Table.Cell>
								</Table.Row>
							</Table.Body>
						</Table.Root>

						{#if formFolio.balanceCentavos > 0}
							<div class="mt-3">
								{#if roomPayOpen}
									<PaymentFields
										action="?/recordPayment"
										kind="room"
										id={formRoomDetail.booking.id}
										balanceCentavos={formFolio.balanceCentavos}
										cashier={data.cashier}
										onDone={() => (roomPayOpen = false)}
									/>
									<button
										type="button"
										onclick={() => (roomPayOpen = false)}
										class="mt-1 text-xs text-ink-muted underline underline-offset-2"
									>
										Cancel
									</button>
								{:else}
									<Button size="sm" class="w-full" onclick={() => (roomPayOpen = true)}>
										Take payment ({peso(formFolio.balanceCentavos)} due)
									</Button>
								{/if}
							</div>
						{:else if formFolio.balanceCentavos < 0}
							<div class="mt-3">
								{#if roomRefundOpen}
									<PaymentFields
										action="?/refundPayment"
										kind="room"
										id={formRoomDetail.booking.id}
										balanceCentavos={-formFolio.balanceCentavos}
										cashier={data.cashier}
										mode="refund"
										onDone={() => (roomRefundOpen = false)}
									/>
									<button
										type="button"
										onclick={() => (roomRefundOpen = false)}
										class="mt-1 text-xs text-ink-muted underline underline-offset-2"
									>
										Cancel
									</button>
								{:else}
									<Button
										size="sm"
										variant="outline"
										class="w-full"
										onclick={() => (roomRefundOpen = true)}
									>
										Refund credit ({peso(-formFolio.balanceCentavos)})
									</Button>
								{/if}
							</div>
						{/if}

						{#if formFolio.balanceCentavos > 0 && canChargeCityLedger && formRoomDetail.booking.status === 'checked_in'}
							<div class="mt-3 rounded-lg border border-dashed border-border p-3">
								{#if checkoutCityLedger}
									<form method="POST" action="?/checkOut" use:enhance class="space-y-2">
										<input type="hidden" name="bookingId" value={formRoomDetail.booking.id} />
										<input type="hidden" name="cityLedger" value="1" />
										<p class="text-xs text-ink-muted">
											Move the {peso(formFolio.balanceCentavos)} balance to the Finance city ledger and
											check the guest out.
										</p>
										<Input
											name="billToName"
											placeholder="Bill to (name)"
											required
											class="h-8 text-sm"
										/>
										<Input
											name="billToCompany"
											placeholder="Company (optional)"
											class="h-8 text-sm"
										/>
										<Input
											name="billReference"
											placeholder="PO / reference (optional)"
											class="h-8 text-sm"
										/>
										<Input name="billNotes" placeholder="Note (optional)" class="h-8 text-sm" />
										<div class="flex gap-2">
											<Button type="submit" size="sm" variant="outline" class="flex-1"
												>Charge & check out</Button
											>
											<button
												type="button"
												onclick={() => (checkoutCityLedger = false)}
												class="text-xs text-ink-muted underline underline-offset-2"
											>
												Cancel
											</button>
										</div>
									</form>
								{:else}
									<button
										type="button"
										onclick={() => (checkoutCityLedger = true)}
										class="text-xs font-medium text-ink-muted underline underline-offset-2 hover:text-ink"
									>
										Check out with balance → charge to city ledger
									</button>
								{/if}
							</div>
						{/if}

						<div class="mt-4 border-t border-border pt-3">
							<h4 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
								Add a charge
							</h4>
							{#if data.amenityItemOptions.length > 0}
								<form
									method="POST"
									action="?/addItemCharge"
									use:enhance
									class="flex items-end gap-2"
								>
									<input type="hidden" name="bookingId" value={formRoomDetail.booking.id} />
									<select
										name="amenityItemId"
										required
										class="w-full min-w-0 flex-1 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
									>
										<option value="" disabled selected>Select an item…</option>
										{#each data.amenityItemOptions as item (item.id)}
											<option value={item.id}>{item.name} — {peso(item.priceCentavos)}</option>
										{/each}
									</select>
									<Input name="quantity" type="number" min="1" value="1" class="w-16" />
									<Button type="submit" size="sm">Add</Button>
								</form>
							{:else}
								<p class="text-xs text-ink-muted">
									No sellable items set up yet — add some in
									<a href="{base}/settings/amenity-items" class="underline underline-offset-2">
										Settings → Sellable items
									</a>.
								</p>
							{/if}

							{#if data.lateCheckoutFeePerHourCentavos > 0 || data.earlyCheckInFeePerHourCentavos > 0}
								<div class="mt-3 flex flex-wrap gap-2">
									{#if data.lateCheckoutFeePerHourCentavos > 0}
										<form
											method="POST"
											action="?/addExtensionCharge"
											use:enhance
											class="flex items-center gap-1.5"
										>
											<input type="hidden" name="bookingId" value={formRoomDetail.booking.id} />
											<input type="hidden" name="kind" value="late_checkout" />
											<Input
												name="hours"
												type="number"
												min="0.5"
												step="0.5"
												value="1"
												class="w-16"
											/>
											<Button type="submit" size="sm" variant="outline">+ Late checkout fee</Button>
										</form>
									{/if}
									{#if data.earlyCheckInFeePerHourCentavos > 0}
										<form
											method="POST"
											action="?/addExtensionCharge"
											use:enhance
											class="flex items-center gap-1.5"
										>
											<input type="hidden" name="bookingId" value={formRoomDetail.booking.id} />
											<input type="hidden" name="kind" value="early_check_in" />
											<Input
												name="hours"
												type="number"
												min="0.5"
												step="0.5"
												value="1"
												class="w-16"
											/>
											<Button type="submit" size="sm" variant="outline">+ Early check-in fee</Button
											>
										</form>
									{/if}
								</div>
							{/if}
						</div>
					{/if}
				</div>

				<div class="rounded-lg border border-border p-4">
					<h3 class="mb-2 text-sm font-semibold text-ink">Payments</h3>
					{#if formRoomDetail.payments.length === 0}
						<p class="text-sm text-ink-muted">No payment recorded yet.</p>
					{:else}
						<div class="space-y-2">
							{#each formRoomDetail.payments as p (p.id)}
								{@render paymentRow(p, 'room', formRoomDetail.booking.id)}
							{/each}
						</div>
					{/if}
				</div>

				<div class="rounded-lg border border-border p-4">
					<h3 class="mb-2 text-sm font-semibold text-ink">Status history</h3>
					{#if formRoomDetail.history.length === 0}
						<p class="text-sm text-ink-muted">No status changes recorded yet.</p>
					{:else}
						<div class="space-y-2">
							{#each formRoomDetail.history as h (h.id)}
								<div class="text-sm">
									<span class="text-ink-muted"
										>{h.fromStatus ? humanize(h.fromStatus) : 'created'} →</span
									>
									<span class="text-ink">{humanize(h.toStatus)}</span>
									{#if h.note}<span class="text-ink-muted"> — {h.note}</span>{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={hallDetailDialogOpen}>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-lg">
		{#if formHallBookingDetail}
			<Dialog.Header>
				<Dialog.Title
					>{formHallBookingDetail.hall.name} — {formHallBookingDetail.guest.fullName}</Dialog.Title
				>
				<Dialog.Description>{formHallBookingDetail.hallBooking.eventType}</Dialog.Description>
			</Dialog.Header>

			<div class="space-y-4">
				<div class="rounded-lg border border-border p-4">
					<h3 class="mb-2 text-sm font-semibold text-ink">Guest</h3>
					<div class="text-sm text-ink">{formHallBookingDetail.guest.fullName}</div>
					<div class="text-sm text-ink-muted">{formHallBookingDetail.guest.email}</div>
					{#if formHallBookingDetail.guest.phone}
						<div class="text-sm text-ink-muted">{formHallBookingDetail.guest.phone}</div>
					{/if}
					{#if formHallBookingDetail.guest.specialRequests}
						<p class="mt-2 text-xs text-ink-muted">
							Special requests: {formHallBookingDetail.guest.specialRequests}
						</p>
					{/if}
				</div>

				<div class="rounded-lg border border-border p-4">
					<h3 class="mb-2 text-sm font-semibold text-ink">Event</h3>
					<div class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
						<div>
							<div class="text-xs text-ink-muted">Event date</div>
							<div class="text-ink">{formHallBookingDetail.hallBooking.eventDate}</div>
						</div>
						<div>
							<div class="text-xs text-ink-muted">Time</div>
							<div class="text-ink">
								{formHallBookingDetail.hallBooking.startTime}–{formHallBookingDetail.hallBooking
									.endTime}
							</div>
						</div>
						<div>
							<div class="text-xs text-ink-muted">Guests</div>
							<div class="text-ink">{formHallBookingDetail.hallBooking.guestCount}</div>
						</div>
					</div>
				</div>

				<div class="rounded-lg border border-border p-4">
					<div class="mb-2 flex items-center justify-between">
						<h3 class="text-sm font-semibold text-ink">Folio</h3>
						{#if formHallFolio}
							<Badge
								variant="outline"
								class={formHallFolio.balanceCentavos > 0
									? 'border-transparent bg-danger/15 text-danger'
									: 'border-transparent bg-ok/15 text-ok'}
							>
								{formHallFolio.balanceCentavos > 0
									? `Balance due ${peso(formHallFolio.balanceCentavos)}`
									: 'Settled'}
							</Badge>
						{/if}
					</div>

					{#if formHallFolio}
						<Table.Root>
							<Table.Body>
								{#each formHallFolio.charges as c (c.id)}
									<Table.Row class={c.voidedAt ? 'opacity-50' : ''}>
										<Table.Cell class="text-ink-muted">
											<span class={c.voidedAt ? 'line-through' : ''}>
												{c.description}{#if c.quantity > 1}<span class="text-xs">
														× {c.quantity}</span
													>{/if}
											</span>
											{#if c.voidedAt}
												<span class="ml-1.5 text-xs text-danger"
													>Voided{#if c.voidReason}
														— {c.voidReason}{/if}</span
												>
											{/if}
										</Table.Cell>
										<Table.Cell class="text-right text-ink">
											<span class={c.voidedAt ? 'line-through' : ''}>{peso(c.totalCentavos)}</span>
										</Table.Cell>
										<Table.Cell class="w-8 text-right">
											{#if !c.isBaseCharge && !c.voidedAt}
												<form method="POST" action="?/voidHallCharge" use:enhance>
													<input
														type="hidden"
														name="hallBookingId"
														value={formHallBookingDetail.hallBooking.id}
													/>
													<input type="hidden" name="chargeId" value={c.id} />
													<button
														type="submit"
														class="text-xs text-ink-muted underline underline-offset-2 hover:text-danger"
													>
														Void
													</button>
												</form>
											{/if}
										</Table.Cell>
									</Table.Row>
								{/each}
								<Table.Row>
									<Table.Cell class="text-ink-muted">Paid</Table.Cell>
									<Table.Cell class="text-right text-ink"
										>−{peso(formHallFolio.paidTotalCentavos)}</Table.Cell
									>
									<Table.Cell></Table.Cell>
								</Table.Row>
								<Table.Row>
									<Table.Cell class="font-semibold text-ink">Balance</Table.Cell>
									<Table.Cell class="text-right font-semibold text-ink"
										>{peso(formHallFolio.balanceCentavos)}</Table.Cell
									>
									<Table.Cell></Table.Cell>
								</Table.Row>
							</Table.Body>
						</Table.Root>

						{#if formHallFolio.balanceCentavos > 0}
							<div class="mt-3">
								{#if hallPayOpen}
									<PaymentFields
										action="?/recordPayment"
										kind="hall"
										id={formHallBookingDetail.hallBooking.id}
										balanceCentavos={formHallFolio.balanceCentavos}
										cashier={data.cashier}
										onDone={() => (hallPayOpen = false)}
									/>
									<button
										type="button"
										onclick={() => (hallPayOpen = false)}
										class="mt-1 text-xs text-ink-muted underline underline-offset-2"
									>
										Cancel
									</button>
								{:else}
									<Button size="sm" class="w-full" onclick={() => (hallPayOpen = true)}>
										Take payment ({peso(formHallFolio.balanceCentavos)} due)
									</Button>
								{/if}
							</div>
						{:else if formHallFolio.balanceCentavos < 0}
							<div class="mt-3">
								{#if hallRefundOpen}
									<PaymentFields
										action="?/refundPayment"
										kind="hall"
										id={formHallBookingDetail.hallBooking.id}
										balanceCentavos={-formHallFolio.balanceCentavos}
										cashier={data.cashier}
										mode="refund"
										onDone={() => (hallRefundOpen = false)}
									/>
									<button
										type="button"
										onclick={() => (hallRefundOpen = false)}
										class="mt-1 text-xs text-ink-muted underline underline-offset-2"
									>
										Cancel
									</button>
								{:else}
									<Button
										size="sm"
										variant="outline"
										class="w-full"
										onclick={() => (hallRefundOpen = true)}
									>
										Refund credit ({peso(-formHallFolio.balanceCentavos)})
									</Button>
								{/if}
							</div>
						{/if}

						<div class="mt-4 border-t border-border pt-3">
							<h4 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
								Add a charge
							</h4>
							{#if data.amenityItemOptions.length > 0}
								<form
									method="POST"
									action="?/addHallItemCharge"
									use:enhance
									class="flex items-end gap-2"
								>
									<input
										type="hidden"
										name="hallBookingId"
										value={formHallBookingDetail.hallBooking.id}
									/>
									<select
										name="amenityItemId"
										required
										class="w-full min-w-0 flex-1 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
									>
										<option value="" disabled selected>Select an item…</option>
										{#each data.amenityItemOptions as item (item.id)}
											<option value={item.id}>{item.name} — {peso(item.priceCentavos)}</option>
										{/each}
									</select>
									<Input name="quantity" type="number" min="1" value="1" class="w-16" />
									<Button type="submit" size="sm">Add</Button>
								</form>
							{:else}
								<p class="text-xs text-ink-muted">
									No sellable items set up yet — add some in
									<a href="{base}/settings/amenity-items" class="underline underline-offset-2">
										Settings → Sellable items
									</a>.
								</p>
							{/if}
						</div>
					{/if}
				</div>

				<div class="rounded-lg border border-border p-4">
					<h3 class="mb-2 text-sm font-semibold text-ink">Payments</h3>
					{#if formHallBookingDetail.payments.length === 0}
						<p class="text-sm text-ink-muted">No payment recorded yet.</p>
					{:else}
						<div class="space-y-2">
							{#each formHallBookingDetail.payments as p (p.id)}
								{@render paymentRow(p, 'hall', formHallBookingDetail.hallBooking.id)}
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Sheet.Root bind:open={hallWalkInOpen}>
	<Sheet.Content side="right" class="w-full overflow-y-auto sm:max-w-md">
		<Sheet.Header>
			<Sheet.Title>Walk-in event — {hallWalkInHall?.hallName ?? ''}</Sheet.Title>
		</Sheet.Header>
		<div class="px-4 pb-6">
			<form method="POST" action="?/hallWalkInCreate" use:enhance class="space-y-3">
				<input type="hidden" name="functionHallId" value={hallWalkInHall?.functionHallId ?? ''} />
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="heEventDate">Event date</Label>
						<Input
							id="heEventDate"
							type="date"
							name="eventDate"
							bind:value={heEventDate}
							onchange={fetchHallQuote}
							required
						/>
					</div>
					<div>
						<Label for="heEventType">Event type</Label>
						<Input
							id="heEventType"
							name="eventType"
							placeholder="Birthday"
							required
							maxlength={80}
						/>
					</div>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="heStartTime">Start time</Label>
						<Input
							id="heStartTime"
							type="time"
							name="startTime"
							bind:value={heStartTime}
							onchange={fetchHallQuote}
							required
						/>
					</div>
					<div>
						<Label for="heEndTime">End time</Label>
						<Input
							id="heEndTime"
							type="time"
							name="endTime"
							bind:value={heEndTime}
							onchange={fetchHallQuote}
							required
						/>
					</div>
				</div>
				<div>
					<Label for="heGuestCount">Guest count</Label>
					<Input id="heGuestCount" type="number" min="1" name="guestCount" value="1" required />
				</div>

				<div class="rounded-lg border border-border p-3">
					<h3 class="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
						<ReceiptIcon class="size-4" />
						Rate
					</h3>
					{#if hallQuoteLoading}
						<p class="text-xs text-ink-muted">Pricing…</p>
					{:else if hallQuoteError}
						<p class="text-xs text-danger">{hallQuoteError}</p>
					{:else if hallQuote}
						<div class="space-y-1.5 text-sm">
							<div class="flex justify-between">
								<span class="text-ink-muted">Base ({hallQuote.baseHours}h included)</span>
								<span class="text-ink">{peso(hallQuote.basePriceCentavos)}</span>
							</div>
							{#if hallQuote.extraHours > 0}
								<div class="flex justify-between">
									<span class="text-ink-muted">
										Extra {hallQuote.extraHours}h × {peso(hallQuote.extraHourFeeCentavos)}
									</span>
									<span class="text-ink">{peso(hallQuote.extraHoursCostCentavos)}</span>
								</div>
							{/if}
							{#each hallQuote.fees as fee (fee.name)}
								<div class="flex justify-between">
									<span class="text-ink-muted">{fee.name}</span>
									<span class="text-ink">{peso(fee.amountCentavos)}</span>
								</div>
							{/each}
							<div class="flex justify-between">
								<span class="text-ink-muted">VAT</span>
								<span class="text-ink">{peso(hallQuote.vatCentavos)}</span>
							</div>
							<div class="flex justify-between border-t border-border pt-1.5 font-semibold">
								<span class="text-ink">Total</span>
								<span class="text-ink">{peso(hallQuote.totalCentavos)}</span>
							</div>
						</div>
					{/if}
				</div>

				<div class="border-t border-border pt-3">
					<Label for="heFullName">Full name</Label>
					<Input id="heFullName" name="fullName" required maxlength={160} class="mt-1" />
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="heEmail">Email</Label>
						<Input id="heEmail" name="email" type="email" required />
					</div>
					<div>
						<Label for="hePhone">Phone</Label>
						<Input id="hePhone" name="phone" maxlength={40} />
					</div>
				</div>
				<div>
					<Label for="heSpecialRequests">Special requests</Label>
					<textarea
						id="heSpecialRequests"
						name="specialRequests"
						maxlength={1000}
						rows="2"
						class="w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
					></textarea>
				</div>
				<WalkinPaymentFields
					totalCentavos={hallQuote?.totalCentavos ?? null}
					cashier={data.cashier}
				/>
				<Button type="submit" class="w-full" disabled={!hallQuote || hallQuoteLoading}>
					Create &amp; settle booking
				</Button>
			</form>
		</div>
	</Sheet.Content>
</Sheet.Root>
