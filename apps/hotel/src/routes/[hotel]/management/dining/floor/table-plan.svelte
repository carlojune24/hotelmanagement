<script lang="ts">
	import { toast } from 'svelte-sonner';
	import UsersIcon from '@lucide/svelte/icons/users';
	import BellRingIcon from '@lucide/svelte/icons/bell-ring';
	import QrCodeIcon from '@lucide/svelte/icons/qr-code';
	import ReceiptTextIcon from '@lucide/svelte/icons/receipt-text';
	import { STAGE_LABEL, matchesFilter, type FloorFilter, type TableView } from '$lib/dining-floor';
	import { formatWait } from '$lib/dining-orders';
	import { PILL, STAGE_STYLE } from './stage-style';

	interface PlanTable {
		id: string;
		name: string;
		seats: number;
		x: number;
		y: number;
	}

	let {
		tables,
		views,
		mode,
		filter,
		selectedId,
		nowMs,
		highlight = [],
		onselect,
		onedit
	}: {
		tables: PlanTable[];
		views: Record<string, TableView>;
		mode: 'service' | 'edit';
		filter: FloorFilter;
		selectedId: string | null;
		nowMs: number;
		/** Tables lit up because their reservation is picked in the day rail. */
		highlight?: string[];
		onselect: (id: string) => void;
		onedit: (id: string) => void;
	} = $props();

	const GRID_COLS = 30; // keep in step with GRID_COLS on the server
	const MIN_CELL = 16;
	const MAX_CELL = 34;

	// The plan scales to the width it is given, so it fits a tablet without sideways scrolling.
	let width = $state(0);
	const cell = $derived(Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor((width || 720) / GRID_COLS))));

	// Dragged positions override what the server sent until the next load.
	let positions = $state<Record<string, { x: number; y: number }>>({});
	const placed = $derived(tables.map((t) => ({ ...t, ...(positions[t.id] ?? {}) })));

	function size(seats: number) {
		if (seats <= 2) return { w: 3, h: 3 };
		if (seats <= 4) return { w: 4, h: 3 };
		if (seats <= 6) return { w: 5, h: 3 };
		if (seats <= 8) return { w: 6, h: 4 };
		return { w: 7, h: 4 };
	}
	const rows = $derived(Math.max(14, ...placed.map((t) => t.y + size(t.seats).h + 2)));

	const seatedFor = (v: TableView) => (v.seatedSince ? formatWait(Math.max(0, Math.floor((nowMs - v.seatedSince.getTime()) / 60_000))) : '');

	// ---- editing: drag to move, click to edit ---------------------------------------------
	let drag: { id: string; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null = null;

	function onPointerDown(e: PointerEvent, t: PlanTable) {
		if (mode !== 'edit') return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		drag = { id: t.id, startX: e.clientX, startY: e.clientY, originX: t.x, originY: t.y, moved: false };
	}
	function onPointerMove(e: PointerEvent, t: PlanTable) {
		if (!drag || drag.id !== t.id) return;
		const dx = e.clientX - drag.startX;
		const dy = e.clientY - drag.startY;
		if (!drag.moved && Math.hypot(dx, dy) < 4) return;
		drag.moved = true;
		const s = size(t.seats);
		positions[t.id] = {
			x: Math.min(GRID_COLS - s.w, Math.max(0, drag.originX + Math.round(dx / cell))),
			y: Math.max(0, drag.originY + Math.round(dy / cell))
		};
	}
	async function onPointerUp(t: PlanTable) {
		if (!drag || drag.id !== t.id) return;
		const { moved } = drag;
		drag = null;
		if (!moved) {
			onedit(t.id);
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
</script>

<div class="overflow-x-auto rounded-xl border border-border bg-surface" bind:clientWidth={width}>
	<div
		class="relative"
		style="width: {GRID_COLS * cell}px; height: {rows * cell}px; background-image: radial-gradient(circle, color-mix(in oklab, currentColor 14%, transparent) 1px, transparent 1.5px); background-size: {cell}px {cell}px;"
	>
		{#each placed as t (t.id)}
			{@const s = size(t.seats)}
			{@const v = views[t.id]!}
			{@const w = s.w * cell}
			{@const compact = w < 76}
			{@const dim = mode === 'service' && !matchesFilter(v, filter)}
			{@const style = `left:${t.x * cell}px; top:${t.y * cell}px; width:${w}px; height:${s.h * cell}px;`}
			{#if mode === 'edit'}
				<button
					type="button"
					{style}
					class="absolute flex touch-none flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-border bg-surface text-xs text-ink select-none hover:border-ink-muted active:cursor-grabbing cursor-grab"
					aria-label="{t.name}, {t.seats} seats. Drag to move, press Enter to edit."
					onpointerdown={(e) => onPointerDown(e, t)}
					onpointermove={(e) => onPointerMove(e, t)}
					onpointerup={() => onPointerUp(t)}
					onkeydown={(e) => e.key === 'Enter' && onedit(t.id)}
				>
					<span class="font-semibold">{t.name}</span>
					<span class="inline-flex items-center gap-0.5 opacity-80"><UsersIcon class="size-3" />{t.seats}</span>
				</button>
			{:else}
				<button
					type="button"
					{style}
					class="absolute flex flex-col items-center justify-center gap-0.5 rounded-lg border-2 px-0.5 text-center transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50 {STAGE_STYLE[v.stage].tile} {dim
						? 'opacity-30'
						: ''} {selectedId === t.id ? 'ring-2 ring-brand' : ''} {highlight.includes(t.id) ? 'ring-2 ring-brand/40' : ''}"
					aria-label="{t.name}, {t.seats} seats, {STAGE_LABEL[v.stage]}{v.foodReady ? `, ${v.foodReady} order${v.foodReady === 1 ? '' : 's'} ready to serve` : ''}{v.qrWaiting ? `, ${v.qrWaiting} QR order waiting` : ''}{v.billAsked ? ', asked for the bill' : ''}"
					aria-pressed={selectedId === t.id}
					onclick={() => onselect(t.id)}
				>
					<span class="leading-none font-semibold {compact ? 'text-sm' : 'text-base'}">{t.name}</span>
					{#if !compact}
						<span class="inline-flex items-center gap-0.5 text-xs leading-none text-ink-muted"><UsersIcon class="size-3" />{t.seats}</span>
					{/if}
					<span class="inline-flex items-center gap-1 text-[10px] leading-none font-medium tracking-wide text-ink-muted uppercase">
						<span class="size-1.5 shrink-0 rounded-full {STAGE_STYLE[v.stage].dot}" aria-hidden="true"></span>{STAGE_LABEL[v.stage]}
					</span>
					{#if v.seatedSince && !compact}
						<span class="text-[11px] leading-none tabular-nums text-ink-muted">{seatedFor(v)}</span>
					{/if}

					<!-- What needs a person, as icons in the corner, never colour alone -->
					<span class="absolute -top-2 -right-2 flex gap-1">
						{#if v.foodReady > 0}
							<span class="{PILL} border-warning/60" title="Ready to serve">
								<BellRingIcon class="size-3 text-warning" aria-hidden="true" />{v.foodReady}
							</span>
						{/if}
						{#if v.qrWaiting > 0}
							<span class="{PILL} border-border" title="QR order waiting">
								<QrCodeIcon class="size-3" aria-hidden="true" />{v.qrWaiting}
							</span>
						{/if}
						{#if v.billAsked && v.stage !== 'ready_to_clear'}
							<span class="{PILL} border-warning/60" title="Asked for the bill">
								<ReceiptTextIcon class="size-3 text-warning" aria-hidden="true" />
							</span>
						{/if}
					</span>
				</button>
			{/if}
		{/each}
	</div>
</div>
