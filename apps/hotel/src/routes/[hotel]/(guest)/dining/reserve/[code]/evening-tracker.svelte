<script lang="ts">
	import { tableLabel } from '$lib/dining-floor';
	import CheckIcon from '@lucide/svelte/icons/check';

	/**
	 * "Your evening" on the guest's reservation ticket: where the table is (reserved → seated → done) and
	 * where each order of the sitting is (ordered → kitchen starts → preparing → ready → served). A
	 * pre-order is held from the kitchen until the venue's prep time before the table (`dining-hold.ts`);
	 * `kitchenStartsAtIso` is that moment. Orders added at the table join once the party is seated.
	 */
	interface Order {
		kind: 'pre_order' | 'table';
		code: string;
		accessToken: string;
		status: string;
		paymentStatus: string;
		totalCentavos: number;
		items: { name: string; quantity: number }[];
		stations: { label: string; state: 'waiting' | 'cooking' | 'ready' }[];
		held: boolean;
		kitchenStartsAtIso: string | null;
		refundDue: boolean;
	}

	let {
		status,
		tableNames,
		startsAtIso,
		orders,
		timezone,
		nowIso,
		orderHref
	}: {
		/** The reservation's status. */
		status: string;
		tableNames: string[];
		startsAtIso: string;
		orders: Order[];
		timezone: string;
		nowIso: string;
		orderHref: (o: Order) => string;
	} = $props();

	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const dayKey = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(iso));
	const clock = (iso: string) => new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(iso));
	/** "7:30 PM" today, "Sat, Nov 14, 7:30 PM" on another day. */
	const when = (iso: string) =>
		dayKey(iso) === dayKey(nowIso)
			? clock(iso)
			: new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(iso));

	type Step = { label: string };
	/** `done` steps are finished; `current` is the one happening now (or next, when waiting). */
	type Track = { steps: Step[]; done: number; current: number | null };

	// ---- the table ----
	const closed = $derived(status === 'cancelled' || status === 'no_show' || status === 'expired');
	const tableTrack = $derived<Track>({
		steps: [
			{ label: status === 'pending' ? 'Awaiting payment' : 'Reserved' },
			{ label: tableNames.length ? `Seated, ${tableNames.map(tableLabel).join(', ')}` : 'Seated' },
			{ label: 'Done' }
		],
		// Reserved is ticked once confirmed; Seated only lights up when the party actually sits down.
		done: status === 'completed' ? 3 : status === 'seated' || status === 'confirmed' ? 1 : 0,
		current: status === 'seated' ? 1 : status === 'pending' ? 0 : null
	});
	const tableNote = $derived(
		status === 'pending'
			? 'Your table is held while your pre-order payment goes through.'
			: status === 'confirmed'
				? `Your table is ready for you at ${when(startsAtIso)}. Tell the host your reservation code when you arrive.`
				: status === 'seated'
					? 'You are seated. Anything you order at the table shows up below.'
					: status === 'completed'
						? 'Thank you for dining with us.'
						: status === 'no_show'
							? 'This reservation was closed as not attended.'
							: 'This reservation was cancelled.'
	);

	// ---- each order ----
	function orderTrack(o: Order): Track | null {
		if (o.status === 'cancelled') return null;
		const pre = o.kind === 'pre_order';
		const steps: Step[] = [
			{ label: 'Ordered' },
			...(pre && o.kitchenStartsAtIso ? [{ label: `Kitchen ${clock(o.kitchenStartsAtIso)}` }] : []),
			{ label: 'Preparing' },
			{ label: 'Ready' },
			{ label: 'Served' }
		];
		const k = steps.length - 4; // 1 when there is a "Kitchen" step, else 0
		const at = (n: number, current: number | null): Track => ({ steps, done: n, current });
		switch (o.status) {
			case 'pending_payment':
			case 'pending_acceptance':
				return at(0, 0);
			case 'new':
			case 'accepted':
				return o.held ? at(1, 1) : at(1 + k, 1 + k);
			case 'preparing':
				return at(1 + k, 1 + k);
			case 'ready':
				return at(2 + k, 2 + k);
			case 'served':
				return at(steps.length, null);
			default:
				return at(0, 0);
		}
	}

	function orderNote(o: Order): string {
		if (o.refundDue) return 'Cancelled. You paid for this, so the restaurant will send your refund.';
		if (o.status === 'cancelled') return 'Cancelled. Nothing is due.';
		if (o.status === 'pending_payment') return 'Waiting for your payment. Open it to pay and secure your order.';
		if (o.status === 'pending_acceptance') return 'Waiting for the restaurant to confirm it.';
		if ((o.status === 'new' || o.status === 'accepted') && o.held && o.kitchenStartsAtIso) {
			const mins = Math.round((new Date(startsAtIso).getTime() - new Date(o.kitchenStartsAtIso).getTime()) / 60_000);
			return `The kitchen starts it at ${when(o.kitchenStartsAtIso)}, ${mins} minutes before your table, or as soon as you are seated, so it is fresh when you sit down.`;
		}
		if (o.status === 'new' || o.status === 'accepted') return 'With the kitchen. They start it shortly.';
		if (o.status === 'preparing') return 'Being prepared.';
		if (o.status === 'ready') return 'Ready. It is on its way to your table.';
		if (o.status === 'served') return 'Served. Enjoy your meal.';
		return '';
	}

	const payLabel = (o: Order) =>
		o.kind === 'table'
			? 'Added at the table'
			: o.paymentStatus === 'paid'
				? 'Pre-order, paid'
				: o.paymentStatus === 'refunded'
					? 'Pre-order, refunded'
					: 'Pre-order';
	const STATION_WORD = { waiting: 'waiting', cooking: 'cooking', ready: 'ready' } as const;
