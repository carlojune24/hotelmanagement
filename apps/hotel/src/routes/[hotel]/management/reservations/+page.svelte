<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import SearchIcon from '@lucide/svelte/icons/search';
	import CalendarCheckIcon from '@lucide/svelte/icons/calendar-check';
	import BedIcon from '@lucide/svelte/icons/bed';
	import PartyPopperIcon from '@lucide/svelte/icons/party-popper';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import {
		RESERVATION_VIEWS,
		reservationListHref,
		type ReservationListParams
	} from '$lib/reservation-views';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const base = $derived(`/${page.params.hotel}/management`);
	const listBase = $derived(`${base}/reservations`);
	const href = (change: Partial<ReservationListParams>) =>
		reservationListHref(listBase, data.params, change);

	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const statusLabel = (s: string) => s.replace(/_/g, ' ');

	/** Hotel-local `YYYY-MM-DD` → "Sep 23" (formatted as a calendar date, not device time). */
	const day = (d: string, withMonth = true) =>
		new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', {
			...(withMonth ? { month: 'short' } : {}),
			day: 'numeric',
			timeZone: 'UTC'
		});
	const nights = (a: string, b: string) =>
		Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
	function dateRange(start: string, end: string | null): string {
		if (!end) return day(start);
		const sameMonth = start.slice(0, 7) === end.slice(0, 7);
		return `${day(start)} → ${day(end, !sameMonth)}`;
	}
	const booked = (d: Date | string) =>
		new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });

	function statusVariantClass(status: string): string {
		if (['confirmed', 'checked_in', 'checked_out', 'completed'].includes(status)) {
			return 'border-transparent bg-ok/15 text-ok';
		}
		if (['cancelled', 'no_show'].includes(status)) {
			return 'border-transparent bg-danger/15 text-danger';
		}
		return 'border-border bg-surface-2 text-ink-muted';
	}

	// Search goes to the server (it filters every booking, not just this page) — debounced as
	// the user types, replacing history so Back isn't a keystroke-by-keystroke trail.
	let search = $state('');
	let lastQ = '';
	$effect(() => {
		// Keep the box in sync when the URL changes (Back, tab click).
		if (data.params.q !== lastQ) {
			lastQ = data.params.q;
			search = data.params.q;
		}
	});
	let timer: ReturnType<typeof setTimeout> | undefined;
	function onSearchInput() {
		clearTimeout(timer);
		timer = setTimeout(() => {
			const q = search.trim();
			if (q === data.params.q) return;
			lastQ = q;
			goto(href({ q }), { keepFocus: true, noScroll: true, replaceState: true });
		}, 300);
	}

	const firstRow = $derived(data.total === 0 ? 0 : (data.params.page - 1) * data.pageSize + 1);
	const lastRow = $derived(Math.min(data.params.page * data.pageSize, data.total));
	const hasPrev = $derived(data.params.page > 1);
	const hasNext = $derived(lastRow < data.total);

	const emptyText = $derived(
		data.params.q || data.params.type !== 'all'
			? 'No bookings match this search.'
			: {
					upcoming: 'No upcoming arrivals.',
					'in-house': 'Nobody is checked in right now.',
					past: 'No past stays yet.',
					cancelled: 'No cancelled or no-show bookings.',
					all: 'No bookings yet.'
				}[data.params.view]
	);
</script>

