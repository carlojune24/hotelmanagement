<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import AuditDetail from '$lib/components/staff/audit-detail.svelte';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
	import { formatTrailTime } from '$lib/dining-trail-doc';
	import { ACTOR_KIND_LABEL } from '$lib/audit-labels';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const base = $derived(`/${page.params.hotel}/management`);
	const trail = $derived(data.trail);
	const res = $derived(trail.reservation);
	const multi = $derived(trail.orders.length > 1);

	const peso = (c: number) =>
		`₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const words = (s: string) => s.replace(/_/g, ' ');
	const METHOD: Record<string, string> = {
		cash: 'Cash',
		card: 'Card',
		gcash: 'GCash',
		maya: 'Maya',
		paymongo: 'Online (PayMongo)',
		bank_transfer: 'Bank transfer',
		unknown: 'Unknown'
	};
	const when = (iso: string) => formatTrailTime(iso, data.timezone);

	let expanded = $state<Set<number>>(new Set());
	function toggle(i: number) {
		const next = new Set(expanded);
		if (next.has(i)) next.delete(i);
		else next.add(i);
		expanded = next;
	}

	// A plain, calm badge per kind of actor: the point is to tell staff from guest from system at a glance.
	const kindClass = (kind: string) =>
		kind === 'staff'
			? 'border-border bg-surface-2 text-ink'
			: kind === 'guest'
				? 'border-amber-300/70 bg-amber-50 text-amber-900'
				: kind === 'system'
					? 'border-sky-300/70 bg-sky-50 text-sky-900'
					: 'border-dashed border-border bg-transparent text-ink-muted';
	const kindText = (kind: string) => (kind === 'unknown' ? 'Not recorded' : ACTOR_KIND_LABEL[kind as keyof typeof ACTOR_KIND_LABEL]);
	const hasDetail = (e: (typeof trail.events)[number]) => !!e.ip || !!e.userAgent || e.before != null || e.after != null;
</script>

<svelte:head>
	<title>Trail {trail.ref}</title>
</svelte:head>

<div class="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<a href="{base}/lookup?q={trail.ref}" class="text-xs text-ink-muted underline-offset-2 hover:underline">← Find by number</a>
			<h1 class="mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight text-ink">
				<span class="font-mono">{trail.ref}</span>
				<span class="text-base font-normal text-ink-muted">
					{trail.kind === 'reservation' ? 'Table reservation trail' : 'Dining order trail'}
				</span>
			</h1>
			<p class="mt-0.5 text-sm text-ink-muted">
				Every step from the first click to the last refund, and who did it.
			</p>
		</div>
		<div class="flex items-center gap-2">
			<Button href="/{page.params.hotel}/print/dining-trail/{trail.ref}" target="_blank" rel="noopener" variant="outline" size="sm">
				<PrinterIcon class="size-4" /> Print
			</Button>
			<Button href="{base}/trail/{trail.ref}/csv" variant="outline" size="sm" download>
				<DownloadIcon class="size-4" /> CSV
			</Button>
		</div>
	</div>

	<!-- What this is -->
	<section class="rounded-xl border border-border p-4" aria-label="Summary">
		{#if res}
			<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
				<span class="font-medium text-ink">Reservation <span class="font-mono">{res.code}</span></span>
				<Badge variant="outline" class="capitalize">{words(res.status)}</Badge>
				<span class="text-sm text-ink-muted">
					{res.guestName} · party of {res.partySize}{res.tables.length ? ` · table ${res.tables.join(', ')}` : ''} · {res.venue} · {when(res.startsAt)}
				</span>
			</div>
		{/if}
		{#each trail.orders as o (o.id)}
			<div class="flex flex-wrap items-center gap-x-3 gap-y-1 {res ? 'mt-2 border-t border-border pt-2' : ''}">
				<a href="{base}/trail/{o.code}" class="font-medium text-ink underline-offset-2 hover:underline">
					Order <span class="font-mono">{o.code}</span>
				</a>
				<Badge variant="outline" class="capitalize">{words(o.status)}</Badge>
				<Badge variant="outline" class="capitalize">{words(o.paymentStatus)}</Badge>
				<span class="text-sm text-ink-muted">
					{words(o.orderType)}{o.tableLabel ? ` · table ${o.tableLabel}` : ''}{o.guestName ? ` · ${o.guestName}` : ''} · {o.venue} · {peso(o.totalCentavos)}
				</span>
				{#if o.lines.length}
					<p class="w-full text-xs text-ink-muted">{o.lines.map((l) => `${l.quantity}× ${l.name}`).join(', ')}</p>
				{/if}
			</div>
		{/each}
		{#if trail.orders.length === 0 && !res}
			<p class="text-sm text-ink-muted">Nothing found.</p>
		{/if}
	</section>

	<div class="grid gap-6 lg:grid-cols-2">
		<!-- Who handled it -->
		<section aria-labelledby="handled-h">
			<h2 id="handled-h" class="mb-2 text-sm font-semibold text-ink">Who handled it</h2>
			{#if trail.handled.length === 0}
				<p class="text-sm text-ink-muted">Nothing recorded yet.</p>
			{:else}
				<ul class="grid gap-2 sm:grid-cols-2">
					{#each trail.handled as h (h.role)}
						<li class="rounded-lg border border-border px-3 py-2">
							<div class="text-xs tracking-wide text-ink-muted uppercase">{h.role}</div>
							<div class="text-sm font-medium text-ink">{h.who}</div>
							{#if h.at}<div class="text-xs tabular-nums text-ink-muted">{when(h.at)}</div>{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- Money -->
		<section aria-labelledby="money-h">
			<h2 id="money-h" class="mb-2 text-sm font-semibold text-ink">Money</h2>
			<dl class="divide-y divide-border rounded-xl border border-border text-sm">
				<div class="flex justify-between px-3 py-2"><dt class="text-ink-muted">Billed</dt><dd class="tabular-nums text-ink">{peso(trail.money.billedCentavos)}</dd></div>
				{#each trail.money.byMethod as m (m.method)}
					<div class="flex justify-between px-3 py-2"><dt class="text-ink-muted">Collected by {METHOD[m.method] ?? words(m.method)}</dt><dd class="tabular-nums text-ink">{peso(m.centavos)}</dd></div>
				{/each}
				{#if trail.money.roomChargedCentavos}
					<div class="flex justify-between px-3 py-2"><dt class="text-ink-muted">Charged to a room bill</dt><dd class="tabular-nums text-ink">{peso(trail.money.roomChargedCentavos)}</dd></div>
				{/if}
				<div class="flex justify-between px-3 py-2"><dt class="text-ink-muted">Refunded</dt><dd class="tabular-nums text-ink">{peso(trail.money.refundedCentavos)}</dd></div>
				<div class="flex justify-between bg-surface-2 px-3 py-2 font-medium"><dt class="text-ink">Net collected</dt><dd class="tabular-nums text-ink">{peso(trail.money.netCentavos)}</dd></div>
			</dl>
		</section>
	</div>

	<!-- Documents -->
	<section aria-labelledby="docs-h">
		<h2 id="docs-h" class="mb-2 text-sm font-semibold text-ink">Receipts and invoices</h2>
		{#if trail.documents.length === 0}
			<p class="text-sm text-ink-muted">No receipt or invoice issued.</p>
		{:else}
			<ul class="divide-y divide-border overflow-hidden rounded-xl border border-border text-sm">
				{#each trail.documents as d (d.id)}
					<li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
						<a
							href="/{page.params.hotel}/print/{d.type === 'invoice' ? 'invoice' : 'receipt'}/{d.id}"
							target="_blank"
							rel="noopener"
							class="font-mono font-medium text-ink underline-offset-2 hover:underline">{d.formattedNo}</a
						>
						<span class="text-ink-muted">{d.type === 'invoice' ? 'Invoice' : 'Official receipt'}</span>
						{#if d.status !== 'issued'}<Badge variant="outline" class="capitalize">{d.status}</Badge>{/if}
						<span class="text-xs text-ink-muted">issued {when(d.issuedAt)} by {d.issuedBy ?? 'not recorded'}</span>
						{#if d.cancelledAt}
							<span class="text-xs text-ink-muted">· cancelled {when(d.cancelledAt)}{d.cancelledBy ? ` by ${d.cancelledBy}` : ''}{d.cancelReason ? `: ${d.cancelReason}` : ''}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Timeline -->
	<section aria-labelledby="timeline-h">
		<h2 id="timeline-h" class="mb-2 text-sm font-semibold text-ink">Timeline</h2>
		{#if trail.events.length === 0}
			<p class="rounded-xl border border-dashed border-border p-8 text-center text-sm text-ink-muted">Nothing has been recorded against this number yet.</p>
		{:else}
			<div class="overflow-hidden rounded-xl border border-border">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head class="w-44">When</Table.Head>
							<Table.Head class="w-48">Who</Table.Head>
							<Table.Head>What</Table.Head>
							<Table.Head class="w-28 text-right">Amount</Table.Head>
							{#if trail.detailed}<Table.Head class="w-10"><span class="sr-only">Details</span></Table.Head>{/if}
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each trail.events as e, i (i)}
							<Table.Row>
								<Table.Cell class="align-top text-xs tabular-nums whitespace-nowrap text-ink-muted">{when(e.at)}</Table.Cell>
								<Table.Cell class="align-top">
									<div class="text-sm text-ink">{e.actor.kind === 'unknown' ? '' : e.actor.label}</div>
									<Badge variant="outline" class="mt-0.5 text-[11px] {kindClass(e.actor.kind)}">{kindText(e.actor.kind)}</Badge>
								</Table.Cell>
								<Table.Cell class="align-top">
									<div class="text-sm text-ink">
										{e.label}
										{#if multi && e.code}<span class="ml-1 font-mono text-xs text-ink-muted">{e.code}</span>{/if}
									</div>
									{#if e.detail}<div class="text-xs break-words text-ink-muted">{e.detail}</div>{/if}
									{#if e.source === 'record'}<div class="text-[11px] text-ink-muted italic">from records</div>{/if}
								</Table.Cell>
								<Table.Cell class="align-top text-right text-sm tabular-nums text-ink">{e.amountCentavos != null ? peso(e.amountCentavos) : ''}</Table.Cell>
								{#if trail.detailed}
									<Table.Cell class="align-top text-right">
										{#if hasDetail(e)}
											<button
												type="button"
												class="rounded p-1 text-ink-muted hover:text-ink"
												aria-expanded={expanded.has(i)}
												aria-label="Show device and data"
												onclick={() => toggle(i)}
											>
												<ChevronDownIcon class="size-4 transition-transform {expanded.has(i) ? 'rotate-180' : ''}" />
											</button>
										{/if}
									</Table.Cell>
								{/if}
							</Table.Row>
							{#if trail.detailed && expanded.has(i)}
								<Table.Row>
									<Table.Cell colspan={5} class="bg-surface-2">
										<AuditDetail ip={e.ip} userAgent={e.userAgent} before={e.before} after={e.after} />
									</Table.Cell>
								</Table.Row>
							{/if}
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
			{#if trail.detailed}
				<p class="mt-2 flex items-start gap-1.5 text-xs text-ink-muted">
					<ShieldAlertIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
					IP addresses and browsers are personal data under the Data Privacy Act. Only hotel administrators see them; please do not share them.
				</p>
			{/if}
		{/if}
	</section>
</div>
