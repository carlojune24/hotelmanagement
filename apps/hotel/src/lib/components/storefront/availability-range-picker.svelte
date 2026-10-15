<script lang="ts">
	import { addDays, nightsAreFree, type DayAvailability, type DayStatus } from '$lib/day-availability';
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import XIcon from '@lucide/svelte/icons/x';

	let {
		days,
		today,
		checkIn = $bindable(''),
		checkOut = $bindable('')
	}: {
		/** One entry per night from `today` on — free / few left / full. */
		days: DayAvailability[];
		/** The hotel's own current date (YYYY-MM-DD), the first pickable day. */
		today: string;
		checkIn?: string;
		checkOut?: string;
	} = $props();

	const byDate = $derived(new Map(days.map((d) => [d.date, d])));
	const statusByDate = $derived(
		new Map<string, DayStatus>(days.map((d) => [d.date, d.status]))
	);
	const lastDate = $derived(days.at(-1)?.date ?? today);

	let open = $state(false);
	let hover = $state('');
	let wide = $state(true);
	let viewMonth = $state(''); // first day of the left-most month shown, YYYY-MM-01
	let rootEl: HTMLDivElement | undefined = $state();
	let triggerEl: HTMLButtonElement | undefined = $state();

	$effect(() => {
		const mq = window.matchMedia('(min-width: 720px)');
		const sync = () => (wide = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});

	const monthOf = (iso: string) => `${iso.slice(0, 7)}-01`;
	const shiftMonth = (first: string, n: number) => {
		const [y, m] = first.split('-').map(Number);
		const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
		return d.toISOString().slice(0, 10);
	};

	function openPicker() {
		viewMonth = monthOf(checkIn || today);
		hover = '';
		open = true;
	}
	function closePicker() {
		open = false;
		triggerEl?.focus();
	}

	const shownMonths = $derived(
		(wide ? [0, 1] : [0]).map((n) => {
			const first = shiftMonth(viewMonth || monthOf(today), n);
			const [y, m] = first.split('-').map(Number);
			const count = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
			const lead = new Date(`${first}T00:00:00Z`).getUTCDay();
			const cells: (string | null)[] = [
				...Array.from({ length: lead }, () => null),
				...Array.from({ length: count }, (_, i) => addDays(first, i))
			];
			return {
				first,
				label: new Intl.DateTimeFormat('en-PH', {
					month: 'long',
					year: 'numeric',
					timeZone: 'UTC'
				}).format(new Date(`${first}T00:00:00Z`)),
				cells
			};
		})
	);

	const canGoPrev = $derived(viewMonth > monthOf(today));
	const canGoNext = $derived(shiftMonth(viewMonth || monthOf(today), wide ? 2 : 1) <= lastDate);

	/** Choosing a departure: only days after arrival with no sold-out night in between. */
	const choosingDeparture = $derived(Boolean(checkIn) && !checkOut);

	function pickable(date: string): boolean {
		if (date < today || date > lastDate) return false;
		if (choosingDeparture) {
			if (date > checkIn) return nightsAreFree(statusByDate, checkIn, date);
			return statusByDate.get(date) !== 'full'; // could restart the stay here
		}
		return statusByDate.get(date) !== 'full';
	}

	function pick(date: string) {
		if (!pickable(date)) return;
		if (choosingDeparture && date > checkIn) {
			checkOut = date;
			hover = '';
			closePicker();
			return;
		}
		checkIn = date;
		checkOut = '';
	}

	function reset() {
		checkIn = '';
		checkOut = '';
		hover = '';
	}

	const rangeEnd = $derived(checkOut || (choosingDeparture && hover > checkIn ? hover : ''));
	const inRange = (date: string) => Boolean(checkIn && rangeEnd && date > checkIn && date < rangeEnd);

	const fmtShort = (iso: string) =>
		new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
			new Date(`${iso}T00:00:00Z`)
		);
	const fmtLong = (iso: string) =>
		new Intl.DateTimeFormat('en-PH', {
			weekday: 'long',
			month: 'long',
			day: 'numeric',
			year: 'numeric',
			timeZone: 'UTC'
		}).format(new Date(`${iso}T00:00:00Z`));

	const nights = $derived(
		checkIn && checkOut
			? Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000)
			: 0
	);

	function label(date: string): string {
		const d = byDate.get(date);
		const tail =
			d?.status === 'full'
				? ', sold out'
				: d?.status === 'few'
					? `, only ${d.roomsLeft} room${d.roomsLeft === 1 ? '' : 's'} left`
					: ', available';
		return fmtLong(date) + tail;
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) closePicker();
	}
	function onDocClick(e: MouseEvent) {
		if (open && wide && rootEl && !rootEl.contains(e.target as Node)) open = false;
	}

	// Full-screen sheet on phones: lock page scroll behind it, and lift the search dock above the
	// sticky nav (z-index 30) — the sheet lives inside the dock's own stacking layer, so without
	// this the nav would paint over the top of it.
	$effect(() => {
		if (!open || wide) return;
		const prevOverflow = document.body.style.overflow;
		const dock = rootEl?.closest<HTMLElement>('.storefront-search-dock-panel');
		const prevZ = dock?.style.zIndex ?? '';
		document.body.style.overflow = 'hidden';
		if (dock) dock.style.zIndex = '70';
		return () => {
			document.body.style.overflow = prevOverflow;
			if (dock) dock.style.zIndex = prevZ;
		};
	});
