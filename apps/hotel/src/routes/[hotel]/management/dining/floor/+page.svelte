<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ArmchairIcon from '@lucide/svelte/icons/armchair';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import QrCodeIcon from '@lucide/svelte/icons/qr-code';
	import MapIcon from '@lucide/svelte/icons/map';
	import ListIcon from '@lucide/svelte/icons/list';
	import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
	import { zonedToUtc } from '$lib/dining-slots';
	import { floorCounts, tableView, urgencyRank, type FloorFilter, type TableView } from '$lib/dining-floor';
	import SettleDialog from './settle-dialog.svelte';
	import StatusBar from './status-bar.svelte';
	import TablePlan from './table-plan.svelte';
	import TableList from './table-list.svelte';
	import TablePanel from './table-panel.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	type Check = PageData['checks'][number];
	type Res = PageData['reservations'][number];

	const NO_AREA = '_none';

	const base = $derived(`/${page.params.hotel}/management/dining`);
	const tz = $derived(data.timezone);

	let mode = $state<'service' | 'edit'>('service');
	let filter = $state<FloorFilter>('all');
	let nowMs = $state(Date.now());

	// ---- plan or list: the plan is the room, the list is "what needs me first" ---------------
	let layout = $state<'plan' | 'list'>('plan');
	onMount(() => {
		try {
			const saved = localStorage.getItem('floor-layout');
			if (saved === 'plan' || saved === 'list') layout = saved;
			else if (window.matchMedia('(max-width: 767px)').matches) layout = 'list';
		} catch {
			if (window.matchMedia('(max-width: 767px)').matches) layout = 'list';
		}
	});
	function setLayout(v: string) {
		if (v !== 'plan' && v !== 'list') return;
		layout = v;
		try {
			localStorage.setItem('floor-layout', v);
		} catch {
			/* storage blocked: the choice just isn't remembered */
		}
	}
	const showList = $derived(layout === 'list' && mode === 'service');

	// ---- live by default; "Plan ahead" looks at another date and time for bookings ----------
	let planAhead = $state(false);
	let time = $state(data.nowLocal.time);
	const at = $derived(planAhead ? zonedToUtc(data.date, time, tz) : new Date(nowMs));
	const turnMs = $derived((data.venue?.turnMinutes ?? 90) * 60_000);

	const fmtTime = (iso: string) =>
		new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso));
	const dateLabel = $derived(
		new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(
			new Date(`${data.date}T00:00:00Z`)
		)
	);

	// ---- areas: one canvas per area ----------------------------------------------------------
	const hasUnassigned = $derived(data.tables.some((t) => !t.areaId));
	const areaTabs = $derived([
		...data.areas.map((a) => ({ id: a.id, name: a.name })),
		...(hasUnassigned ? [{ id: NO_AREA, name: 'No area' }] : [])
	]);
	const activeAreaId = $derived.by(() => {
		const wanted = page.url.searchParams.get('area');
		return areaTabs.find((a) => a.id === wanted)?.id ?? areaTabs[0]?.id ?? '';
	});
	const inArea = (areaId: string | null, tab: string) => (tab === NO_AREA ? !areaId : areaId === tab);
	const areaName = (id: string | null) => data.areas.find((a) => a.id === id)?.name ?? null;

	// ---- what every table is doing right now ------------------------------------------------
	const views = $derived(
		Object.fromEntries(
			data.tables.map((t) => [
				t.id,
				tableView<Res>({
					tableId: t.id,
					check: data.checks.find((c) => c.tableId === t.id) ?? null,
					reservations: data.reservations,
					awaiting: data.awaiting[t.id] ?? 0,
					at,
					turnMs
				})
			])
		) as Record<string, TableView<Res>>
	);
	const counts = $derived(floorCounts(Object.values(views)));
	/** Tables in an area that need a person now, so a busy area shows on its tab. */
	const attentionIn = (tab: string) =>
		data.tables.filter((t) => inArea(t.areaId, tab) && urgencyRank(views[t.id]!) <= 3).length;

	const planTables = $derived(data.tables.filter((t) => inArea(t.areaId, activeAreaId)));
	const listTables = $derived(data.tables.map((t) => ({ id: t.id, name: t.name, seats: t.seats, areaName: areaName(t.areaId) })));
	const tableName = (id: string) => data.tables.find((t) => t.id === id)?.name ?? '?';

	// ---- the table panel ---------------------------------------------------------------------
	let selectedId = $state<string | null>(null);
	let panelOpen = $state(false);
	let highlight = $state<string[]>([]);
	function select(id: string) {
		selectedId = id;
		panelOpen = true;
	}
	const selectedTable = $derived.by(() => {
		const t = data.tables.find((x) => x.id === selectedId);
		return t ? { id: t.id, name: t.name, seats: t.seats, areaName: areaName(t.areaId) } : null;
	});
	const selectedCheck = $derived(selectedId ? (data.checks.find((c) => c.tableId === selectedId) ?? null) : null);

	// ---- navigation (venue / date / area) ----------------------------------------------------
	function go(next: { venue?: string; date?: string; area?: string }) {
		const q = new URLSearchParams();
		q.set('venue', next.venue ?? data.venue?.id ?? '');
		q.set('date', next.date ?? data.date);
		const area = next.venue ? undefined : (next.area ?? activeAreaId);
		if (area) q.set('area', area);
		goto(`?${q}`, { keepFocus: true, noScroll: true });
	}
	function backToLive() {
		planAhead = false;
		time = data.nowLocal.time;
		if (data.nowLocal.date !== data.date) go({ date: data.nowLocal.date });
	}

	// ---- editing the layout (managers) -------------------------------------------------------
	let sheet = $state<{ open: boolean; table: (typeof data.tables)[number] | null }>({ open: false, table: null });
	let sheetArea = $state('');
	let areasOpen = $state(false);
	let newAreaName = $state('');

	function openSheet(table: (typeof data.tables)[number] | null) {
		sheetArea = table?.areaId ?? (activeAreaId === NO_AREA ? '' : activeAreaId);
		sheet = { open: true, table };
	}
	const sheetAreaLabel = $derived(
		data.areas.find((a) => a.id === sheetArea)?.name ?? (data.areas.length ? 'Choose an area' : 'Main (created for you)')
	);
	const countIn = (tab: string) => data.tables.filter((t) => inArea(t.areaId, tab)).length;

	// ---- settling and clearing ---------------------------------------------------------------
	let settleOpen = $state(false);
	let settleFor = $state<Check | null>(null);
	let clearFor = $state<Check | null>(null);
	let clearReason = $state('');
	function openSettle(check: Check) {
		panelOpen = false;
		settleFor = check;
		settleOpen = true;
	}
	function openClear(check: Check) {
		panelOpen = false;
		clearFor = check;
	}

	$effect(() => {
		// `form` lingers after a submit, so only the open-state writes are untracked; otherwise
		// reopening a sheet or dialog re-runs this effect and the stale `form.ok` closes it again.
		const f = form;
		if (f?.error) toast.error(f.error);
		if (f?.ok) {
			toast.success(f.ok);
			untrack(() => {
				sheet.open = false;
				clearFor = null;
				clearReason = '';
				newAreaName = '';
			});
		}
	});

	// Keep the floor honest: refresh the checks and the clock while someone is watching.
	$effect(() => {
		const tick = setInterval(() => (nowMs = Date.now()), 30_000);
		const refresh = setInterval(() => {
			if (!document.hidden && mode === 'service') invalidate('app:dining-floor');
		}, 15_000);
		return () => {
			clearInterval(tick);
			clearInterval(refresh);
		};
	});
