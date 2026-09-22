<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import CheckIcon from '@lucide/svelte/icons/check';
	import type { ActionData, PageData } from './$types';
	import type { HousekeepingHallCell, HousekeepingRoomCell } from '$lib/server/housekeeping';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}/management`);

	type Selected = { kind: 'room'; id: string } | { kind: 'hall'; id: string } | null;
	let selected = $state<Selected>(null);

	const formRoomDetail = $derived(form && 'roomDetail' in form ? form.roomDetail : undefined);
	const formHallDetail = $derived(form && 'hallDetail' in form ? form.hallDetail : undefined);
	const formError = $derived(form && 'error' in form ? form.error : undefined);
	const formDamageError = $derived(form && 'damageError' in form ? form.damageError : undefined);

	const selectedRoom = $derived(
		selected?.kind === 'room' ? (data.rooms.find((r) => r.roomId === selected!.id) ?? null) : null
	);
	const selectedHall = $derived(
		selected?.kind === 'hall'
			? (data.halls.find((h) => h.functionHallId === selected!.id) ?? null)
			: null
	);

	function selectRoom(roomId: string) {
		selected = { kind: 'room', id: roomId };
	}
	function selectHall(functionHallId: string) {
		selected = { kind: 'hall', id: functionHallId };
	}

	// Fetches the damage-report history automatically whenever a new room/hall is
	// selected, via a hidden form posting the matching detail action — same convention
	// Front Desk's own room detail rail uses.
	let roomDetailFormEl = $state<HTMLFormElement>();
	let hallDetailFormEl = $state<HTMLFormElement>();
	let loadedDetailFor = $state<string | null>(null);
	$effect(() => {
		if (!selected) {
			loadedDetailFor = null;
			return;
		}
		const key = `${selected.kind}:${selected.id}`;
		if (key !== loadedDetailFor) {
			loadedDetailFor = key;
			if (selected.kind === 'room') {
				tick().then(() => roomDetailFormEl?.requestSubmit());
			} else {
				tick().then(() => hallDetailFormEl?.requestSubmit());
			}
		}
	});

	const floorGroups = $derived.by(() => {
		const map = new Map<string, HousekeepingRoomCell[]>();
		for (const c of data.rooms) {
			const key = c.floor ?? 'Unassigned floor';
			const list = map.get(key) ?? [];
			list.push(c);
			map.set(key, list);
		}
		return [...map.entries()];
	});

	function cardClass(c: HousekeepingRoomCell | HousekeepingHallCell): string {
		if ('isOutOfOrder' in c && c.isOutOfOrder) return 'border-border bg-surface-2 opacity-70';
		switch (c.status) {
			case 'dirty':
				return 'border-danger/40 bg-danger/10';
			case 'in_progress':
				return 'border-brand/40 bg-brand/10';
			default:
				return 'border-ok/40 bg-ok/10';
		}
	}

	function pillClass(status: string): string {
		switch (status) {
			case 'dirty':
				return 'border-transparent bg-danger/15 text-danger';
			case 'in_progress':
				return 'border-transparent bg-brand/15 text-brand';
			default:
				return 'border-transparent bg-ok/15 text-ok';
		}
	}

	const statusLabel: Record<string, string> = {
		dirty: 'Needs cleaning',
		in_progress: 'In progress',
		clean: 'Clean'
	};
</script>

<div class="flex h-[calc(100dvh-1px)] flex-col">
	<div class="flex items-center justify-between gap-4 border-b border-border px-6 py-3.5">
		<div>
			<h1 class="text-base font-semibold tracking-tight text-ink">Housekeeping</h1>
			<p class="text-xs text-ink-muted">Every room and function hall, by cleanliness.</p>
		</div>
	</div>

	<div
		class="flex flex-wrap items-center gap-4 border-b border-border bg-surface-2 px-6 py-2.5 text-xs text-ink-muted"
	>
		<div class="flex items-center gap-1.5">
			<span class="size-3 rounded border border-danger/40 bg-danger/10"></span>Needs cleaning
		</div>
		<div class="flex items-center gap-1.5">
			<span class="size-3 rounded border border-brand/40 bg-brand/10"></span>In progress
		</div>
		<div class="flex items-center gap-1.5">
			<span class="size-3 rounded border border-ok/40 bg-ok/10"></span>Clean
		</div>
		<div class="flex items-center gap-1.5">
			<span class="size-3 rounded border border-border bg-surface-2 opacity-70"></span>Out of order
		</div>
	</div>

	<div class="flex min-h-0 flex-1">
		<div class="min-w-0 flex-1 overflow-y-auto p-6">
			{#if floorGroups.length === 0}
				<p class="text-sm text-ink-muted">No rooms yet.</p>
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
									onclick={() => selectRoom(c.roomId)}
									class="relative rounded-lg border p-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-sm {cardClass(
										c
									)} {selected?.kind === 'room' && selected.id === c.roomId
										? 'ring-2 ring-brand'
										: ''}"
								>
									{#if c.pendingDamageReportCount > 0}
										<SparklesIcon
											class="absolute top-1.5 right-1.5 size-3 text-danger"
										/>
									{/if}
									<div
										class="text-base font-bold tabular-nums {c.roomTypeColor ? '' : 'text-ink'}"
										style={c.roomTypeColor ? `color: ${c.roomTypeColor}` : undefined}
									>
										{c.roomNumber}
									</div>
									<div class="truncate text-[11px] text-ink-muted">{c.roomTypeName}</div>
								</button>
							{/each}
						</div>
					</div>
				{/each}
			{/if}

			{#if data.halls.length > 0}
				<div class="mt-8 border-t border-border pt-6">
					<h2 class="mb-3 text-xs font-bold tracking-wide text-ink-muted uppercase">
						Function halls
					</h2>
					<div class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2.5">
						{#each data.halls as h (h.functionHallId)}
							<button
								type="button"
								onclick={() => selectHall(h.functionHallId)}
								class="relative rounded-lg border p-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-sm {cardClass(
									h
								)} {selected?.kind === 'hall' && selected.id === h.functionHallId
									? 'ring-2 ring-brand'
									: ''}"
							>
								{#if h.pendingDamageReportCount > 0}
									<SparklesIcon class="absolute top-1.5 right-1.5 size-3 text-danger" />
								{/if}
								<div class="text-sm font-bold text-ink">{h.hallName}</div>
								<Badge variant="outline" class="mt-1 {pillClass(h.status)}">
									{statusLabel[h.status]}
								</Badge>
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<div class="hidden w-96 shrink-0 overflow-y-auto border-l border-border lg:block">
			{#if !selected}
				<div class="p-4">
					<p class="text-sm text-ink-muted">Select a room or function hall to update its status.</p>
				</div>
			{:else if selected.kind === 'room' && selectedRoom}
				{@const detail = formRoomDetail}
				<div class="p-4">
					<button
						type="button"
						onclick={() => (selected = null)}
						class="mb-3 flex items-center gap-1 text-xs font-semibold text-ink-muted hover:text-ink"
					>
						<ChevronLeftIcon class="size-3.5" />
						Back to board
					</button>
					<form
						method="POST"
						action="?/roomDetail"
						use:enhance
						bind:this={roomDetailFormEl}
						class="hidden"
					>
						<input type="hidden" name="roomId" value={selectedRoom.roomId} />
					</form>
					<div class="text-lg font-bold text-ink tabular-nums">Room {selectedRoom.roomNumber}</div>
					<p class="mb-2 text-xs text-ink-muted">{selectedRoom.roomTypeName}</p>
					<div class="mb-4 flex flex-wrap items-center gap-2">
						<Badge variant="outline" class={pillClass(selectedRoom.status)}>
							{statusLabel[selectedRoom.status]}
						</Badge>
						{#if selectedRoom.isOutOfOrder}
							<Badge variant="outline" class="border-transparent bg-surface-2 text-ink-muted">
								Out of order
							</Badge>
						{/if}
					</div>

					{#if formError}
						<p class="mb-2 text-xs text-danger">{formError}</p>
					{/if}

					<div class="mb-4 flex gap-2">
						{#if selectedRoom.status === 'dirty'}
							<form method="POST" action="?/startCleaning" use:enhance class="flex-1">
								<input type="hidden" name="roomId" value={selectedRoom.roomId} />
								<Button type="submit" class="w-full">Start cleaning</Button>
							</form>
						{/if}
						{#if selectedRoom.status === 'dirty' || selectedRoom.status === 'in_progress'}
							<form method="POST" action="?/markClean" use:enhance class="flex-1">
								<input type="hidden" name="roomId" value={selectedRoom.roomId} />
								<Button type="submit" variant="outline" class="w-full gap-1.5">
									<CheckIcon class="size-3.5" />
									Mark clean
								</Button>
							</form>
						{/if}
					</div>

					<div class="border-t border-border pt-3">
						<h4 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
							Report damage
						</h4>
						{#if formDamageError}
							<p class="mb-2 text-xs text-danger">{formDamageError}</p>
						{/if}
						<form
							method="POST"
							action="?/reportDamage"
							use:enhance
							enctype="multipart/form-data"
							class="space-y-2"
						>
							<input type="hidden" name="roomId" value={selectedRoom.roomId} />
							<Input name="description" placeholder="Describe the damage" required class="text-sm" />
							<input
								name="photo"
								type="file"
								accept="image/*"
								capture="environment"
								required
								class="w-full text-xs"
							/>
							<Button type="submit" size="sm" variant="outline" class="w-full">Report damage</Button>
						</form>
					</div>

					{#if detail && detail.damageReports.length > 0}
						<div class="mt-4 border-t border-border pt-3">
							<h4 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
								Damage reports
							</h4>
							<div class="space-y-2">
								{#each detail.damageReports as r (r.id)}
									<div class="rounded-md border border-border p-2.5">
										<img
											src={r.photoUrl}
											alt="Reported damage"
											class="mb-2 max-h-28 rounded object-cover"
										/>
										<p class="text-xs text-ink">{r.description}</p>
										<Badge
											variant="outline"
											class="mt-1 {r.status === 'pending'
												? 'border-transparent bg-danger/15 text-danger'
												: r.status === 'charged'
													? 'border-transparent bg-ok/15 text-ok'
													: 'border-transparent bg-surface-2 text-ink-muted'}"
										>
											{r.status === 'pending'
												? 'Pending'
												: r.status === 'charged'
													? 'Charged'
													: 'Dismissed'}
										</Badge>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{:else if selected.kind === 'hall' && selectedHall}
				{@const detail = formHallDetail}
				<div class="p-4">
					<button
						type="button"
						onclick={() => (selected = null)}
						class="mb-3 flex items-center gap-1 text-xs font-semibold text-ink-muted hover:text-ink"
					>
						<ChevronLeftIcon class="size-3.5" />
						Back to board
					</button>
					<form
						method="POST"
						action="?/hallDetail"
						use:enhance
						bind:this={hallDetailFormEl}
						class="hidden"
					>
						<input type="hidden" name="functionHallId" value={selectedHall.functionHallId} />
					</form>
					<div class="text-lg font-bold text-ink">{selectedHall.hallName}</div>
					<div class="mb-4 flex flex-wrap items-center gap-2">
						<Badge variant="outline" class={pillClass(selectedHall.status)}>
							{statusLabel[selectedHall.status]}
						</Badge>
					</div>

					{#if formError}
						<p class="mb-2 text-xs text-danger">{formError}</p>
					{/if}

					<div class="mb-4 flex gap-2">
						{#if selectedHall.status === 'dirty'}
							<form method="POST" action="?/startCleaningHall" use:enhance class="flex-1">
								<input type="hidden" name="functionHallId" value={selectedHall.functionHallId} />
								<Button type="submit" class="w-full">Start cleaning</Button>
							</form>
						{/if}
						{#if selectedHall.status === 'dirty' || selectedHall.status === 'in_progress'}
							<form method="POST" action="?/markCleanHall" use:enhance class="flex-1">
								<input type="hidden" name="functionHallId" value={selectedHall.functionHallId} />
								<Button type="submit" variant="outline" class="w-full gap-1.5">
									<CheckIcon class="size-3.5" />
									Mark clean
								</Button>
							</form>
						{/if}
					</div>

					<div class="border-t border-border pt-3">
						<h4 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
							Report damage
						</h4>
						{#if formDamageError}
							<p class="mb-2 text-xs text-danger">{formDamageError}</p>
						{/if}
						<form
							method="POST"
							action="?/reportHallDamage"
							use:enhance
							enctype="multipart/form-data"
							class="space-y-2"
						>
							<input type="hidden" name="functionHallId" value={selectedHall.functionHallId} />
							<Input name="description" placeholder="Describe the damage" required class="text-sm" />
							<input
								name="photo"
								type="file"
								accept="image/*"
								capture="environment"
								required
								class="w-full text-xs"
							/>
							<Button type="submit" size="sm" variant="outline" class="w-full">Report damage</Button>
						</form>
					</div>

					{#if detail && detail.damageReports.length > 0}
						<div class="mt-4 border-t border-border pt-3">
							<h4 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
								Damage reports
							</h4>
							<div class="space-y-2">
								{#each detail.damageReports as r (r.id)}
									<div class="rounded-md border border-border p-2.5">
										<img
											src={r.photoUrl}
											alt="Reported damage"
											class="mb-2 max-h-28 rounded object-cover"
										/>
										<p class="text-xs text-ink">{r.description}</p>
										<Badge
											variant="outline"
											class="mt-1 {r.status === 'pending'
												? 'border-transparent bg-danger/15 text-danger'
												: r.status === 'charged'
													? 'border-transparent bg-ok/15 text-ok'
													: 'border-transparent bg-surface-2 text-ink-muted'}"
										>
											{r.status === 'pending'
												? 'Pending'
												: r.status === 'charged'
													? 'Charged'
													: 'Dismissed'}
										</Badge>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>
