<script lang="ts">
	import UsersIcon from '@lucide/svelte/icons/users';
	import BellRingIcon from '@lucide/svelte/icons/bell-ring';
	import QrCodeIcon from '@lucide/svelte/icons/qr-code';
	import ReceiptTextIcon from '@lucide/svelte/icons/receipt-text';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { STAGE_LABEL, compareUrgency, matchesFilter, type FloorFilter, type FloorReservation, type TableView } from '$lib/dining-floor';
	import { formatWait } from '$lib/dining-orders';
	import { PILL, STAGE_STYLE } from './stage-style';

	interface ListRes extends FloorReservation {
		guestName: string;
		partySize: number;
	}

	interface ListTable {
		id: string;
		name: string;
		seats: number;
		areaName: string | null;
	}

	let {
		tables,
		views,
		filter,
		selectedId,
		nowMs,
		onselect
	}: {
		tables: ListTable[];
		views: Record<string, TableView<ListRes>>;
		filter: FloorFilter;
		selectedId: string | null;
		nowMs: number;
		onselect: (id: string) => void;
	} = $props();

	const rows = $derived(
		tables
			.map((t) => ({ ...t, view: views[t.id]! }))
			.filter((t) => matchesFilter(t.view, filter))
			.sort(compareUrgency)
	);
	const seatedFor = (v: TableView<ListRes>) => (v.seatedSince ? formatWait(Math.max(0, Math.floor((nowMs - v.seatedSince.getTime()) / 60_000))) : '');
</script>

{#if rows.length === 0}
	<p class="rounded-xl border border-dashed border-border p-10 text-center text-sm text-ink-muted">No table matches. Choose "All" above.</p>
{:else}
	<ul class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface" aria-label="Tables, most urgent first">
		{#each rows as t (t.id)}
			{@const v = t.view}
			<li>
				<button
					type="button"
					class="flex min-h-16 w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-surface-2 focus-visible:bg-surface-2 {selectedId === t.id ? 'bg-surface-2' : ''}"
					aria-label="{t.name}, {STAGE_LABEL[v.stage]}"
					onclick={() => onselect(t.id)}
				>
					<span class="w-14 shrink-0 text-base font-semibold text-ink">{t.name}</span>
					<span class="min-w-0 flex-1">
						<span class="flex flex-wrap items-center gap-x-2 gap-y-1">
							<span class="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
								<span class="size-2 shrink-0 rounded-full {STAGE_STYLE[v.stage].dot}" aria-hidden="true"></span>{STAGE_LABEL[v.stage]}
							</span>
							{#if v.foodReady > 0}
								<span class="{PILL} border-warning/60">
									<BellRingIcon class="size-3 text-warning" aria-hidden="true" />{v.foodReady} to serve
								</span>
							{/if}
							{#if v.qrWaiting > 0}
								<span class="{PILL} border-border">
									<QrCodeIcon class="size-3" aria-hidden="true" />{v.qrWaiting} to accept
								</span>
							{/if}
							{#if v.billAsked}
								<span class="inline-flex items-center gap-1 text-xs font-medium text-ink">
									<ReceiptTextIcon class="size-3 text-warning" aria-hidden="true" />Asked for the bill
								</span>
							{/if}
						</span>
						<span class="mt-0.5 block text-xs text-ink-muted">
							<span class="inline-flex items-center gap-0.5"><UsersIcon class="size-3" aria-hidden="true" />{t.seats}</span>
							{#if t.areaName} · {t.areaName}{/if}
							{#if v.seatedSince} · seated {seatedFor(v)}{/if}
							{#if v.reservation && v.stage !== 'occupied' && v.stage !== 'needs_payment' && v.stage !== 'ready_to_clear'} · {v.reservation.guestName} ×{v.reservation.partySize}{/if}
						</span>
					</span>
					<ChevronRightIcon class="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
				</button>
			</li>
		{/each}
	</ul>
{/if}