</script>

{#snippet track(t: Track, label: string)}
	<!-- Wide: the ledger stepper. Narrow: the same steps as a list, so no label is cut. -->
	<ol class="ledger-stepper-horizontal mt-3 hidden sm:flex" aria-label={label}>
		{#each t.steps as s, i (i)}
			{@const isDone = i < t.done && i !== t.current}
			{@const isNow = i === t.current}
			<li class="ledger-stepper-node {isNow ? 'is-active' : ''} {isDone ? 'is-done' : ''}" aria-current={isNow ? 'step' : undefined}>
				<span class="ledger-stepper-node-circle">
					{#if isDone}<CheckIcon class="size-3.5" aria-hidden="true" />{:else}{i + 1}{/if}
				</span>
				<span class="ledger-stepper-node-label">{s.label}<span class="sr-only">{isDone ? ', done' : isNow ? ', now' : ''}</span></span>
			</li>
		{/each}
	</ol>
	<ol class="mt-3 space-y-1.5 sm:hidden" aria-label={label}>
		{#each t.steps as s, i (i)}
			{@const isDone = i < t.done && i !== t.current}
			{@const isNow = i === t.current}
			<li class="flex items-center gap-2.5 text-sm {isNow ? 'font-semibold text-[var(--ledger-ink)]' : 'text-[var(--ledger-ink-muted)]'}" aria-current={isNow ? 'step' : undefined}>
				<span
					class="inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.625rem]"
					style="border-color: {isNow ? 'var(--hotel-accent)' : isDone ? 'var(--hotel-accent-light)' : 'var(--ledger-rule)'}; background: {isNow ? 'var(--hotel-accent-light)' : 'transparent'}; color: var(--hotel-accent-deep);"
				>
					{#if isDone}<CheckIcon class="size-3" aria-hidden="true" />{:else}{i + 1}{/if}
				</span>
				{s.label}<span class="sr-only">{isDone ? ', done' : isNow ? ', now' : ''}</span>
			</li>
		{/each}
	</ol>
{/snippet}

<section class="mt-8" aria-labelledby="evening-h">
	<div class="flex items-baseline justify-between gap-3 border-b border-[var(--ledger-rule)] pb-2">
		<h2 id="evening-h" class="ledger-label">Your evening</h2>
		<span class="text-xs text-[var(--ledger-ink-muted)]">Updated {clock(nowIso)}</span>
	</div>

	<div class="border-b border-[var(--ledger-rule)] py-4">
		<h3 class="text-sm font-medium text-[var(--ledger-ink)]">Table</h3>
		{#if !closed}{@render track(tableTrack, 'Table progress')}{/if}
		<p class="mt-2 text-sm text-[var(--ledger-ink-muted)]" aria-live="polite">{tableNote}</p>
	</div>

	{#if orders.length > 0}
		<h3 class="pt-4 text-sm font-medium text-[var(--ledger-ink)]">Food</h3>
		<ul class="divide-y divide-[var(--ledger-rule)]">
			{#each orders as o (o.code)}
				{@const t = orderTrack(o)}
				<li class="py-4">
					<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
						<span class="flex items-baseline gap-2">
							<span class="ledger-data text-sm">{o.code}</span>
							<span class="text-xs text-[var(--ledger-ink-muted)]">{payLabel(o)}</span>
						</span>
						<span class="ledger-data text-sm">{peso(o.totalCentavos)}</span>
					</div>
					<p class="mt-0.5 text-sm text-[var(--ledger-ink-muted)]">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</p>
					{#if t}{@render track(t, `Order ${o.code} progress`)}{/if}
					<p class="mt-2 text-sm" aria-live="polite">{orderNote(o)}</p>
					{#if o.status === 'preparing' && o.stations.length > 1}
						<p class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-[var(--ledger-ink-muted)]">
							{#each o.stations as s (s.label)}
								<span><span class="text-[var(--ledger-ink)]">{s.label}</span> {STATION_WORD[s.state]}</span>
							{/each}
						</p>
					{/if}
					<a class="mt-1 inline-block text-sm underline underline-offset-2" href={orderHref(o)}>View order</a>
				</li>
			{/each}
		</ul>
	{:else if status === 'seated'}
		<p class="pt-4 text-sm text-[var(--ledger-ink-muted)]">Nothing ordered yet. Anything you order at the table shows up here.</p>
	{/if}
</section>