</script>

<div class="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6">
	{#if data.venues.length === 0}
		<div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
			<ArmchairIcon class="size-6 text-ink-muted" />
			<p class="text-sm text-ink-muted">Add a venue first, then lay out its tables here.</p>
			<Button href="{base}/settings" variant="outline">Set up venues</Button>
		</div>
	{:else if data.venue}
		<!-- Controls -->
		<div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-3">
			{#if data.venues.length > 1}
				<Select.Root type="single" value={data.venue.id} onValueChange={(v) => go({ venue: v })}>
					<Select.Trigger class="h-11 w-48" aria-label="Venue">{data.venue.title}</Select.Trigger>
					<Select.Content>
						{#each data.venues as v (v.id)}
							<Select.Item value={v.id} label={v.title} />
						{/each}
					</Select.Content>
				</Select.Root>
			{/if}

			{#if mode === 'service'}
				<ToggleGroup.Root type="single" variant="outline" value={layout} onValueChange={setLayout} aria-label="How to show the tables">
					<ToggleGroup.Item value="plan" class="h-11 gap-2 px-3.5"><MapIcon class="size-4" /> Plan</ToggleGroup.Item>
					<ToggleGroup.Item value="list" class="h-11 gap-2 px-3.5"><ListIcon class="size-4" /> List</ToggleGroup.Item>
				</ToggleGroup.Root>

				{#if planAhead}
					<div class="flex flex-wrap items-center gap-2">
						<Input
							type="date"
							value={data.date}
							aria-label="Date"
							onchange={(e) => e.currentTarget.value && go({ date: e.currentTarget.value })}
							class="h-11 w-40"
						/>
						<Input type="time" bind:value={time} aria-label="Time" class="h-11 w-32" />
						<Button variant="outline" class="h-11" onclick={backToLive}>Back to live</Button>
					</div>
				{:else}
					<Button variant="ghost" class="h-11 text-ink-muted" onclick={() => (planAhead = true)}>
						<CalendarClockIcon class="size-4" /> Plan ahead
					</Button>
				{/if}
			{/if}

			<div class="ml-auto flex flex-wrap items-center gap-3">
				{#if data.canManageMenu}
					<Tabs.Root bind:value={mode}>
						<Tabs.List>
							<Tabs.Trigger value="service">Service</Tabs.Trigger>
							<Tabs.Trigger value="edit">Edit layout</Tabs.Trigger>
						</Tabs.List>
					</Tabs.Root>
				{/if}
				{#if mode === 'edit'}
					<Button variant="outline" onclick={() => (areasOpen = true)}><LayersIcon class="size-4" /> Areas</Button>
					<Button href="{base}/floor/qr?venue={data.venue.id}" variant="outline"><QrCodeIcon class="size-4" /> QR codes</Button>
					<Button onclick={() => openSheet(null)}><PlusIcon class="size-4" /> Add table</Button>
				{/if}
			</div>
		</div>

		{#if mode === 'service' && data.tables.length > 0}
			<div class="mb-4"><StatusBar {counts} bind:filter /></div>
		{/if}

		<!-- One tab per area (the list shows every table, so it needs none) -->
		{#if areaTabs.length > 0 && !showList}
			<div class="mb-3 overflow-x-auto" role="tablist" aria-label="Areas">
				<div class="flex w-max gap-1.5">
					{#each areaTabs as a (a.id)}
						{@const attention = mode === 'service' ? attentionIn(a.id) : 0}
						<button
							type="button"
							role="tab"
							aria-selected={a.id === activeAreaId}
							class="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors {a.id === activeAreaId
								? 'border-brand bg-brand/10 font-medium text-ink'
								: 'border-border text-ink-muted hover:text-ink'}"
							onclick={() => go({ area: a.id })}
						>
							{a.name}
							<span class="text-xs tabular-nums text-ink-muted">{countIn(a.id)}</span>
							{#if attention > 0}
								<span class="inline-flex items-center gap-1 rounded-full border border-warning/60 px-1.5 text-[11px] font-semibold text-ink" aria-label="{attention} need attention">
									<span class="size-1.5 rounded-full bg-warning" aria-hidden="true"></span>{attention}
								</span>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<p class="mb-3 text-sm text-ink-muted">
			{#if mode === 'edit'}
				Drag a table to move it. Click one to rename it, change its seats or area, or remove it.
			{:else if planAhead}
				{dateLabel} at <span class="tabular-nums text-ink">{fmtTime(at.toISOString())}</span>. Bookings and who is free are shown for that time; tables that are
				occupied now stay occupied.
			{:else}
				Live. Tap a table to see its orders and what to do next. Occupied tables free up when the bill is settled and the table is closed.
			{/if}
		</p>

		<div class="grid gap-5 lg:grid-cols-[1fr_19rem]">
			<div>
				{#if data.tables.length === 0}
					<div class="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-14 text-center">
						<ArmchairIcon class="size-6 text-ink-muted" />
						<p class="text-sm text-ink-muted">No tables in {data.venue.title} yet.</p>
						{#if data.canManageMenu}
							<Button onclick={() => { mode = 'edit'; openSheet(null); }}><PlusIcon class="size-4" /> Add the first table</Button>
						{/if}
					</div>
				{:else if showList}
					<TableList tables={listTables} {views} {filter} {selectedId} {nowMs} onselect={select} />
				{:else if planTables.length === 0}
					<div class="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-14 text-center">
						<ArmchairIcon class="size-6 text-ink-muted" />
						<p class="text-sm text-ink-muted">No tables in this area yet.</p>
						{#if data.canManageMenu}
							<Button variant="outline" onclick={() => { mode = 'edit'; openSheet(null); }}><PlusIcon class="size-4" /> Add a table here</Button>
						{/if}
					</div>
				{:else}
					<TablePlan
						tables={planTables}
						{views}
						{mode}
						{filter}
						{selectedId}
						{nowMs}
						{highlight}
						onselect={select}
						onedit={(id) => openSheet(data.tables.find((d) => d.id === id) ?? null)}
					/>
				{/if}
			</div>

			<!-- Day rail -->
			<aside aria-label="Reservations on {dateLabel}" class="space-y-2">
				<h2 class="text-sm font-semibold text-ink">
					Reservations <span class="font-normal text-ink-muted">· {dateLabel}</span>
					<span class="font-normal tabular-nums text-ink-muted">· {data.reservations.length}</span>
				</h2>
				{#if data.reservations.length === 0}
					<p class="rounded-xl border border-dashed border-border p-5 text-center text-sm text-ink-muted">Nothing booked for {dateLabel}.</p>
				{:else}
					<ul class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
						{#each data.reservations as r (r.id)}
							<li>
								<button
									type="button"
									class="flex min-h-14 w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-surface-2 {highlight.join() === r.tableIds.join() && highlight.length ? 'bg-surface-2' : ''}"
									onclick={() => {
										highlight = r.tableIds;
										const first = r.tableIds[0];
										if (first) {
											const t = data.tables.find((x) => x.id === first);
											if (t && !showList && t.areaId && t.areaId !== activeAreaId) go({ area: t.areaId });
											select(first);
										}
									}}
								>
									<span class="w-14 shrink-0 text-sm font-medium tabular-nums text-ink">{fmtTime(r.startsAt)}</span>
									<span class="min-w-0 flex-1">
										<span class="block truncate text-sm text-ink">{r.guestName}</span>
										<span class="block text-xs text-ink-muted">
											×{r.partySize} · {r.tableIds.map(tableName).join(', ')}{r.bookingCode ? ` · room stay ${r.bookingCode}` : ''}
										</span>
									</span>
									<Badge variant={r.status === 'seated' ? 'secondary' : r.status === 'completed' ? 'ghost' : 'outline'}>
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

<TablePanel
	bind:open={panelOpen}
	table={selectedTable}
	view={selectedId ? (views[selectedId] ?? null) : null}
	check={selectedCheck}
	others={data.tables.filter((t) => t.id !== selectedId).map((t) => ({ id: t.id, name: t.name, seats: t.seats }))}
	{base}
	venueId={data.venue?.id ?? ''}
	canWrite={data.canWrite}
	canClear={data.canClear}
	{nowMs}
	{fmtTime}
	onsettle={openSettle}
	onclear={openClear}
/>

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
					<Label for="tblArea">Area</Label>
					<Select.Root type="single" name="areaId" bind:value={sheetArea}>
						<Select.Trigger id="tblArea" class="mt-1 w-full">{sheetAreaLabel}</Select.Trigger>
						<Select.Content>
							{#each data.areas as a (a.id)}
								<Select.Item value={a.id} label={a.name} />
							{/each}
						</Select.Content>
					</Select.Root>
					<p class="mt-1 text-xs text-ink-muted">
						Public area, VIP room, 2nd floor… <button type="button" class="underline" onclick={() => { sheet.open = false; areasOpen = true; }}>Manage areas</button>
					</p>
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

<!-- Manage areas -->
<Dialog.Root bind:open={areasOpen}>
	<Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Areas</Dialog.Title>
			<Dialog.Description>
				Each area is its own floor: Public area, VIP room, Deluxe suite, 2nd floor, 3rd floor. Put each table in one.
			</Dialog.Description>
		</Dialog.Header>

		{#if data.venue}
			<ul class="divide-y divide-border rounded-lg border border-border">
				{#each data.areas as a, i (a.id)}
					<li class="flex items-center gap-1.5 py-1.5 pr-1.5 pl-2">
						<form method="POST" action="?/renameArea" use:enhance class="min-w-0 flex-1">
							<input type="hidden" name="areaId" value={a.id} />
							<Input
								name="name"
								value={a.name}
								maxlength={40}
								aria-label="Area name"
								class="h-9 border-transparent bg-transparent font-medium shadow-none hover:border-input focus-visible:border-ring"
								onblur={(e) => {
									const el = e.currentTarget;
									if (el.value.trim() && el.value.trim() !== a.name) el.form?.requestSubmit();
								}}
							/>
						</form>
						<span class="shrink-0 text-xs tabular-nums text-ink-muted">{countIn(a.id)} {countIn(a.id) === 1 ? 'table' : 'tables'}</span>
						<form method="POST" action="?/moveArea" use:enhance>
							<input type="hidden" name="areaId" value={a.id} />
							<input type="hidden" name="dir" value="up" />
							<Button type="submit" variant="ghost" size="icon" class="size-8" disabled={i === 0} aria-label="Move {a.name} up"><ChevronUpIcon class="size-4" /></Button>
						</form>
						<form method="POST" action="?/moveArea" use:enhance>
							<input type="hidden" name="areaId" value={a.id} />
							<input type="hidden" name="dir" value="down" />
							<Button type="submit" variant="ghost" size="icon" class="size-8" disabled={i === data.areas.length - 1} aria-label="Move {a.name} down"><ChevronDownIcon class="size-4" /></Button>
						</form>
						<form method="POST" action="?/deleteArea" use:enhance>
							<input type="hidden" name="areaId" value={a.id} />
							<Button type="submit" variant="ghost" size="icon" class="size-8 text-ink-muted hover:text-danger" disabled={countIn(a.id) > 0} aria-label="Delete {a.name}" title={countIn(a.id) > 0 ? 'Move its tables out first' : 'Delete area'}>
								<Trash2Icon class="size-4" />
							</Button>
						</form>
					</li>
				{:else}
					<li class="px-3 py-6 text-center text-sm text-ink-muted">No areas yet. Add one below, or just add a table and "Main" is created for you.</li>
				{/each}
			</ul>

			<form
				method="POST"
				action="?/addArea"
				class="flex items-center gap-2"
				use:enhance={() => async ({ result, update }) => {
					await update({ reset: true });
					if (result.type === 'success' && result.data?.areaId) go({ area: String(result.data.areaId) });
				}}
			>
				<input type="hidden" name="diningItemId" value={data.venue.id} />
				<Input name="name" bind:value={newAreaName} required maxlength={40} placeholder="e.g. VIP room, 2nd floor" aria-label="New area name" />
				<Button type="submit" class="shrink-0"><PlusIcon class="size-4" /> Add area</Button>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<SettleDialog bind:open={settleOpen} check={settleFor} shiftOpen={data.shiftOpen} slug={page.params.hotel ?? ''} inHouse={data.inHouse} />

<!-- Force clear -->
<Dialog.Root open={clearFor !== null} onOpenChange={(o) => { if (!o) clearFor = null; }}>
	<Dialog.Content class="sm:max-w-sm">
		{#if clearFor}
			<Dialog.Header>
				<Dialog.Title>Clear table {clearFor.tableName}?</Dialog.Title>
				<Dialog.Description>
					Use this when the table can't be settled normally. Orders that were never paid or served are cancelled; paid ones are marked
					served. It is recorded against you.
				</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/forceClear" use:enhance class="space-y-4">
				<input type="hidden" name="checkId" value={clearFor.id} />
				<div>
					<Label for="clearReason">Reason</Label>
					<Input id="clearReason" name="reason" bind:value={clearReason} required maxlength={300} placeholder="Guests left without paying" class="mt-1" />
				</div>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (clearFor = null)}>Keep open</Button>
					<Button type="submit" variant="destructive">Clear table</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