<div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
	<div class="mb-5 flex items-center justify-between gap-4">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Reservations</h1>
			<p class="text-sm text-ink-muted">Every room stay and function hall booking.</p>
		</div>
		<Button variant="outline" href="{base}/dashboard">← Dashboard</Button>
	</div>

	<nav
		aria-label="Reservation views"
		class="mb-4 flex gap-1 overflow-x-auto border-b border-border"
	>
		{#each RESERVATION_VIEWS as v (v.key)}
			{@const active = data.params.view === v.key}
			<a
				href={href({ view: v.key })}
				aria-current={active ? 'page' : undefined}
				data-sveltekit-noscroll
				class="-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring {active
					? 'border-brand font-medium text-ink'
					: 'border-transparent text-ink-muted hover:text-ink'}"
			>
				{v.label}
				<span
					class="rounded-full px-1.5 text-xs tabular-nums {active
						? 'bg-brand/10 text-brand'
						: 'bg-surface-2 text-ink-muted'}">{data.counts[v.key]}</span
				>
			</a>
		{/each}
	</nav>

	<div class="mb-4 flex flex-wrap items-center gap-3">
		<div class="relative min-w-48 flex-1">
			<SearchIcon class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
			<Input
				type="search"
				placeholder="Search guest, email, booking code or room…"
				aria-label="Search reservations"
				bind:value={search}
				oninput={onSearchInput}
				class="pl-8"
			/>
		</div>
		<Select.Root
			type="single"
			value={data.params.type}
			onValueChange={(v) =>
				goto(href({ type: v as ReservationListParams['type'] }), { noScroll: true })}
		>
			<Select.Trigger class="w-40 shrink-0">
				{data.params.type === 'all'
					? 'Rooms & halls'
					: data.params.type === 'room'
						? 'Rooms'
						: 'Function halls'}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="Rooms & halls" />
				<Select.Item value="room" label="Rooms" />
				<Select.Item value="hall" label="Function halls" />
			</Select.Content>
		</Select.Root>
	</div>

	<div class="overflow-hidden rounded-xl border border-border">
		{#if data.lines.length === 0}
			<div class="flex flex-col items-center gap-2 p-10 text-center">
				<CalendarCheckIcon class="size-6 text-ink-muted" />
				<p class="text-sm text-ink-muted">{emptyText}</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Guest</Table.Head>
						<Table.Head>Booking</Table.Head>
						<Table.Head>Dates</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="text-right">Total</Table.Head>
						<Table.Head><span class="sr-only">Actions</span></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.lines as line (line.kind + line.id)}
						{@const due =
							line.kind === 'room' && line.status === 'confirmed' && line.startDate < data.today}
						{@const overdue =
							line.status === 'checked_in' && !!line.endDate && line.endDate < data.today}
						<Table.Row
							class="cursor-pointer {line.hasOpenCancellationRequest
								? 'bg-danger/5 hover:bg-danger/10'
								: ''}"
							onclick={() => goto(`${base}/reservations/${line.kind}/${line.id}`)}
						>
							<Table.Cell class="align-top">
								<a
									href="{base}/reservations/{line.kind}/{line.id}"
									onclick={(e) => e.stopPropagation()}
									class="font-medium text-ink hover:underline focus-visible:underline focus-visible:outline-none"
									>{line.guestName}</a
								>
								<div class="text-xs text-ink-muted">
									<span class="font-mono tracking-wide">{line.bookingCode}</span> · booked {booked(
										line.createdAt
									)}
								</div>
							</Table.Cell>
							<Table.Cell class="align-top">
								<div class="flex items-center gap-1.5 text-ink">
									{#if line.kind === 'room'}
										<BedIcon class="size-3.5 shrink-0 text-ink-muted" aria-label="Room" />
										{#if line.roomNumbers}<span class="font-medium">Rm {line.roomNumbers}</span
											><span class="text-ink-muted">·</span>{/if}
									{:else}
										<PartyPopperIcon
											class="size-3.5 shrink-0 text-ink-muted"
											aria-label="Function hall"
										/>
									{/if}
									<span>{line.title}</span>
								</div>
								<div class="text-xs text-ink-muted">{line.subtitle}</div>
							</Table.Cell>
							<Table.Cell class="align-top whitespace-nowrap">
								<div class="text-ink tabular-nums">{dateRange(line.startDate, line.endDate)}</div>
								{#if line.endDate}
									{@const n = nights(line.startDate, line.endDate)}
									<div class="text-xs text-ink-muted">{n} night{n === 1 ? '' : 's'}</div>
								{/if}
							</Table.Cell>
							<Table.Cell class="align-top">
								<Badge variant="outline" class={statusVariantClass(line.status)}>
									{statusLabel(line.status)}
								</Badge>
								{#if due}
									<div class="mt-1 text-xs font-medium text-danger">
										Arrival was due {day(line.startDate)}
									</div>
								{/if}
								{#if overdue}
									<div class="mt-1 text-xs font-medium text-danger">
										Overdue — was due out {day(line.endDate!)}
									</div>
								{/if}
								{#if line.balanceCentavos > 0}
									<div class="mt-1 text-xs font-medium text-danger">
										Balance {peso(line.balanceCentavos)}
									</div>
								{/if}
								{#if line.status === 'pending_payment' && line.orderStatus === 'cancelled'}
									<div class="mt-1 text-xs text-danger">Order cancelled</div>
								{/if}
								{#if line.hasOpenCancellationRequest}
									<div class="mt-1 flex items-center gap-1 text-xs font-medium text-danger">
										<TriangleAlertIcon class="size-3.5" />
										Cancellation requested
									</div>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-right align-top text-ink tabular-nums">
								{peso(line.totalCentavos)}
							</Table.Cell>
							<Table.Cell class="text-right align-top whitespace-nowrap">
								{#if ['confirmed', 'pending_payment'].includes(line.status)}
									<a
										href="{base}/reservations/{line.kind}/{line.id}?action=cancel"
										onclick={(e) => e.stopPropagation()}
										class="text-xs text-ink-muted underline-offset-2 hover:text-danger hover:underline"
									>
										Cancel
									</a>
									{#if line.kind === 'room' && due}
										<span class="mx-1 text-ink-muted/40">·</span>
										<a
											href="{base}/reservations/{line.kind}/{line.id}?action=no-show"
											onclick={(e) => e.stopPropagation()}
											class="text-xs text-ink-muted underline-offset-2 hover:text-danger hover:underline"
										>
											No-show
										</a>
									{/if}
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>

	{#if data.total > 0}
		<div class="mt-3 flex items-center justify-between gap-3 text-sm">
			<span class="text-ink-muted tabular-nums">{firstRow}–{lastRow} of {data.total}</span>
			<div class="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					href={hasPrev ? href({ page: data.params.page - 1 }) : undefined}
					disabled={!hasPrev}
					aria-label="Previous page">‹ Prev</Button
				>
				<Button
					variant="outline"
					size="sm"
					href={hasNext ? href({ page: data.params.page + 1 }) : undefined}
					disabled={!hasNext}
					aria-label="Next page">Next ›</Button
				>
			</div>
		</div>
	{/if}
</div>
