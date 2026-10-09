<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import BellRingIcon from '@lucide/svelte/icons/bell-ring';
	import ReceiptTextIcon from '@lucide/svelte/icons/receipt-text';
	import BedDoubleIcon from '@lucide/svelte/icons/bed-double';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChefHatIcon from '@lucide/svelte/icons/chef-hat';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import { RESERVATION_TRANSITIONS } from '$lib/dining-slots';
	import { STAGE_LABEL, type TableView } from '$lib/dining-floor';
	import { ORDER_STATUS_LABEL, formatWait, type OrderStatus } from '$lib/dining-orders';
	import { STAGE_STYLE } from './stage-style';
	import type { PageData } from './$types';

	type Check = PageData['checks'][number];
	type Res = PageData['reservations'][number];

	interface PanelTable {
		id: string;
		name: string;
		seats: number;
		areaName: string | null;
	}

	let {
		open = $bindable(false),
		table,
		view,
		check,
		others,
		base,
		venueId,
		canWrite,
		canClear,
		nowMs,
		fmtTime,
		onsettle,
		onclear
	}: {
		open: boolean;
		table: PanelTable | null;
		view: TableView<Res> | null;
		check: Check | null;
		/** Other tables, for moving a reservation. */
		others: { id: string; name: string; seats: number }[];
		base: string;
		venueId: string;
		canWrite: boolean;
		canClear: boolean;
		nowMs: number;
		fmtTime: (iso: string) => string;
		onsettle: (check: Check) => void;
		onclear: (check: Check) => void;
	} = $props();

	const peso = (c: number) =>
		`₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	const ACTIONS: Record<string, { label: string; variant: 'default' | 'outline' | 'destructive' }> = {
		seated: { label: 'Seat', variant: 'default' },
		completed: { label: 'Complete', variant: 'default' },
		confirmed: { label: 'Confirm', variant: 'outline' },
		no_show: { label: 'No-show', variant: 'outline' },
		cancelled: { label: 'Cancel', variant: 'destructive' }
	};

	const res = $derived(view?.reservation ?? null);
	const seatedFor = $derived(view?.seatedSince ? formatWait(Math.max(0, Math.floor((nowMs - view.seatedSince.getTime()) / 60_000))) : '');
	// The printed bill lives in the shared print shell, outside /management.
	const billHref = $derived(check ? `${base.split('/management')[0]}/print/bill/check/${check.id}?auto=1` : '#');
	const newOrderHref = $derived(table ? `${base}/orders?newOrder=1&venue=${venueId}&table=${table.id}` : '#');
	let moveTo = $state('');
	// A choice made on one table must not carry over to the next one opened.
	$effect(() => {
		void table?.id;
		moveTo = '';
	});
	const moveLabel = $derived(others.find((o) => o.id === moveTo)?.name ?? 'Move to…');

	const STATUS_TONE: Record<string, string> = { ready: 'font-semibold text-ink', served: 'text-ink-muted', cancelled: 'text-ink-muted line-through' };
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="right" class="flex w-full flex-col gap-0 p-0 sm:max-w-md">
		{#if table && view}
			<Sheet.Header class="border-b border-border py-4 pr-14 pl-5">
				<div class="flex flex-wrap items-center gap-2">
					<Sheet.Title class="text-xl">Table {table.name}</Sheet.Title>
					<Badge variant="outline" class="gap-1.5 text-ink">
						<span class="size-1.5 rounded-full {STAGE_STYLE[view.stage].dot}" aria-hidden="true"></span>{STAGE_LABEL[view.stage]}
					</Badge>
				</div>
				<Sheet.Description>
					{table.seats} seats{table.areaName ? ` · ${table.areaName}` : ''}{seatedFor ? ` · seated ${seatedFor}` : ''}
				</Sheet.Description>
			</Sheet.Header>

			<div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
				{#if view.foodReady > 0}
					<p class="flex items-center gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm font-medium text-ink" role="status">
						<BellRingIcon class="size-4 shrink-0 text-warning" aria-hidden="true" />
						{view.foodReady} {view.foodReady === 1 ? 'order is' : 'orders are'} ready. Take {view.foodReady === 1 ? 'it' : 'them'} to the table.
					</p>
				{/if}
				{#if view.qrWaiting > 0}
					<p class="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink">
						{view.qrWaiting} QR {view.qrWaiting === 1 ? 'order is' : 'orders are'} waiting for you to accept on the
						<a class="font-medium underline" href="{base}/orders">Orders</a> tab.
					</p>
				{/if}
				{#if check?.billRequestedAt}
					<p class="flex items-center gap-2 text-sm font-medium text-ink">
						<ReceiptTextIcon class="size-4 text-warning" aria-hidden="true" /> Asked for the bill at {fmtTime(check.billRequestedAt)}
					</p>
				{/if}

				<!-- The table's orders -->
				{#if check}
					<section aria-labelledby="orders-h">
						<h3 id="orders-h" class="mb-2 text-sm font-semibold text-ink">Orders on this table</h3>
						<ul class="divide-y divide-border overflow-hidden rounded-xl border border-border">
							{#each check.orders as o (o.id)}
								<li class="px-3 py-2.5">
									<div class="flex items-start justify-between gap-3">
										<div class="min-w-0">
											<p class="flex items-center gap-1.5">
												<span class="font-mono text-sm font-semibold text-ink">{o.code}</span>
												{#if o.source === 'qr'}<span class="rounded border border-border px-1 text-[10px] font-semibold text-ink-muted uppercase">QR</span>{/if}
											</p>
											<p class="text-xs {STATUS_TONE[o.status] ?? 'text-ink-muted'}">
												{ORDER_STATUS_LABEL[o.status as OrderStatus] ?? o.status}{#if o.status !== 'cancelled'}
													· {o.paymentStatus === 'paid' ? 'paid' : o.paymentStatus === 'room_charged' ? 'on the room bill' : 'unpaid'}{/if}
											</p>
										</div>
										<span class="shrink-0 text-sm tabular-nums text-ink">{peso(o.totalCentavos)}</span>
									</div>
									{#if o.stations.length > 1 && (o.status === 'new' || o.status === 'accepted' || o.status === 'preparing')}
										<p class="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-muted">
											{#each o.stations as g (g.label)}
												<span class="inline-flex items-center gap-1 {g.state === 'ready' ? 'text-ink' : ''}">
													{#if g.state === 'ready'}<CheckIcon class="size-3" aria-hidden="true" />{/if}
													{g.label} · {g.state === 'ready' ? 'ready' : g.state === 'cooking' ? 'cooking' : 'waiting'}
												</span>
											{/each}
										</p>
									{:else if o.status === 'new' || o.status === 'accepted' || o.status === 'preparing'}
										<p class="mt-1.5 inline-flex items-center gap-1 text-xs text-ink-muted">
											<ChefHatIcon class="size-3" aria-hidden="true" />
											{o.status === 'preparing' ? 'With the kitchen' : 'Waiting for the kitchen to start'}
										</p>
									{/if}
									{#if o.status === 'ready' && canWrite}
										<form method="POST" action="?/serve" use:enhance class="mt-2">
											<input type="hidden" name="orderId" value={o.id} />
											<Button type="submit" size="sm" class="h-10 w-full">Mark served</Button>
										</form>
									{/if}
								</li>
							{:else}
								<li class="px-3 py-4 text-center text-sm text-ink-muted">No orders yet.</li>
							{/each}
						</ul>
						<div class="mt-3 flex items-baseline justify-between">
							<span class="text-sm text-ink-muted">Still to pay</span>
							<span class="text-xl font-semibold tabular-nums text-ink">{peso(check.unpaidCentavos)}</span>
						</div>
					</section>
				{/if}

				<!-- A reservation on this table -->
				{#if res}
					<section aria-labelledby="res-h" class="space-y-2">
						<h3 id="res-h" class="text-sm font-semibold text-ink">Reservation</h3>
						<div class="rounded-xl border border-border p-3">
							<div class="flex items-center justify-between gap-2">
								<p class="text-sm font-medium text-ink">{res.guestName}</p>
								<Badge variant={res.status === 'seated' ? 'secondary' : 'outline'}>{res.status === 'seated' ? 'Seated' : 'Reserved'}</Badge>
							</div>
							<p class="mt-0.5 text-xs text-ink-muted">
								<span class="tabular-nums">{fmtTime(res.startsAt)}–{fmtTime(res.endsAt)}</span> · party of {res.partySize}{#if res.guestPhone} · {res.guestPhone}{/if}
							</p>
							<p class="font-mono text-xs text-ink-muted">{res.code}</p>
							{#if res.bookingCode}
								<p class="mt-1 flex items-center gap-1 text-xs text-ink-muted">
									<BedDoubleIcon class="size-3" aria-hidden="true" /> In-house, booking <span class="font-mono">{res.bookingCode}</span>
								</p>
							{/if}
							{#if res.remarks}<p class="mt-2 rounded-md bg-surface-2 px-2 py-1 text-xs text-ink">{res.remarks}</p>{/if}

							{#if canWrite}
								<div class="mt-3 flex flex-wrap gap-1.5">
									{#each RESERVATION_TRANSITIONS[res.status] ?? [] as to (to)}
										{#if ACTIONS[to] && !(to === 'confirmed' && res.status !== 'pending')}
											<form method="POST" action="?/setStatus" use:enhance>
												<input type="hidden" name="reservationId" value={res.id} />
												<input type="hidden" name="to" value={to} />
												<Button type="submit" size="sm" class="h-9" variant={ACTIONS[to].variant}>{ACTIONS[to].label}</Button>
											</form>
										{/if}
									{/each}
								</div>
								{#if res.status !== 'completed' && others.length > 0}
									<form method="POST" action="?/changeTable" use:enhance class="mt-3 flex items-center gap-1.5 border-t border-border pt-3">
										<input type="hidden" name="reservationId" value={res.id} />
										<Select.Root type="single" name="tableId" bind:value={moveTo}>
											<Select.Trigger class="h-9 flex-1 text-sm" aria-label="Move this booking to another table">{moveLabel}</Select.Trigger>
											<Select.Content>
												{#each others as other (other.id)}
													<Select.Item value={other.id} label="{other.name} ({other.seats})" />
												{/each}
											</Select.Content>
										</Select.Root>
										<Button type="submit" size="sm" variant="outline" class="h-9" disabled={!moveTo}>Move</Button>
									</form>
								{/if}
							{/if}
						</div>
					</section>
				{:else if view.next}
					<p class="text-sm text-ink-muted">
						Next booking: <span class="tabular-nums text-ink">{fmtTime(view.next.startsAt)}</span>, {view.next.guestName} ×{view.next.partySize}
					</p>
				{/if}

				{#if !check && !res && !view.next && view.qrWaiting === 0}
					<p class="text-sm text-ink-muted">Nothing on this table. Start an order to seat guests here.</p>
				{/if}
			</div>

			<!-- One clear next step for where the table is -->
			{#if canWrite}
				<Sheet.Footer class="gap-2 border-t border-border px-5 py-4 sm:flex-col sm:space-x-0">
					{#if check && view.stage === 'needs_payment' && check.awaitingAcceptance === 0}
						<Button class="h-12 w-full text-base" onclick={() => onsettle(check)}>Settle &amp; close · {peso(check.unpaidCentavos)}</Button>
					{:else if check && view.stage === 'ready_to_clear'}
						<form method="POST" action="?/closeTable" use:enhance class="w-full">
							<input type="hidden" name="checkId" value={check.id} />
							<Button type="submit" class="h-12 w-full text-base">Close table</Button>
						</form>
					{:else if check && check.unpaidCount > 0 && check.awaitingAcceptance === 0}
						<Button class="h-12 w-full text-base" variant="outline" onclick={() => onsettle(check)}>Settle early · {peso(check.unpaidCentavos)}</Button>
					{/if}

					{#if check && check.liveCount > 0}
						<Button href={billHref} target="_blank" rel="noopener" variant="outline" class="h-11 w-full">
							<PrinterIcon class="size-4" aria-hidden="true" /> Print bill
						</Button>
					{/if}

					<div class="flex w-full gap-2">
						<Button href={newOrderHref} variant={check ? 'outline' : 'default'} class="h-11 flex-1">
							<PlusIcon class="size-4" /> {check ? 'Add order' : 'New order'}
						</Button>
						{#if check && !check.billRequestedAt && check.unpaidCount > 0}
							<form method="POST" action="?/billRequested" use:enhance class="flex-1">
								<input type="hidden" name="checkId" value={check.id} />
								<Button type="submit" variant="outline" class="h-11 w-full">Asked for bill</Button>
							</form>
						{/if}
						{#if check && canClear}
							<DropdownMenu.Root>
								<DropdownMenu.Trigger>
									{#snippet child({ props })}
										<Button {...props} variant="ghost" size="icon" class="size-11 shrink-0" aria-label="More for table {table.name}">
											<EllipsisIcon class="size-5" />
										</Button>
									{/snippet}
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end">
									<DropdownMenu.Item variant="destructive" onSelect={() => onclear(check)}>Force clear this table…</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						{/if}
					</div>
				</Sheet.Footer>
			{/if}
		{/if}
	</Sheet.Content>
</Sheet.Root>
