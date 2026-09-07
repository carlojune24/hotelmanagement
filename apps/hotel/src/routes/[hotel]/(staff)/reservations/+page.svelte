<script lang="ts">
	import { page } from '$app/state';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import SearchIcon from '@lucide/svelte/icons/search';
	import CalendarCheckIcon from '@lucide/svelte/icons/calendar-check';
	import BedIcon from '@lucide/svelte/icons/bed';
	import PartyPopperIcon from '@lucide/svelte/icons/party-popper';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const base = $derived(`/${page.params.hotel}`);
	const peso = (centavos: number) => `₱${(centavos / 100).toFixed(2)}`;

	let search = $state('');
	let statusFilter = $state('all');
	let kindFilter = $state<'all' | 'room' | 'hall'>('all');

	const STATUS_OPTIONS = [
		'pending_payment',
		'confirmed',
		'checked_in',
		'checked_out',
		'completed',
		'cancelled',
		'no_show'
	];
	const statusLabel = (s: string) => s.replace(/_/g, ' ');

	function statusVariantClass(status: string): string {
		if (['confirmed', 'checked_in', 'checked_out', 'completed'].includes(status)) {
			return 'border-transparent bg-ok/15 text-ok';
		}
		if (['cancelled', 'no_show'].includes(status)) {
			return 'border-transparent bg-danger/15 text-danger';
		}
		return 'border-border bg-surface-2 text-ink-muted';
	}

	const filtered = $derived(
		data.lines.filter((l) => {
			if (kindFilter !== 'all' && l.kind !== kindFilter) return false;
			if (statusFilter !== 'all' && l.status !== statusFilter) return false;
			if (search.trim()) {
				const q = search.trim().toLowerCase();
				if (!l.guestName.toLowerCase().includes(q) && !l.guestEmail.toLowerCase().includes(q)) {
					return false;
				}
			}
			return true;
		})
	);
</script>

<div class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Reservations</h1>
			<p class="text-sm text-ink-muted">
				Every room stay and function hall reservation booked through your public page.
			</p>
		</div>
		<Button variant="outline" href="{base}/dashboard">← Dashboard</Button>
	</div>

	<div class="mb-4 flex flex-wrap items-center gap-3">
		<div class="relative flex-1 min-w-48">
			<SearchIcon class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
			<Input placeholder="Search guest name or email…" bind:value={search} class="pl-8" />
		</div>
		<Select.Root type="single" bind:value={kindFilter}>
			<Select.Trigger class="w-36 shrink-0">
				{kindFilter === 'all' ? 'All types' : kindFilter === 'room' ? 'Rooms' : 'Function hall'}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="All types" />
				<Select.Item value="room" label="Rooms" />
				<Select.Item value="hall" label="Function hall" />
			</Select.Content>
		</Select.Root>
		<Select.Root type="single" bind:value={statusFilter}>
			<Select.Trigger class="w-44 shrink-0">
				{statusFilter === 'all' ? 'All statuses' : statusLabel(statusFilter)}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="All statuses" />
				{#each STATUS_OPTIONS as s (s)}
					<Select.Item value={s} label={statusLabel(s)} />
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<div class="overflow-hidden rounded-xl border border-border">
		{#if filtered.length === 0}
			<div class="flex flex-col items-center gap-2 p-10 text-center">
				<CalendarCheckIcon class="size-6 text-ink-muted" />
				<p class="text-sm text-ink-muted">
					{data.lines.length === 0 ? 'No bookings yet.' : 'No bookings match these filters.'}
				</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Guest</Table.Head>
						<Table.Head></Table.Head>
						<Table.Head>Booking</Table.Head>
						<Table.Head>Dates</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="text-right">Total</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each filtered as line (line.kind + line.id)}
						<Table.Row
							class="cursor-pointer"
							onclick={() => (window.location.href = `${base}/reservations/${line.kind}/${line.id}`)}
						>
							<Table.Cell>
								<div class="font-medium text-ink">{line.guestName}</div>
								<div class="text-xs text-ink-muted">{line.guestEmail}</div>
							</Table.Cell>
							<Table.Cell class="text-ink-muted">
								{#if line.kind === 'room'}
									<BedIcon class="size-4" aria-label="Room" />
								{:else}
									<PartyPopperIcon class="size-4" aria-label="Function hall" />
								{/if}
							</Table.Cell>
							<Table.Cell>
								<div class="text-ink">{line.title}</div>
								<div class="text-xs text-ink-muted">{line.subtitle}</div>
							</Table.Cell>
							<Table.Cell class="text-ink-muted">
								{line.startDate}{#if line.endDate}
									→ {line.endDate}{/if}
							</Table.Cell>
							<Table.Cell>
								<Badge variant="outline" class={statusVariantClass(line.status)}>
									{statusLabel(line.status)}
								</Badge>
								{#if line.status === 'pending_payment' && line.orderStatus === 'cancelled'}
									<div class="mt-1 text-xs text-danger">Order cancelled</div>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-right text-ink">{peso(line.totalCentavos)}</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>
</div>
