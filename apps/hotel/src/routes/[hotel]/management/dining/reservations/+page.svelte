<script lang="ts">
	import { enhance, applyAction, deserialize } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import CalendarCheckIcon from '@lucide/svelte/icons/calendar-check';
	import BedDoubleIcon from '@lucide/svelte/icons/bed-double';
	import { RESERVATION_TRANSITIONS } from '$lib/dining-slots';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}/management/dining`);
	const tz = $derived(data.timezone);

	const TAB_LABEL = { today: 'Today', upcoming: 'Upcoming', past: 'Past', cancelled: 'Cancelled & no-show' } as const;
	const STATUS: Record<string, { label: string; variant: 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary' }> = {
		pending: { label: 'Pending', variant: 'secondary' },
		confirmed: { label: 'Reserved', variant: 'outline' },
		seated: { label: 'Seated', variant: 'default' },
		completed: { label: 'Done', variant: 'ghost' },
		no_show: { label: 'No-show', variant: 'destructive' },
		cancelled: { label: 'Cancelled', variant: 'destructive' }
	};
	const ACTION_LABEL: Record<string, string> = {
		confirmed: 'Confirm',
		seated: 'Mark seated',
		completed: 'Mark done',
		no_show: 'Mark no-show',
		cancelled: 'Cancel reservation'
	};

	const fmtTime = (iso: string) =>
		new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso));
	const fmtDay = (iso: string) =>
		new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }).format(new Date(iso));

	/** A booking nobody has arrived for, 15+ minutes after its time. */
	const isLate = (r: (typeof data.rows)[number]) =>
		(r.status === 'confirmed' || r.status === 'pending') && new Date(r.startsAt).getTime() < new Date(data.nowIso).getTime() - 15 * 60_000;

	// ---- URL-driven filters ----------------------------------------------------
	function go(next: Record<string, string | null>) {
		const q = new URLSearchParams(page.url.searchParams);
		for (const [k, v] of Object.entries(next)) (v ? q.set(k, v) : q.delete(k));
		if (!('page' in next)) q.delete('page');
		goto(`?${q}`, { keepFocus: true, noScroll: true });
	}
	let search = $state(data.q);
	const lastPage = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));

	// ---- row actions -----------------------------------------------------------
	async function act(reservationId: string, to: string) {
		const body = new FormData();
		body.set('reservationId', reservationId);
		body.set('to', to);
		const res = await fetch('?/setStatus', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
		const result = deserialize(await res.text());
		await applyAction(result);
		if (result.type === 'success') await invalidateAll();
	}

	// ---- new reservation sheet ---------------------------------------------------
	let sheetOpen = $state(false);
	const bookable = $derived(data.venues.filter((v) => data.allTables.some((t) => t.venueId === v.id)));
	let nVenue = $state('');
	let nDate = $state('');
	let nParty = $state(2);
	let nTime = $state('');
	let nTable = $state('auto');
	let slots = $state<{ time: string; available: boolean }[]>([]);
	let slotsLoading = $state(false);

	function openSheet() {
		nVenue = data.venueId && bookable.some((v) => v.id === data.venueId) ? data.venueId : (bookable[0]?.id ?? '');
		nDate = data.today;
		nParty = 2;
		nTime = '';
		nTable = 'auto';
		sheetOpen = true;
	}

	$effect(() => {
		if (!sheetOpen || !nVenue || !nDate || nParty < 1) return;
		const venue = nVenue;
		const date = nDate;
		const party = nParty;
		slotsLoading = true;
		const ctl = new AbortController();
		fetch(`${base}/reservations/slots?venue=${venue}&date=${date}&party=${party}`, { signal: ctl.signal })
			.then((r) => r.json())
			.then((j) => {
				slots = j.slots ?? [];
			})
			.catch(() => {})
			.finally(() => (slotsLoading = false));
		return () => ctl.abort();
	});

	const venueTables = $derived(data.allTables.filter((t) => t.venueId === nVenue));
	const venueLabel = $derived(data.venues.find((v) => v.id === nVenue)?.title ?? 'Choose a venue');
	const tableLabel = $derived(venueTables.find((t) => t.id === nTable) ? `${venueTables.find((t) => t.id === nTable)!.name} (${venueTables.find((t) => t.id === nTable)!.seats})` : 'Any free table');
	const filterLabel = $derived(data.venues.find((v) => v.id === data.venueId)?.title ?? 'All venues');

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) {
			toast.success(form.ok);
			sheetOpen = false;
		}
	});
</script>

<div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
	<div class="mb-4 flex flex-wrap items-center gap-3">
		<Tabs.Root value={data.tab} onValueChange={(v) => go({ tab: v === 'today' ? null : v })}>
			<Tabs.List>
				{#each Object.entries(TAB_LABEL) as [key, label] (key)}
					<Tabs.Trigger value={key}>
						{label}
						<span class="ml-1.5 text-xs tabular-nums text-ink-muted">{data.counts[key as keyof typeof data.counts]}</span>
					</Tabs.Trigger>
				{/each}
			</Tabs.List>
		</Tabs.Root>

		<div class="ml-auto flex flex-wrap items-center gap-2">
			{#if data.venues.length > 1}
				<Select.Root type="single" value={data.venueId ?? 'all'} onValueChange={(v) => go({ venue: v === 'all' ? null : v })}>
					<Select.Trigger class="w-44" aria-label="Venue">{filterLabel}</Select.Trigger>
					<Select.Content>
						<Select.Item value="all" label="All venues" />
						{#each data.venues as v (v.id)}
							<Select.Item value={v.id} label={v.title} />
						{/each}
					</Select.Content>
				</Select.Root>
			{/if}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					go({ q: search.trim() || null });
				}}
				class="relative"
			>
				<SearchIcon class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
				<Input bind:value={search} placeholder="Name, code, phone" aria-label="Search reservations" class="w-52 pl-8" />
			</form>
			<Button onclick={openSheet} disabled={bookable.length === 0}>
				<PlusIcon class="size-4" /> New reservation
			</Button>
		</div>
	</div>

	{#if data.venues.length === 0}
		<div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
			<CalendarCheckIcon class="size-6 text-ink-muted" />
			<p class="text-sm text-ink-muted">Add a venue and its tables to start taking reservations.</p>
			<Button href="{base}/settings" variant="outline">Set up venues</Button>
		</div>
	{:else if data.rows.length === 0}
		<div class="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-12 text-center">
			<CalendarCheckIcon class="size-6 text-ink-muted" />
			<p class="text-sm text-ink-muted">
				{data.q ? `No reservations match "${data.q}".` : data.tab === 'today' ? 'No reservations today.' : `No ${TAB_LABEL[data.tab].toLowerCase()} reservations.`}
			</p>
			{#if bookable.length === 0}
				<p class="text-xs text-ink-muted">
					Add tables on the <a class="underline" href="{base}/floor-plan">Floor plan</a> to take bookings.
				</p>
			{/if}
		</div>
	{:else}
		<div class="overflow-hidden rounded-xl border border-border">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="w-40">{data.tab === 'today' ? 'Time' : 'When'}</Table.Head>
						<Table.Head>Guest</Table.Head>
						<Table.Head class="w-16 text-right">Party</Table.Head>
						<Table.Head>Table</Table.Head>
						<Table.Head class="w-36">Status</Table.Head>
						<Table.Head class="w-12"><span class="sr-only">Actions</span></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.rows as r (r.id)}
						{@const moves = (RESERVATION_TRANSITIONS[r.status] ?? []).filter((to) => !(to === 'confirmed' && r.status !== 'pending'))}
						<Table.Row>
							<Table.Cell class="tabular-nums">
								{#if data.tab !== 'today'}<span class="block text-xs text-ink-muted">{fmtDay(r.startsAt)}</span>{/if}
								<span class="font-medium text-ink">{fmtTime(r.startsAt)}</span>
							</Table.Cell>
							<Table.Cell>
								<div class="font-medium text-ink">{r.guestName}</div>
								<div class="text-xs text-ink-muted">
									<span class="font-mono">{r.code}</span>{r.guestPhone ? ` · ${r.guestPhone}` : ''}{data.venues.length > 1 ? ` · ${r.venueTitle}` : ''}
								</div>
								{#if r.bookingCode}
									<div class="mt-0.5 flex items-center gap-1 text-xs text-ink-muted">
										<BedDoubleIcon class="size-3" /> In-house, booking <span class="font-mono">{r.bookingCode}</span>
									</div>
								{/if}
								{#if r.remarks}<div class="mt-0.5 line-clamp-1 text-xs text-ink-muted">“{r.remarks}”</div>{/if}
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{r.partySize}</Table.Cell>
							<Table.Cell class="text-ink-muted">{r.tables.join(', ') || '—'}</Table.Cell>
							<Table.Cell>
								<Badge variant={STATUS[r.status]?.variant ?? 'outline'}>{STATUS[r.status]?.label ?? r.status}</Badge>
								{#if isLate(r)}<div class="mt-1 text-xs font-medium text-danger">Arrival overdue</div>{/if}
							</Table.Cell>
							<Table.Cell class="text-right">
								<DropdownMenu.Root>
									<DropdownMenu.Trigger>
										{#snippet child({ props })}
											<Button {...props} variant="ghost" size="icon" class="size-8" aria-label="Actions for {r.guestName}">
												<EllipsisIcon class="size-4" />
											</Button>
										{/snippet}
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="end">
										{#each moves as to (to)}
											<DropdownMenu.Item
												variant={to === 'cancelled' || to === 'no_show' ? 'destructive' : 'default'}
												onSelect={() => act(r.id, to)}
											>
												{ACTION_LABEL[to]}
											</DropdownMenu.Item>
										{/each}
										{#if moves.length > 0}<DropdownMenu.Separator />{/if}
										<DropdownMenu.Item>
											{#snippet child({ props })}
												<a {...props} href="{base}/floor-plan?date={r.startsAt.slice(0, 10)}">View on floor plan</a>
											{/snippet}
										</DropdownMenu.Item>
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>

		{#if lastPage > 1}
			<div class="mt-3 flex items-center justify-between text-sm text-ink-muted">
				<span class="tabular-nums">Page {data.page} of {lastPage}</span>
				<div class="flex gap-2">
					<Button variant="outline" size="sm" disabled={data.page <= 1} onclick={() => go({ page: String(data.page - 1) })}>Previous</Button>
					<Button variant="outline" size="sm" disabled={data.page >= lastPage} onclick={() => go({ page: String(data.page + 1) })}>Next</Button>
				</div>
			</div>
		{/if}
	{/if}
</div>

<!-- New reservation -->
<Sheet.Root bind:open={sheetOpen}>
	<Sheet.Content side="right" class="w-full overflow-y-auto sm:max-w-md">
		<Sheet.Header>
			<Sheet.Title>New reservation</Sheet.Title>
			<Sheet.Description>Phone or walk-in booking. A free table is assigned unless you pick one.</Sheet.Description>
		</Sheet.Header>
		<form id="newResForm" method="POST" action="?/create" use:enhance class="space-y-4 px-4">
			<input type="hidden" name="diningItemId" value={nVenue} />
			<input type="hidden" name="time" value={nTime} />

			{#if bookable.length > 1}
				<div>
					<Label for="nrVenue">Venue</Label>
					<Select.Root type="single" bind:value={nVenue} onValueChange={() => { nTable = 'auto'; nTime = ''; }}>
						<Select.Trigger id="nrVenue" class="mt-1 w-full">{venueLabel}</Select.Trigger>
						<Select.Content>
							{#each bookable as v (v.id)}<Select.Item value={v.id} label={v.title} />{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/if}

			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="nrDate">Date</Label>
					<Input id="nrDate" name="date" type="date" required bind:value={nDate} class="mt-1" />
				</div>
				<div>
					<Label for="nrParty">Party size</Label>
					<Input id="nrParty" name="partySize" type="number" min="1" max="100" required bind:value={nParty} class="mt-1" />
				</div>
			</div>

			<div>
				<Label>Time</Label>
				{#if slotsLoading && slots.length === 0}
					<p class="mt-1 text-sm text-ink-muted">Checking availability…</p>
				{:else if slots.length === 0}
					<p class="mt-1 text-sm text-ink-muted">No set seating times for this venue or party. Enter a time below.</p>
				{:else}
					<ToggleGroup.Root type="single" bind:value={nTime} variant="outline" class="mt-1 flex flex-wrap justify-start gap-1.5">
						{#each slots as s (s.time)}
							<ToggleGroup.Item value={s.time} disabled={!s.available} class="tabular-nums {s.available ? '' : 'line-through'}" aria-label="{s.time}{s.available ? '' : ', full'}">
								{s.time}
							</ToggleGroup.Item>
						{/each}
					</ToggleGroup.Root>
				{/if}
				<div class="mt-2 flex items-center gap-2">
					<Label for="nrTime" class="text-xs font-normal text-ink-muted">Or any time</Label>
					<Input id="nrTime" type="time" bind:value={nTime} class="h-8 w-32" />
				</div>
			</div>

			<div>
				<Label for="nrTable">Table</Label>
				<Select.Root type="single" name="tableId" bind:value={nTable}>
					<Select.Trigger id="nrTable" class="mt-1 w-full">{tableLabel}</Select.Trigger>
					<Select.Content>
						<Select.Item value="auto" label="Any free table" />
						{#each venueTables as t (t.id)}<Select.Item value={t.id} label="{t.name} ({t.seats})" />{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<div>
				<Label for="nrName">Guest name</Label>
				<Input id="nrName" name="guestName" required maxlength={120} class="mt-1" />
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="nrPhone">Mobile</Label>
					<Input id="nrPhone" name="guestPhone" type="tel" maxlength={40} class="mt-1" />
				</div>
				<div>
					<Label for="nrEmail">Email (optional)</Label>
					<Input id="nrEmail" name="guestEmail" type="email" class="mt-1" />
				</div>
			</div>
			<div>
				<Label for="nrRemarks">Remarks</Label>
				<Textarea id="nrRemarks" name="remarks" rows={2} maxlength={500} placeholder="Allergies, occasion, high chair…" class="mt-1" />
			</div>
		</form>
		<Sheet.Footer>
			<Button type="submit" form="newResForm" disabled={!nTime || !nVenue}>Book table</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