</script>

<svelte:window onkeydown={onKeydown} onclick={onDocClick} />

<div class="picker" bind:this={rootEl}>
	<input type="hidden" name="checkIn" value={checkIn} />
	<input type="hidden" name="checkOut" value={checkOut} />

	<button
		type="button"
		class="trigger"
		bind:this={triggerEl}
		aria-haspopup="dialog"
		aria-expanded={open}
		onclick={() => (open ? closePicker() : openPicker())}
	>
		<CalendarDaysIcon class="size-5 shrink-0" aria-hidden="true" />
		<span class="trigger-col">
			<span class="trigger-label">Arrival</span>
			<span class="trigger-value" class:placeholder={!checkIn}>{checkIn ? fmtShort(checkIn) : 'Select date'}</span>
		</span>
		<span class="trigger-arrow" aria-hidden="true">→</span>
		<span class="trigger-col">
			<span class="trigger-label">Departure</span>
			<span class="trigger-value" class:placeholder={!checkOut}>{checkOut ? fmtShort(checkOut) : 'Select date'}</span>
		</span>
		{#if nights > 0}
			<span class="trigger-nights">{nights} night{nights === 1 ? '' : 's'}</span>
		{/if}
	</button>

	{#if open}
		<div class="sheet" role="dialog" aria-modal={!wide} aria-label="Choose your dates">
			<div class="sheet-head">
				<div>
					<div class="sheet-title">
						{choosingDeparture ? 'Choose your departure' : 'Choose your arrival'}
					</div>
					<div class="sheet-sub">
						{#if choosingDeparture}
							Arrival {fmtShort(checkIn)} — tap the day you leave
						{:else}
							Days crossed out are sold out
						{/if}
					</div>
				</div>
				<button type="button" class="icon-btn close" onclick={closePicker} aria-label="Close calendar">
					<XIcon class="size-5" aria-hidden="true" />
				</button>
			</div>

			<div class="months">
				<button
					type="button"
					class="icon-btn nav prev"
					onclick={() => (viewMonth = shiftMonth(viewMonth, -1))}
					disabled={!canGoPrev}
					aria-label="Previous month"
				>
					<ChevronLeftIcon class="size-5" aria-hidden="true" />
				</button>
				<button
					type="button"
					class="icon-btn nav next"
					onclick={() => (viewMonth = shiftMonth(viewMonth, 1))}
					disabled={!canGoNext}
					aria-label="Next month"
				>
					<ChevronRightIcon class="size-5" aria-hidden="true" />
				</button>

				{#each shownMonths as month (month.first)}
					<div class="month">
						<div class="month-name">{month.label}</div>
						<div class="grid weekdays" aria-hidden="true">
							{#each ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as w (w)}<span>{w}</span>{/each}
						</div>
						<div class="grid" role="grid" aria-label={month.label}>
							{#each month.cells as date, i (date ?? `pad-${month.first}-${i}`)}
								{#if date === null}
									<span></span>
								{:else}
									{@const info = byDate.get(date)}
									{@const ok = pickable(date)}
									<button
										type="button"
										class="day"
										class:past={date < today}
										class:full={info?.status === 'full'}
										class:few={info?.status === 'few'}
										class:selected={date === checkIn || date === checkOut}
										class:range={inRange(date)}
										class:start={date === checkIn && Boolean(rangeEnd)}
										class:end={date === rangeEnd}
										class:today={date === today}
										disabled={!ok}
										aria-label={label(date)}
										aria-pressed={date === checkIn || date === checkOut}
										onclick={() => pick(date)}
										onmouseenter={() => (hover = date)}
										onfocus={() => (hover = date)}
									>
										<span class="num">{Number(date.slice(8))}</span>
										{#if info?.status === 'few' && date >= today}
											<span class="left">{info.roomsLeft}</span>
										{/if}
									</button>
								{/if}
							{/each}
						</div>
					</div>
				{/each}
			</div>

			<div class="legend" aria-hidden="true">
				<span><i class="dot free"></i>Available</span>
				<span><i class="dot few"></i>Few rooms left</span>
				<span><i class="dot full"></i>Sold out</span>
			</div>

			<div class="sheet-foot">
				<button type="button" class="clear" onclick={reset} disabled={!checkIn && !checkOut}>
					Clear dates
				</button>
				{#if !wide}
					<button type="button" class="done" onclick={closePicker} disabled={!checkOut}>
						{checkOut ? `Done · ${nights} night${nights === 1 ? '' : 's'}` : 'Pick your dates'}
					</button>
				{/if}
			</div>
		</div>
		{#if !wide}<div class="backdrop" aria-hidden="true"></div>{/if}
	{/if}
</div>

<style>
	.picker {
		position: relative;
		min-width: 0;
	}

	/* ---- trigger: one ruled field showing arrival → departure ---- */
	.trigger {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		min-height: 3.25rem;
		padding: 0.5rem 0.875rem;
		text-align: left;
		background: var(--ledger-paper);
		border: 1px solid var(--ledger-rule);
		border-radius: 6px;
		color: var(--ledger-ink);
		cursor: pointer;
		transition: border-color 0.15s ease;
	}
	.trigger:hover,
	.trigger[aria-expanded='true'] {
		border-color: var(--hotel-accent);
	}
	.trigger:focus-visible {
		outline: 2px solid var(--hotel-accent);
		outline-offset: 2px;
	}
	.trigger-col {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.trigger-label {
		font-size: 0.6875rem;
		font-weight: 500;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--ledger-ink-muted);
	}
	.trigger-value {
		font-family: var(--ledger-font-data, 'JetBrains Mono Variable', ui-monospace, monospace);
		font-size: 0.9375rem;
		font-weight: 500;
		white-space: nowrap;
	}
	.trigger-value.placeholder {
		color: var(--ledger-ink-muted);
		font-weight: 400;
	}
	.trigger-arrow {
		color: var(--ledger-ink-muted);
	}
	.trigger-nights {
		margin-left: auto;
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--hotel-accent-deep);
		border: 1px solid var(--ledger-rule);
		border-radius: 999px;
		white-space: nowrap;
	}

	/* ---- the calendar surface: popover on desktop, full-screen sheet on phones ---- */
	.sheet {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		flex-direction: column;
		background: var(--ledger-paper);
		padding: 1rem 1rem 0;
		overflow-y: auto;
	}
	.backdrop {
		display: none;
	}
	.sheet-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--ledger-rule);
	}
	.sheet-title {
		font-family: var(--ledger-font-display, Georgia, serif);
		font-size: 1.25rem;
		font-weight: 500;
		color: var(--hotel-accent-deep);
	}
	.sheet-sub {
		margin-top: 0.125rem;
		font-size: 0.8125rem;
		color: var(--ledger-ink-muted);
	}
	.months {
		position: relative;
		display: grid;
		gap: 1.5rem;
		padding: 1rem 0;
	}
	.month-name {
		text-align: center;
		font-family: var(--ledger-font-display, Georgia, serif);
		font-size: 1.0625rem;
		font-weight: 500;
		margin-bottom: 0.5rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		row-gap: 2px;
	}
	.weekdays span {
		text-align: center;
		padding-bottom: 0.25rem;
		font-size: 0.6875rem;
		font-weight: 500;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--ledger-ink-muted);
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		color: var(--ledger-ink);
		background: transparent;
		border: 1px solid var(--ledger-rule);
		border-radius: 999px;
		cursor: pointer;
	}
	.icon-btn:hover:not(:disabled) {
		border-color: var(--hotel-accent);
	}
	.icon-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.icon-btn:focus-visible,
	.day:focus-visible,
	.clear:focus-visible,
	.done:focus-visible {
		outline: 2px solid var(--hotel-accent);
		outline-offset: 2px;
	}
	.nav {
		position: absolute;
		top: 0.75rem;
		width: 2.25rem;
		height: 2.25rem;
	}
	.nav.prev {
		left: 0;
	}
	.nav.next {
		right: 0;
	}

	/* ---- day cells ---- */
	.day {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
		min-height: 2.75rem;
		font: inherit;
		color: var(--ledger-ink);
		background: transparent;
		border: 0;
		border-radius: 6px;
		cursor: pointer;
	}
	.num {
		font-family: var(--ledger-font-data, 'JetBrains Mono Variable', ui-monospace, monospace);
		font-size: 0.9375rem;
		font-weight: 500;
	}
	.day:hover:not(:disabled) {
		background: var(--ledger-paper-2);
	}
	.day.today .num {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.day.few::after {
		content: '';
		position: absolute;
		left: 22%;
		right: 22%;
		bottom: 5px;
		height: 2px;
		background: var(--hotel-accent);
	}
	.left {
		position: absolute;
		top: 2px;
		right: 5px;
		font-family: var(--ledger-font-data, 'JetBrains Mono Variable', ui-monospace, monospace);
		font-size: 0.625rem;
		font-weight: 600;
		color: var(--hotel-accent-deep);
	}
	.day.full .num,
	.day.past .num {
		color: var(--ledger-ink-muted);
		opacity: 0.55;
		text-decoration: line-through;
	}
	.day.past .num {
		text-decoration: none;
	}
	.day:disabled {
		cursor: not-allowed;
	}
	.day.range {
		background: color-mix(in oklch, var(--hotel-accent) 12%, var(--ledger-paper));
		border-radius: 0;
	}
	.day.selected {
		background: var(--hotel-accent);
		border-radius: 6px;
	}
	.day.selected .num {
		color: var(--ledger-paper);
		opacity: 1;
		text-decoration: none;
	}
	.day.selected .left {
		color: var(--ledger-paper);
	}
	.day.selected.few::after {
		background: var(--ledger-paper);
	}
	.day.start {
		border-radius: 6px 0 0 6px;
	}
	.day.end {
		border-radius: 0 6px 6px 0;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.25rem;
		padding: 0.75rem 0;
		border-top: 1px solid var(--ledger-rule);
		font-size: 0.75rem;
		color: var(--ledger-ink-muted);
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}
	.dot {
		display: inline-block;
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 3px;
	}
	.dot.free {
		border: 1px solid var(--ledger-rule);
	}
	.dot.few {
		border: 1px solid var(--ledger-rule);
		background: linear-gradient(to top, var(--hotel-accent) 2px, transparent 2px);
	}
	.dot.full {
		background: repeating-linear-gradient(
			135deg,
			var(--ledger-rule),
			var(--ledger-rule) 2px,
			transparent 2px,
			transparent 4px
		);
	}

	.sheet-foot {
		position: sticky;
		bottom: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: auto;
		padding: 0.75rem 0 1rem;
		background: var(--ledger-paper);
		border-top: 1px solid var(--ledger-rule);
	}
	.clear {
		padding: 0.5rem 0.25rem;
		font: inherit;
		font-size: 0.875rem;
		color: var(--ledger-ink-muted);
		background: none;
		border: 0;
		border-bottom: 1px solid var(--ledger-rule);
		cursor: pointer;
	}
	.clear:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.done {
		flex: 1;
		min-height: 3rem;
		padding: 0.75rem 1.25rem;
		font: inherit;
		font-weight: 600;
		color: var(--ledger-paper);
		background: var(--hotel-accent);
		border: 0;
		border-radius: 4px;
		cursor: pointer;
	}
	.done:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (min-width: 720px) {
		.sheet {
			position: absolute;
			inset: auto;
			top: calc(100% + 0.5rem);
			left: 0;
			width: max(100%, 44rem);
			max-width: calc(100vw - 2.5rem);
			padding: 1.25rem 1.5rem 0;
			border: 1px solid var(--ledger-rule);
			border-radius: 10px;
			overflow: visible;
		}
		.close {
			display: none;
		}
		.months {
			grid-template-columns: 1fr 1fr;
			column-gap: 2.5rem;
		}
		.sheet-foot {
			position: static;
			padding: 0.75rem 0 1rem;
		}
	}
</style>
