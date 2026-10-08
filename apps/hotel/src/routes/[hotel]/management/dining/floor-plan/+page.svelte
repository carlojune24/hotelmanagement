<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import UsersIcon from '@lucide/svelte/icons/users';
	import ArmchairIcon from '@lucide/svelte/icons/armchair';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import BedDoubleIcon from '@lucide/svelte/icons/bed-double';
	import { RESERVATION_TRANSITIONS, zonedToUtc } from '$lib/dining-slots';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const CELL = 24; // px per grid cell — keep in step with GRID_COLS on the server
	const GRID_COLS = 30;

	const base = $derived(`/${page.params.hotel}/management/dining`);
	const tz = $derived(data.timezone);

	let mode = $state<'service' | 'edit'>('service');
	let time = $state(data.nowLocal.time);
	let highlight = $state<string[]>([]);
	let moveTo = $state<Record<string, string>>({});

	const at = $derived(zonedToUtc(data.date, time, tz));
	const turnMs = $derived((data.venue?.turnMinutes ?? 90) * 60_000);

	const fmtTime = (iso: string) =>
		new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso));
	const dateLabel = $derived(
		new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(
			new Date(`${data.date}T00:00:00Z`)
		)
	);

	// Dragged positions override what the server sent until the next load.
	let positions = $state<Record<string, { x: number; y: number }>>({});
	const tableList = $derived(data.tables.map((t) => ({ ...t, ...(positions[t.id] ?? {}) })));

	function size(seats: number) {
		if (seats <= 2) return { w: 3, h: 3 };
		if (seats <= 4) return { w: 4, h: 3 };
		if (seats <= 6) return { w: 5, h: 3 };
		if (seats <= 8) return { w: 6, h: 4 };
		return { w: 7, h: 4 };
	}
	const canvasRows = $derived(Math.max(16, ...tableList.map((t) => t.y + size(t.seats).h + 3)));

	type TableState =
		| { kind: 'free'; next: (typeof data.reservations)[number] | null }
		| { kind: 'held' | 'seated'; res: (typeof data.reservations)[number] };

	function stateFor(tableId: string): TableState {
		const mine = data.reservations.filter((r) => r.tableIds.includes(tableId));
		const seated = mine.find((r) => r.status === 'seated' && new Date(r.startsAt) <= at);
		if (seated) return { kind: 'seated', res: seated };
		const held = mine.find(
			(r) =>
				(r.status === 'pending' || r.status === 'confirmed') &&
				new Date(r.startsAt).getTime() < at.getTime() + turnMs &&
				new Date(r.endsAt) > at
		);
		if (held) return { kind: 'held', res: held };
		const next = mine.find((r) => (r.status === 'pending' || r.status === 'confirmed') && new Date(r.startsAt) > at);
		return { kind: 'free', next: next ?? null };
	}

	const STATE_LABEL = { free: 'Free', held: 'Reserved', seated: 'Seated' } as const;
	const tableName = (id: string) => data.tables.find((t) => t.id === id)?.name ?? '?';

	const ACTIONS: Record<string, { label: string; variant: 'default' | 'outline' | 'destructive' }> = {
		seated: { label: 'Seat', variant: 'default' },
		completed: { label: 'Complete', variant: 'default' },
		confirmed: { label: 'Confirm', variant: 'outline' },
		no_show: { label: 'No-show', variant: 'outline' },
		cancelled: { label: 'Cancel', variant: 'destructive' }
	};

	// ---- navigation (venue / date) -------------------------------------------------
	function go(next: { venue?: string; date?: string }) {
		const q = new URLSearchParams();
		q.set('venue', next.venue ?? data.venue?.id ?? '');
		q.set('date', next.date ?? data.date);
		goto(`?${q}`, { keepFocus: true, noScroll: true });
	}
	function jumpToNow() {
		const n = data.nowLocal;
		time = n.time;
		if (n.date !== data.date) go({ date: n.date });
	}

	// ---- editing -------------------------------------------------------------------
	let sheet = $state<{ open: boolean; table: (typeof data.tables)[number] | null }>({ open: false, table: null });

	let drag: { id: string; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null = null;

	function onPointerDown(e: PointerEvent, t: (typeof tableList)[number]) {
		if (mode !== 'edit') return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		drag = { id: t.id, startX: e.clientX, startY: e.clientY, originX: t.x, originY: t.y, moved: false };
	}
	function onPointerMove(e: PointerEvent, t: (typeof tableList)[number]) {
		if (!drag || drag.id !== t.id) return;
		const dx = e.clientX - drag.startX;
		const dy = e.clientY - drag.startY;
		if (!drag.moved && Math.hypot(dx, dy) < 4) return;
		drag.moved = true;
		const s = size(t.seats);
		const x = Math.min(GRID_COLS - s.w, Math.max(0, drag.originX + Math.round(dx / CELL)));
		const y = Math.max(0, drag.originY + Math.round(dy / CELL));
		positions[t.id] = { x, y };
	}
	async function onPointerUp(t: (typeof tableList)[number]) {
		if (!drag || drag.id !== t.id) return;
		const { moved } = drag;
		drag = null;
		if (!moved) {
			sheet = { open: true, table: data.tables.find((d) => d.id === t.id) ?? null };
			return;
		}
		const pos = positions[t.id]!;
		const fd = new FormData();
		fd.set('tableId', t.id);
		fd.set('x', String(pos.x));
		fd.set('y', String(pos.y));
		try {
			const res = await fetch('?/moveTable', { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true' } });
			if (!res.ok) throw new Error();
			const json = await res.json();
			if (json.type === 'failure') throw new Error();
		} catch {
			delete positions[t.id];
			toast.error('Could not save that position. Try again.');
		}
	}

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) {
			toast.success(form.ok);
			sheet.open = false;
		}
	});
