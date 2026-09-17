<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const base = $derived(`/${page.params.hotel}/management`);

	let search = $state('');
	let expanded = $state<Set<string>>(new Set());

	const fmtDateTime = (v: string | Date) =>
		new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

	// The events an owner actually asks about — "who booked this, who checked them out" —
	// get a plain-language label. Everything else falls back to a humanized version of its
	// raw action string, which still reads fine (e.g. "finance.void_expense" → "Void expense").
	const ACTION_LABELS: Record<string, string> = {
		'booking.walk_in': 'Booked a walk-in room',
		'hall_booking.walk_in': 'Booked a walk-in function hall',
		'payment.paymongo_confirmed': 'Guest paid online (PayMongo)',
		'booking.check_in': 'Checked in',
		'booking.id_photo_captured': 'Captured guest ID photo',
		'booking.check_out': 'Checked out',
		'booking.cancel': 'Cancelled a room booking',
		'hall_booking.cancel': 'Cancelled a hall booking',
		'booking.no_show': 'Marked as no-show',
		'booking.modify_stay': 'Modified stay dates',
		'booking.reinstate': 'Reinstated a booking',
		'hall_booking.reinstate': 'Reinstated a hall booking',
		'booking.order_expired': 'Order expired — hold released',
		'order.manual_confirm': 'Manually confirmed an order',
		'hall_booking.complete': 'Marked an event completed',
		'folio.record_payment': 'Recorded a payment',
		'folio.refund_payment': 'Refunded a payment',
		'folio.void_payment': 'Voided a payment',
		'folio.add_item_charge': 'Added a charge to a folio',
		'folio.add_extension_fee': 'Added an extension fee',
		'folio.void_charge': 'Voided a folio charge',
		'finance.open_shift': 'Opened a cashier shift',
		'finance.close_shift': 'Closed a cashier shift',
		'finance.shift_event': 'Recorded a drawer event',
		'finance.shift_chargeback': 'Charged a shift shortage back to a cashier',
		'finance.shift_chargeback_collected': 'Recovered a charged-back shortage',
		'finance.shift_chargeback_written_off': 'Wrote off a shift shortage',
		'finance.manual_cash_movement': 'Entered a manual cash movement',
		'finance.void_cash_movement': 'Voided a cash movement',
		'finance.day_close': 'Closed the business day',
		'finance.day_reopen': 'Reopened the business day',
		'finance.open_receivable': 'Opened a city-ledger receivable',
		'finance.settle_receivable': 'Collected a receivable',
		'finance.write_off_receivable': 'Wrote off a receivable',
		'finance.reopen_receivable': 'Reopened a receivable',
		'guest_message.cancellation_request': 'Guest requested a cancellation',
		'guest_message.decline_cancellation_request': "Declined a guest's cancellation request",
		'review.approve': 'Approved a guest review',
		'review.reject': 'Rejected a guest review',
		'hotel.invite_member': 'Invited a staff member',
		'hotel.remove_member': 'Removed a staff member',
		'hotel.change_role': "Changed a staff member's role"
	};
	function actionLabel(action: string): string {
		if (ACTION_LABELS[action]) return ACTION_LABELS[action];
		const part = action.includes('.') ? action.slice(action.indexOf('.') + 1) : action;
		const words = part.replace(/_/g, ' ');
		return words.charAt(0).toUpperCase() + words.slice(1);
	}

	function entityHref(entityType: string, entityId: string | null): string | null {
		if (!entityId) return null;
		if (entityType === 'booking') return `${base}/reservations/room/${entityId}`;
		if (entityType === 'hall_booking') return `${base}/reservations/hall/${entityId}`;
		if (entityType === 'cashier_shift') return `${base}/finance/shifts/${entityId}`;
		return null;
	}

	function entityTypeFilterChanged(value: string) {
		const url = new URL(page.url);
		if (value === 'all') url.searchParams.delete('entityType');
		else url.searchParams.set('entityType', value);
		goto(url.pathname + url.search, { keepFocus: true, noScroll: true });
	}

	function toggle(id: string) {
		const next = new Set(expanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expanded = next;
	}

	const filtered = $derived(
		data.entries.filter((e) => {
			if (!search.trim()) return true;
			const q = search.trim().toLowerCase();
			const hay = `${e.actorLabel ?? ''} ${actionLabel(e.action)} ${e.action} ${e.entityType} ${e.entityId ?? ''}`.toLowerCase();
			return hay.includes(q);
		})
	);
</script>

<div class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Audit log</h1>
			<p class="text-sm text-ink-muted">
				Every tracked mutation in this hotel — who booked, checked in/out, cancelled, took a
				payment, or changed a setting, and when. Most recent {data.entries.length} entries.
			</p>
		</div>
		<Button variant="outline" href="{base}/dashboard">← Dashboard</Button>
	</div>

	<div class="mb-4 flex flex-wrap items-center gap-3">
		<div class="relative min-w-48 flex-1">
			<SearchIcon class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
			<Input placeholder="Search actor, action, or entity…" bind:value={search} class="pl-8" />
		</div>
		<Select.Root type="single" value={data.entityType} onValueChange={entityTypeFilterChanged}>
			<Select.Trigger class="w-48 shrink-0">
				{data.entityType === 'all' ? 'All entity types' : data.entityType.replace(/_/g, ' ')}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="All entity types" />
				{#each data.entityTypes as t (t)}
					<Select.Item value={t} label={t.replace(/_/g, ' ')} />
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<div class="overflow-hidden rounded-xl border border-border">
		{#if filtered.length === 0}
			<div class="flex flex-col items-center gap-2 p-10 text-center">
				<ShieldCheckIcon class="size-6 text-ink-muted" />
				<p class="text-sm text-ink-muted">
					{data.entries.length === 0 ? 'Nothing recorded yet.' : 'No entries match these filters.'}
				</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="w-44">When</Table.Head>
						<Table.Head>Actor</Table.Head>
						<Table.Head>Action</Table.Head>
						<Table.Head>Entity</Table.Head>
						<Table.Head class="w-20"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each filtered as e (e.id)}
						{@const href = entityHref(e.entityType, e.entityId)}
						{@const hasDetail = e.before != null || e.after != null}
						<Table.Row>
							<Table.Cell class="align-top text-xs whitespace-nowrap text-ink-muted">
								{fmtDateTime(e.createdAt)}
							</Table.Cell>
							<Table.Cell class="align-top">
								{#if e.actorLabel}
									<div class="text-ink">{e.actorLabel.split(' <')[0]}</div>
									<div class="text-xs break-all text-ink-muted">
										{e.actorLabel.match(/<(.+)>/)?.[1] ?? ''}
									</div>
								{:else}
									<Badge variant="outline" class="border-border bg-surface-2 text-ink-muted">System</Badge>
								{/if}
							</Table.Cell>
							<Table.Cell class="align-top">
								<div class="text-ink">{actionLabel(e.action)}</div>
								<div class="text-xs text-ink-muted">{e.action}</div>
							</Table.Cell>
							<Table.Cell class="align-top text-xs text-ink-muted">
								<span class="capitalize">{e.entityType.replace(/_/g, ' ')}</span>
								{#if href}
									<a {href} class="ml-1 underline underline-offset-2 hover:text-ink">open →</a>
								{:else if e.entityId}
									<span class="ml-1 font-mono">{e.entityId.slice(0, 8)}</span>
								{/if}
							</Table.Cell>
							<Table.Cell class="align-top text-right">
								{#if hasDetail}
									<Button variant="ghost" size="sm" onclick={() => toggle(e.id)}>
										<ChevronDownIcon
											class="size-4 transition-transform {expanded.has(e.id) ? 'rotate-180' : ''}"
										/>
									</Button>
								{/if}
							</Table.Cell>
						</Table.Row>
						{#if hasDetail && expanded.has(e.id)}
							<Table.Row>
								<Table.Cell colspan={5} class="bg-surface-2">
									<div class="grid gap-3 py-1 sm:grid-cols-2">
										{#if e.before != null}
											<div>
												<div class="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
													Before
												</div>
												<pre class="overflow-x-auto rounded-md border border-border bg-surface p-2 text-xs text-ink">{JSON.stringify(e.before, null, 2)}</pre>
											</div>
										{/if}
										{#if e.after != null}
											<div>
												<div class="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
													After
												</div>
												<pre class="overflow-x-auto rounded-md border border-border bg-surface p-2 text-xs text-ink">{JSON.stringify(e.after, null, 2)}</pre>
											</div>
										{/if}
									</div>
								</Table.Cell>
							</Table.Row>
						{/if}
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>
</div>
