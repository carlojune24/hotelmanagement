<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { RoomTypeAvailabilityCalendar } from '$lib/server/availability';
	import type { HallAvailabilityCalendar } from '$lib/server/hall-availability';

	export interface AvailabilityTarget {
		kind: 'roomType' | 'hall';
		id: string;
		name: string;
	}

	let {
		open = $bindable(false),
		target,
		base,
		businessDate
	}: {
		open: boolean;
		target: AvailabilityTarget | null;
		base: string;
		businessDate: string;
	} = $props();

	const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

	function addDays(dateStr: string, n: number): string {
		const d = new Date(`${dateStr}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() + n);
		return d.toISOString().slice(0, 10);
	}

	let viewYear = $state(0);
	let viewMonth = $state(0); // 0-indexed
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let roomTypeData = $state<RoomTypeAvailabilityCalendar | null>(null);
	let hallData = $state<HallAvailabilityCalendar | null>(null);
	let expandedDay = $state<string | null>(null);
	// Bumped on every fetch this effect starts; a response only gets applied if it's
	// still the most recent one requested — otherwise switching targets/months faster
	// than a slow request resolves can let a stale response overwrite a newer one
	// (e.g. clicking "asdasd" then quickly "Deluxe twin": if asdasd's fetch resolves
	// after Deluxe twin's, its data would silently clobber the wrong room type's view).
	let requestSeq = 0;

	function resetToCurrentMonth() {
		const d = new Date(`${businessDate}T00:00:00Z`);
		viewYear = d.getUTCFullYear();
		viewMonth = d.getUTCMonth();
	}

	// Jump to today's month whenever a fresh target is opened.
	$effect(() => {
		if (open && target) {
			resetToCurrentMonth();
			expandedDay = null;
		}
	});

	function shiftMonth(delta: number) {
		let m = viewMonth + delta;
		let y = viewYear;
		while (m < 0) {
			m += 12;
			y -= 1;
		}
		while (m > 11) {
			m -= 12;
			y += 1;
		}
		viewMonth = m;
		viewYear = y;
		expandedDay = null;
	}

	const monthLabel = $derived(
		new Date(Date.UTC(viewYear, viewMonth, 1)).toLocaleDateString(undefined, {
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		})
	);

	/** A calendar grid: full weeks only (no trailing empty row), each cell flagged
	 *  `inMonth` so padding days from the adjacent month render muted. */
	const monthGrid = $derived.by(() => {
		if (!open || !target) return [];
		const first = new Date(Date.UTC(viewYear, viewMonth, 1));
		const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
		const startWeekday = first.getUTCDay();
		const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
		const gridStart = addDays(first.toISOString().slice(0, 10), -startWeekday);
		return Array.from({ length: totalCells }, (_, i) => {
			const date = addDays(gridStart, i);
			return { date, inMonth: new Date(`${date}T00:00:00Z`).getUTCMonth() === viewMonth };
		});
	});

	$effect(() => {
		if (!open || !target || monthGrid.length === 0) return;
		const t = target;
		const seq = ++requestSeq;
		const gridDates = monthGrid.map((c) => c.date);
		const from = gridDates[0]!;
		const lastGridDay = gridDates[gridDates.length - 1]!;
		loading = true;
		loadError = null;
		const path =
			t.kind === 'roomType'
				? // Room-type endpoint is half-open — pass the day after the grid's last cell.
					`${base}/front-desk/api/room-type-calendar?roomTypeId=${t.id}&from=${from}&to=${addDays(lastGridDay, 1)}`
				: // Hall endpoint is inclusive of `to`.
					`${base}/front-desk/api/hall-calendar?hallId=${t.id}&from=${from}&to=${lastGridDay}`;
		fetch(path)
			.then((res) => {
				if (!res.ok) throw new Error('Could not load availability.');
				return res.json();
			})
			.then((json) => {
				if (seq !== requestSeq) return; // superseded by a newer request
				if (t.kind === 'roomType') {
					roomTypeData = json;
					hallData = null;
				} else {
					hallData = json;
					roomTypeData = null;
				}
			})
			.catch((e) => {
				if (seq !== requestSeq) return;
				loadError = e instanceof Error ? e.message : 'Could not load availability.';
			})
			.finally(() => {
				if (seq === requestSeq) loading = false;
			});
	});

	type RoomDayStatus = 'occupied' | 'reserved' | 'open';

	/** Occupied wins over reserved: if anyone covering this day is actually checked in,
	 *  that's the fact that matters most to a front-desk agent quoting a walk-in. */
	function roomDayStatus(date: string): { status: RoomDayStatus; guestNames: string[] } {
		if (!roomTypeData) return { status: 'open', guestNames: [] };
		const covering = roomTypeData.bars.filter((b) => b.checkIn <= date && date < b.checkOut);
		const totalRooms = Math.max(roomTypeData.totalRooms, 1);
		if (covering.length < totalRooms) return { status: 'open', guestNames: [] };
		const status: RoomDayStatus = covering.some((b) => b.status === 'checked_in')
			? 'occupied'
			: 'reserved';
		return { status, guestNames: covering.map((b) => b.guestName) };
	}

	const ROOM_DAY_CLASS: Record<RoomDayStatus, string> = {
		occupied: 'border-ok/40 bg-ok/10',
		reserved: 'border-dashed border-brand/50',
		open: 'border-border'
	};
	const ROOM_DAY_LABEL: Record<RoomDayStatus, string> = {
		occupied: 'Occupied',
		reserved: 'Reserved',
		open: 'Open'
	};

	const hallEventsByDay = $derived.by(() => {
		const map = new Map<string, NonNullable<typeof hallData>['events']>();
		for (const e of hallData?.events ?? []) {
			const list = map.get(e.eventDate) ?? [];
			list.push(e);
			map.set(e.eventDate, list);
		}
		return map;
	});
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="right" class="w-full overflow-y-auto sm:max-w-3xl">
		<Sheet.Header>
			<Sheet.Title>Availability — {target?.name ?? ''}</Sheet.Title>
		</Sheet.Header>
		<div class="px-4 pb-6">
			<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
				<div class="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
					{#if target?.kind === 'roomType'}
						<div class="flex items-center gap-1.5">
							<span class="size-3 rounded border border-ok/40 bg-ok/10"></span>Occupied
						</div>
						<div class="flex items-center gap-1.5">
							<span class="size-3 rounded border border-dashed border-brand/50"></span>Reserved
						</div>
						<div class="flex items-center gap-1.5">
							<span class="size-3 rounded border border-border"></span>Open
						</div>
					{:else}
						<div class="flex items-center gap-1.5">
							<span class="size-3 rounded border border-ok/40 bg-ok/10"></span>Booked
						</div>
						<div class="flex items-center gap-1.5">
							<span class="size-3 rounded border border-border"></span>Open
						</div>
					{/if}
				</div>
				<div class="flex items-center gap-1.5">
					<Button variant="outline" size="icon-sm" onclick={() => shiftMonth(-1)}>
						<ChevronLeftIcon class="size-4" />
					</Button>
					<span class="min-w-32 text-center text-sm font-semibold text-ink">{monthLabel}</span>
					<Button variant="outline" size="icon-sm" onclick={() => shiftMonth(1)}>
						<ChevronRightIcon class="size-4" />
					</Button>
					<Button variant="outline" size="sm" onclick={resetToCurrentMonth}>Today</Button>
				</div>
			</div>

			{#if loading}
				<div class="grid grid-cols-7 gap-1.5">
					{#each { length: 35 } as _, i (i)}
						<Skeleton class="aspect-square w-full" />
					{/each}
				</div>
			{:else if loadError}
				<p class="text-sm text-danger">{loadError}</p>
			{:else if target?.kind === 'roomType' && roomTypeData}
				{#if roomTypeData.totalRooms === 0}
					<p class="py-6 text-center text-sm text-ink-muted">No active rooms of this type.</p>
				{:else}
					<div class="mb-1.5 grid grid-cols-7 gap-1.5">
						{#each WEEKDAY_LABELS as w (w)}
							<div class="text-center text-xs font-semibold tracking-wide text-ink-muted uppercase">
								{w}
							</div>
						{/each}
					</div>
					<div class="grid grid-cols-7 gap-1.5">
						{#each monthGrid as cell (cell.date)}
							{@const { status, guestNames } = roomDayStatus(cell.date)}
							<div
								class="aspect-square rounded-lg border p-1.5 {ROOM_DAY_CLASS[status]} {cell.inMonth
									? ''
									: 'opacity-35'} {cell.date === businessDate
									? 'ring-2 ring-brand ring-offset-1'
									: ''}"
								title={status === 'open'
									? 'Open'
									: `${ROOM_DAY_LABEL[status]} — ${guestNames.join(', ')}`}
							>
								<span class="text-xs font-medium tabular-nums text-ink">
									{Number(cell.date.slice(8, 10))}
								</span>
							</div>
						{/each}
					</div>
					<p class="mt-3 text-xs text-ink-muted">
						{roomTypeData.totalRooms} room{roomTypeData.totalRooms === 1 ? '' : 's'} of this type total.
					</p>
				{/if}
			{:else if target?.kind === 'hall' && hallData}
				<div class="mb-1.5 grid grid-cols-7 gap-1.5">
					{#each WEEKDAY_LABELS as w (w)}
						<div class="text-center text-xs font-semibold tracking-wide text-ink-muted uppercase">
							{w}
						</div>
					{/each}
				</div>
				<div class="grid grid-cols-7 gap-1.5">
					{#each monthGrid as cell (cell.date)}
						{@const events = hallEventsByDay.get(cell.date) ?? []}
						<button
							type="button"
							disabled={events.length === 0}
							onclick={() => (expandedDay = expandedDay === cell.date ? null : cell.date)}
							class="relative aspect-square rounded-lg border p-1.5 text-left {events.length > 0
								? 'border-ok/40 bg-ok/10'
								: 'border-border'} {cell.inMonth ? '' : 'opacity-35'} {cell.date === businessDate
								? 'ring-2 ring-brand ring-offset-1'
								: ''} {expandedDay === cell.date ? 'ring-2 ring-brand' : ''}"
							title={events.length > 0
								? `${events.length} event${events.length === 1 ? '' : 's'}`
								: 'Open'}
						>
							<span class="text-xs font-medium tabular-nums text-ink">
								{Number(cell.date.slice(8, 10))}
							</span>
							{#if events.length > 1}
								<span
									class="absolute right-1 bottom-1 rounded-full bg-brand px-1 text-[9px] text-white"
									>{events.length}</span
								>
							{/if}
						</button>
					{/each}
				</div>
				{#if expandedDay}
					{@const events = hallEventsByDay.get(expandedDay) ?? []}
					<div class="mt-3 space-y-1.5 rounded-lg border border-border p-3">
						<p class="text-xs font-semibold text-ink">
							{new Date(`${expandedDay}T00:00:00Z`).toLocaleDateString(undefined, {
								dateStyle: 'medium',
								timeZone: 'UTC'
							})}
						</p>
						{#each events as e (e.hallBookingId)}
							<div class="text-sm text-ink">
								{e.startTime.slice(0, 5)}–{e.endTime.slice(0, 5)} · {e.eventType} · {e.guestName}
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>