</script>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	{#if data.venues.length === 0}
		<div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
			<ArmchairIcon class="size-6 text-ink-muted" />
			<p class="text-sm text-ink-muted">Add a venue first, then lay out its tables here.</p>
			<Button href="{base}/settings" variant="outline">Set up venues</Button>
		</div>
	{:else if data.venue}
		<!-- Controls -->
		<div class="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3">
			{#if data.venues.length > 1}
				<div>
					<Label for="fpVenue" class="text-xs">Venue</Label>
					<Select.Root type="single" value={data.venue.id} onValueChange={(v) => go({ venue: v })}>
						<Select.Trigger id="fpVenue" class="mt-1 w-48">{data.venue.title}</Select.Trigger>
						<Select.Content>
							{#each data.venues as v (v.id)}
								<Select.Item value={v.id} label={v.title} />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/if}

			<div>
				<Label for="fpDate" class="text-xs">Date</Label>
				<Input id="fpDate" type="date" value={data.date} onchange={(e) => e.currentTarget.value && go({ date: e.currentTarget.value })} class="mt-1 w-40" />
			</div>
			<div>
				<Label for="fpTime" class="text-xs">Time</Label>
				<Input id="fpTime" type="time" bind:value={time} class="mt-1 w-32" />
			</div>
			<Button variant="outline" onclick={jumpToNow}><ClockIcon class="size-4" /> Now</Button>

			<div class="ml-auto flex items-center gap-3">
				{#if data.canManageMenu}
					<Tabs.Root bind:value={mode}>
						<Tabs.List>
							<Tabs.Trigger value="service">Service</Tabs.Trigger>
							<Tabs.Trigger value="edit">Edit layout</Tabs.Trigger>
						</Tabs.List>
					</Tabs.Root>
				{/if}
				{#if mode === 'edit'}
					<Button onclick={() => (sheet = { open: true, table: null })}>
						<PlusIcon class="size-4" /> Add table
					</Button>
				{/if}
			</div>
		</div>

		<p class="mb-3 text-sm text-ink-muted">
			{#if mode === 'service'}
				{dateLabel}, at <span class="tabular-nums text-ink">{fmtTime(at.toISOString())}</span>. A table shows as
				reserved if a booking starts within {data.venue.turnMinutes} minutes.
			{:else}
				Drag a table to move it. Click one to rename it, change its seats, or remove it.
			{/if}
		</p>

		<div class="grid gap-5 lg:grid-cols-[1fr_20rem]">
			<!-- Plan canvas -->
			<div class="overflow-auto rounded-xl border border-border bg-surface">
				{#if data.tables.length === 0}
					<div class="flex flex-col items-center gap-2 p-14 text-center">
						<ArmchairIcon class="size-6 text-ink-muted" />
						<p class="text-sm text-ink-muted">No tables in {data.venue.title} yet.</p>
						{#if data.canManageMenu}
							<Button onclick={() => { mode = 'edit'; sheet = { open: true, table: null }; }}>
								<PlusIcon class="size-4" /> Add the first table
							</Button>
						{/if}
					</div>
				{:else}
					<div
						class="relative"
						style="width: {GRID_COLS * CELL}px; height: {canvasRows * CELL}px; background-image: radial-gradient(circle, color-mix(in oklab, currentColor 14%, transparent) 1px, transparent 1.5px); background-size: {CELL}px {CELL}px;"
					>
						{#each tableList as t (t.id)}
							{@const s = size(t.seats)}
							{@const st = stateFor(t.id)}
							{@const lit = highlight.includes(t.id)}
							{@const style = `left:${t.x * CELL}px; top:${t.y * CELL}px; width:${s.w * CELL}px; height:${s.h * CELL}px;`}
							{@const tone =
								mode === 'edit'
									? 'border-dashed border-ink-muted bg-surface text-ink cursor-grab touch-none active:cursor-grabbing'
									: st.kind === 'seated'
										? 'border-brand bg-brand text-brand-ink'
										: st.kind === 'held'
											? 'border-brand/60 bg-brand/10 text-ink'
											: 'border-border bg-surface text-ink hover:bg-surface-2'}
							{#if mode === 'edit'}
								<button
									type="button"
									{style}
									class="absolute flex flex-col items-center justify-center gap-0.5 rounded-lg border-2 text-xs select-none {tone}"
									aria-label="{t.name}, {t.seats} seats. Drag to move, press Enter to edit."
									onpointerdown={(e) => onPointerDown(e, t)}
									onpointermove={(e) => onPointerMove(e, t)}
									onpointerup={() => onPointerUp(t)}
									onkeydown={(e) => e.key === 'Enter' && (sheet = { open: true, table: data.tables.find((d) => d.id === t.id) ?? null })}
								>
									<span class="font-semibold">{t.name}</span>
									<span class="inline-flex items-center gap-0.5 opacity-80"><UsersIcon class="size-3" />{t.seats}</span>
								</button>
							{:else}
								<Popover.Root>
									<Popover.Trigger
										{style}
										class="absolute flex flex-col items-center justify-center gap-0.5 rounded-lg border-2 text-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 {tone} {lit ? 'ring-3 ring-brand/50' : ''}"
										aria-label="{t.name}, {t.seats} seats, {STATE_LABEL[st.kind]}"
									>
										<span class="font-semibold">{t.name}</span>
										<span class="inline-flex items-center gap-0.5 opacity-80"><UsersIcon class="size-3" />{t.seats}</span>
										<span class="text-[10px] leading-none font-medium uppercase tracking-wide">
											{STATE_LABEL[st.kind]}{st.kind === 'held' ? ` ${fmtTime(st.res.startsAt)}` : ''}
										</span>
									</Popover.Trigger>
									<Popover.Content class="w-72 space-y-3 p-4" align="start">
										<div class="flex items-baseline justify-between">
											<p class="text-sm font-semibold text-ink">{t.name}</p>
											<p class="text-xs text-ink-muted">{t.seats} seats{t.area ? ` · ${t.area}` : ''}</p>
										</div>

										{#if st.kind === 'free'}
											<p class="text-sm text-ink">Free at {fmtTime(at.toISOString())}.</p>
											{#if st.next}
												<p class="text-xs text-ink-muted">
													Next: {fmtTime(st.next.startsAt)}, {st.next.guestName} ×{st.next.partySize}
												</p>
											{/if}
										{:else}
											{@const r = st.res}
											<div class="space-y-1">
												<div class="flex items-center justify-between gap-2">
													<p class="text-sm font-medium text-ink">{r.guestName}</p>
													<Badge variant={r.status === 'seated' ? 'default' : 'outline'}>{r.status === 'seated' ? 'Seated' : 'Reserved'}</Badge>
												</div>
												<p class="text-xs text-ink-muted">
													<span class="tabular-nums">{fmtTime(r.startsAt)}–{fmtTime(r.endsAt)}</span> · party of {r.partySize}
													{#if r.guestPhone} · {r.guestPhone}{/if}
												</p>
												<p class="font-mono text-xs text-ink-muted">{r.code}</p>
												{#if r.bookingCode}
													<p class="flex items-center gap-1 text-xs text-ink-muted">
														<BedDoubleIcon class="size-3" /> In-house, booking <span class="font-mono">{r.bookingCode}</span>
													</p>
												{/if}
												{#if r.remarks}<p class="rounded-md bg-surface-2 px-2 py-1 text-xs text-ink">{r.remarks}</p>{/if}
											</div>

											<div class="flex flex-wrap gap-1.5">
												{#each RESERVATION_TRANSITIONS[r.status] ?? [] as to (to)}
													{#if ACTIONS[to] && !(to === 'confirmed' && r.status !== 'pending')}
														<form method="POST" action="?/setStatus" use:enhance>
															<input type="hidden" name="reservationId" value={r.id} />
															<input type="hidden" name="to" value={to} />
															<Button type="submit" size="sm" variant={ACTIONS[to].variant}>{ACTIONS[to].label}</Button>
														</form>
													{/if}
												{/each}
											</div>

											{#if r.status !== 'completed'}
												<form method="POST" action="?/changeTable" use:enhance class="flex items-center gap-1.5 border-t border-border pt-3">
													<input type="hidden" name="reservationId" value={r.id} />
													<Select.Root type="single" name="tableId" bind:value={moveTo[r.id]}>
														<Select.Trigger class="h-8 flex-1 text-xs" aria-label="Move to table">
															{moveTo[r.id] ? tableName(moveTo[r.id]!) : 'Move to…'}
														</Select.Trigger>
														<Select.Content>
															{#each data.tables.filter((x) => x.id !== t.id) as other (other.id)}
																<Select.Item value={other.id} label="{other.name} ({other.seats})" />
															{/each}
														</Select.Content>
													</Select.Root>
													<Button type="submit" size="sm" variant="outline" disabled={!moveTo[r.id]}>Move</Button>
												</form>
											{/if}
										{/if}
									</Popover.Content>
								</Popover.Root>
							{/if}
						{/each}
					</div>
				{/if}
			</div>

			<!-- Day rail -->
			<aside aria-label="Reservations on {dateLabel}" class="space-y-2">
				<h2 class="text-sm font-semibold text-ink">
					Reservations <span class="font-normal text-ink-muted tabular-nums">· {data.reservations.length}</span>
				</h2>
				{#if data.reservations.length === 0}
					<p class="rounded-xl border border-dashed border-border p-5 text-center text-sm text-ink-muted">
						Nothing booked for {dateLabel}.
					</p>
				{:else}
					<ul class="divide-y divide-border overflow-hidden rounded-xl border border-border">
						{#each data.reservations as r (r.id)}
							<li>
								<button
									type="button"
									class="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-surface-2 {highlight.join() === r.tableIds.join() && highlight.length ? 'bg-surface-2' : ''}"
									onclick={() => {
										highlight = r.tableIds;
										time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(new Date(r.startsAt));
									}}
								>
									<span class="w-14 shrink-0 text-sm font-medium tabular-nums text-ink">{fmtTime(r.startsAt)}</span>
									<span class="min-w-0 flex-1">
										<span class="block truncate text-sm text-ink">{r.guestName}</span>
										<span class="block text-xs text-ink-muted">
											×{r.partySize} · {r.tableIds.map(tableName).join(', ')}{r.bookingCode ? ` · room stay ${r.bookingCode}` : ''}
										</span>
									</span>
									<Badge variant={r.status === 'seated' ? 'default' : r.status === 'completed' ? 'ghost' : 'outline'}>
										{r.status === 'confirmed' ? 'Reserved' : r.status === 'pending' ? 'Pending' : r.status === 'seated' ? 'Seated' : 'Done'}
									</Badge>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
				<p class="pt-1 text-xs text-ink-muted">
					Cancelled and no-show bookings are on the <a class="underline" href="{base}/reservations?venue={data.venue.id}">Reservations</a> tab.
				</p>
			</aside>
		</div>
	{/if}
</div>

<!-- Add / edit table -->
<Sheet.Root bind:open={sheet.open}>
	<Sheet.Content side="right" class="sm:max-w-sm">
		{#if data.venue}
			{@const tbl = sheet.table}
			<Sheet.Header>
				<Sheet.Title>{tbl ? `Edit table ${tbl.name}` : 'Add a table'}</Sheet.Title>
				<Sheet.Description>
					{tbl ? 'Changes show on the plan straight away.' : 'It appears on the plan; drag it where it belongs.'}
				</Sheet.Description>
			</Sheet.Header>
			<form id="tableForm" method="POST" action={tbl ? '?/updateTable' : '?/addTable'} use:enhance class="space-y-4 px-4">
				{#if tbl}<input type="hidden" name="tableId" value={tbl.id} />{:else}<input type="hidden" name="diningItemId" value={data.venue.id} />{/if}
				<div>
					<Label for="tblName">Name</Label>
					<Input id="tblName" name="name" required maxlength={30} value={tbl?.name ?? ''} placeholder="T1" class="mt-1" />
				</div>
				<div>
					<Label for="tblSeats">Seats</Label>
					<Input id="tblSeats" name="seats" type="number" min="1" max="40" required value={tbl?.seats ?? 4} class="mt-1" />
				</div>
				<div>
					<Label for="tblArea">Area (optional)</Label>
					<Input id="tblArea" name="area" maxlength={40} value={tbl?.area ?? ''} placeholder="Terrace, Indoor…" class="mt-1" />
				</div>
			</form>
			<Sheet.Footer class="sm:flex-row sm:justify-between">
				{#if tbl}
					<form method="POST" action="?/deleteTable" use:enhance>
						<input type="hidden" name="tableId" value={tbl.id} />
						<Button type="submit" variant="ghost" class="text-danger hover:text-danger">Remove table</Button>
					</form>
				{:else}
					<span></span>
				{/if}
				<Button type="submit" form="tableForm">{tbl ? 'Save' : 'Add table'}</Button>
			</Sheet.Footer>
		{/if}
	</Sheet.Content>
</Sheet.Root>
