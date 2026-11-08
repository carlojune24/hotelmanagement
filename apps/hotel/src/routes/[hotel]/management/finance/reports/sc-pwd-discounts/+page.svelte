<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
	import ReceiptTextIcon from '@lucide/svelte/icons/receipt-text';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const reports = $derived(`/${page.params.hotel}/management/finance/reports`);
	const mgmt = $derived(`/${page.params.hotel}/management`);
	const r = $derived(data.report);
	const t = $derived(r.totals);

	const peso = (c: number) =>
		`₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	// Business dates are plain calendar days: format them in UTC so no timezone shifts the day.
	const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
		new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', ...opts }).format(new Date(`${d}T00:00:00Z`));
	const day = (d: string) => fmt(d, { month: 'short', day: 'numeric' });
	const periodLabel = (p: string) =>
		data.group === 'month' ? fmt(`${p}-01`, { month: 'long', year: 'numeric' }) : data.group === 'week' ? `Week of ${day(p)}` : fmt(p, { weekday: 'short', month: 'short', day: 'numeric' });

	/** Links keep every other choice on the page and change only what is passed. */
	const href = (set: Record<string, string | null>) => {
		const p = new URLSearchParams(page.url.searchParams);
		for (const [k, v] of Object.entries(set)) {
			if (v === null) p.delete(k);
			else p.set(k, v);
		}
		const s = p.toString();
		return `${reports}/sc-pwd-discounts${s ? `?${s}` : ''}`;
	};
	const csvHref = $derived(`${reports}/sc-pwd-discounts/export?${new URLSearchParams({ from: data.from, to: data.to, scope: data.scope, group: data.group })}`);

	const weekStart = $derived.by(() => {
		const d = new Date(`${data.today}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
		return d.toISOString().slice(0, 10);
	});
	const PERIODS = $derived([
		{ label: 'Today', from: data.today },
		{ label: 'This week', from: weekStart },
		{ label: 'This month', from: data.monthStart }
	]);
	const SCOPES = [
		{ key: 'all', label: 'Overall', hint: 'Room bookings and restaurant bills.' },
		{ key: 'hotel', label: 'Hotel', hint: 'Room bookings, by the day the discount was applied at the front desk.' },
		{ key: 'dining', label: 'Dining', hint: 'Restaurant bills, by the day they were paid.' }
	] as const;
	const GROUPS = [
		{ key: 'day', label: 'Day' },
		{ key: 'week', label: 'Week' },
		{ key: 'month', label: 'Month' }
	] as const;

	const guests = $derived(t.hotel + t.dining);
	const unmarked = $derived(guests - t.senior - t.pwd);
	const share = (n: number) => (guests > 0 ? `${(n / guests) * 100}%` : '0%');
	const counted = $derived(r.trail.filter((x) => !x.reversedOn).length);
	const TYPE = { senior_citizen: 'Senior', pwd: 'PWD' } as const;

	// A segmented control made of links: one joined group, the current choice filled.
	const seg = 'inline-flex overflow-hidden rounded-lg border border-border bg-surface';
	const segItem = (on: boolean) =>
		`px-3 py-1.5 text-sm transition-colors focus-visible:relative focus-visible:outline-2 focus-visible:outline-brand ${on ? 'bg-brand text-brand-ink' : 'text-ink hover:bg-surface-2'}`;
</script>

<svelte:head><title>Senior / PWD discounts</title></svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
	<div class="mb-3 flex items-center justify-between gap-3 print:hidden">
		<a href={reports} class="text-sm text-ink-muted underline-offset-2 hover:underline">← Reports</a>
		<div class="flex gap-2">
			<Button variant="outline" size="sm" onclick={() => window.print()}><PrinterIcon class="size-4" /> Print</Button>
			<Button variant="outline" size="sm" href={csvHref} download><DownloadIcon class="size-4" /> CSV</Button>
		</div>
	</div>

	<h1 class="text-2xl font-semibold tracking-tight text-ink print:text-black">Senior / PWD discounts</h1>
	<p class="mt-1 text-sm text-ink-muted print:text-black">
		{data.from === data.to ? fmt(data.from, { month: 'long', day: 'numeric', year: 'numeric' }) : `${fmt(data.from, { month: 'long', day: 'numeric' })} to ${fmt(data.to, { month: 'long', day: 'numeric', year: 'numeric' })}`}{data.scope === 'all' ? '' : `, ${data.scope === 'hotel' ? 'hotel' : 'dining'} only`}.
		<span class="print:hidden">{SCOPES.find((s) => s.key === data.scope)?.hint}</span>
	</p>

	<!-- Toolbar: which side, which period. -->
	<div class="mt-4 flex flex-wrap items-end gap-x-4 gap-y-3 print:hidden">
		<nav class={seg} aria-label="Show">
			{#each SCOPES as s, i (s.key)}
				<a href={href({ scope: s.key === 'all' ? null : s.key })} class="{segItem(data.scope === s.key)} {i ? 'border-l border-border' : ''}" aria-current={data.scope === s.key ? 'page' : undefined}>{s.label}</a>
			{/each}
		</nav>
		<nav class={seg} aria-label="Period">
			{#each PERIODS as p, i (p.label)}
				{@const on = data.from === p.from && data.to === data.today}
				<a href={href({ from: p.from, to: data.today })} class="{segItem(on)} {i ? 'border-l border-border' : ''}" aria-current={on ? 'page' : undefined}>{p.label}</a>
			{/each}
		</nav>
		<form method="GET" class="flex items-end gap-2">
			{#if data.scope !== 'all'}<input type="hidden" name="scope" value={data.scope} />{/if}
			{#if data.group !== 'day'}<input type="hidden" name="group" value={data.group} />{/if}
			<div><Label for="from" class="text-xs text-ink-muted">From</Label><Input id="from" name="from" type="date" value={data.from} max={data.today} class="mt-1 h-9 w-38" /></div>
			<div><Label for="to" class="text-xs text-ink-muted">To</Label><Input id="to" name="to" type="date" value={data.to} max={data.today} class="mt-1 h-9 w-38" /></div>
			<Button type="submit" size="sm" variant="outline" class="h-9">Show</Button>
		</form>
	</div>

	{#if r.trail.length === 0}
		<div class="mt-6 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-14 text-center">
			<ReceiptTextIcon class="size-6 text-ink-muted" aria-hidden="true" />
			<p class="text-sm text-ink">No Senior or PWD discounts in this period.</p>
			<p class="max-w-md text-xs text-ink-muted">
				They show here once a cashier gives one when settling a dining bill, or the front desk applies one to a room booking. Try a longer period.
			</p>
		</div>
	{:else}
		<!-- The figures: what it cost, and who got it. -->
		<section aria-label="Totals" class="mt-6 grid overflow-hidden rounded-xl border border-border bg-surface sm:grid-cols-2 sm:divide-x sm:divide-border print:border-black">
			<div class="px-5 py-4">
				<h2 class="text-sm text-ink-muted">Taken off the bills</h2>
				<p class="mt-1 text-3xl font-semibold tracking-tight tabular-nums text-ink">{peso(t.discountCentavos + t.vatRemovedCentavos)}</p>
				<dl class="mt-3 grid max-w-xs grid-cols-[1fr_auto] gap-y-1 text-sm">
					<dt class="text-ink-muted">Discount given</dt><dd class="text-right tabular-nums text-ink">{peso(t.discountCentavos)}</dd>
					<dt class="text-ink-muted">VAT removed</dt><dd class="text-right tabular-nums text-ink">{peso(t.vatRemovedCentavos)}</dd>
				</dl>
			</div>
			<div class="border-t border-border px-5 py-4 sm:border-t-0">
				<h2 class="text-sm text-ink-muted">Guests discounted</h2>
				<p class="mt-1 text-3xl font-semibold tracking-tight tabular-nums text-ink">{guests}</p>
				<div class="mt-3 space-y-2.5 text-sm">
					{#each [{ a: ['Senior', t.senior], b: ['PWD', t.pwd] }, ...(data.scope === 'all' ? [{ a: ['Hotel', t.hotel], b: ['Dining', t.dining] }] : [])] as pair, i (i)}
						<div>
							<div class="flex justify-between tabular-nums">
								<span class="text-ink">{pair.a[0]} <span class="font-medium">{pair.a[1]}</span></span>
								<span class="text-ink">{pair.b[0]} <span class="font-medium">{pair.b[1]}</span></span>
							</div>
							<div class="mt-1 flex h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
								<div class="bg-brand" style:width={share(Number(pair.a[1]))}></div>
								<div class="ml-auto bg-brand/35" style:width={share(Number(pair.b[1]))}></div>
							</div>
						</div>
					{/each}
					{#if unmarked > 0}
						<p class="text-xs text-ink-muted">{unmarked} not marked Senior or PWD (dining bills from before the type was recorded).</p>
					{/if}
				</div>
			</div>
		</section>

		<!-- By period. -->
		<section aria-labelledby="by-period" class="mt-8">
			<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
				<h2 id="by-period" class="text-base font-semibold text-ink">By {data.group}</h2>
				<nav class="{seg} print:hidden" aria-label="Group by">
					{#each GROUPS as g, i (g.key)}
						<a href={href({ group: g.key === 'day' ? null : g.key })} class="{segItem(data.group === g.key)} {i ? 'border-l border-border' : ''}" aria-current={data.group === g.key ? 'page' : undefined}>{g.label}</a>
					{/each}
				</nav>
			</div>
			<div class="overflow-x-auto rounded-xl border border-border print:border-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>{data.group === 'month' ? 'Month' : data.group === 'week' ? 'Week' : 'Day'}</Table.Head>
							{#if data.scope === 'all'}<Table.Head class="text-right">Hotel</Table.Head><Table.Head class="text-right">Dining</Table.Head>{/if}
							<Table.Head class="text-right">Senior</Table.Head>
							<Table.Head class="text-right">PWD</Table.Head>
							<Table.Head class="text-right">Discount</Table.Head>
							<Table.Head class="text-right">VAT removed</Table.Head>
							<Table.Head class="text-right">Total off</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each r.periods as p (p.period)}
							<Table.Row>
								<Table.Cell class="whitespace-nowrap text-ink">{periodLabel(p.period)}</Table.Cell>
								{#if data.scope === 'all'}<Table.Cell class="text-right tabular-nums text-ink-muted">{p.hotel}</Table.Cell><Table.Cell class="text-right tabular-nums text-ink-muted">{p.dining}</Table.Cell>{/if}
								<Table.Cell class="text-right tabular-nums text-ink-muted">{p.senior}</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-ink-muted">{p.pwd}</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-ink">{peso(p.discountCentavos)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-ink">{peso(p.vatRemovedCentavos)}</Table.Cell>
								<Table.Cell class="text-right font-medium tabular-nums text-ink">{peso(p.discountCentavos + p.vatRemovedCentavos)}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
					<Table.Footer>
						<Table.Row>
							<Table.Cell class="text-ink">Total</Table.Cell>
							{#if data.scope === 'all'}<Table.Cell class="text-right tabular-nums">{t.hotel}</Table.Cell><Table.Cell class="text-right tabular-nums">{t.dining}</Table.Cell>{/if}
							<Table.Cell class="text-right tabular-nums">{t.senior}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{t.pwd}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{peso(t.discountCentavos)}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{peso(t.vatRemovedCentavos)}</Table.Cell>
							<Table.Cell class="text-right font-semibold tabular-nums">{peso(t.discountCentavos + t.vatRemovedCentavos)}</Table.Cell>
						</Table.Row>
					</Table.Footer>
				</Table.Root>
			</div>
		</section>

		<!-- The register: one entry per discount, each linked to the record it came from. -->
		<section aria-labelledby="trail" class="mt-8">
			<div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
				<h2 id="trail" class="text-base font-semibold text-ink">Every discount</h2>
				<p class="text-xs text-ink-muted">
					{counted} counted{r.trail.length > counted ? `, ${r.trail.length - counted} reversed` : ''}. Open a reference to see its payment, receipt and history.
				</p>
			</div>
			<ol class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface print:border-black">
				{#each r.trail as x, i (i)}
					{@const off = x.discountCentavos + x.vatRemovedCentavos}
					<li class="grid grid-cols-[3.5rem_1fr_auto] gap-x-3 px-4 py-3 print:break-inside-avoid {x.reversedOn ? 'bg-surface-2/60' : ''}">
						<span class="pt-0.5 text-xs tabular-nums text-ink-muted">{day(x.date)}</span>

						<div class="min-w-0">
							<ul class="space-y-0.5">
								{#each x.guests as g, gi (gi)}
									<li class="text-sm {x.reversedOn ? 'text-ink-muted' : 'text-ink'}">
										<span class="font-medium">{g.name}</span>
										<span class="ml-1.5 rounded px-1.5 py-px text-xs {g.type === 'pwd' ? 'bg-brand/10 text-brand' : 'bg-surface-2 text-ink'}">{g.type ? TYPE[g.type] : 'Senior / PWD'}</span>
										<span class="ml-1.5 text-xs tabular-nums text-ink-muted">ID {g.idNumber}</span>
									</li>
								{/each}
							</ul>
							<div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-muted">
								<span>{x.side === 'hotel' ? 'Hotel' : 'Dining'}</span>
								<a href="{mgmt}/{x.href}" class="inline-flex items-center gap-0.5 font-medium tabular-nums text-ink underline-offset-2 hover:underline print:no-underline">
									{x.ref}<ArrowUpRightIcon class="size-3 print:hidden" aria-hidden="true" />
								</a>
								<span>{x.receipts.length ? x.receipts.join(', ') : 'No receipt issued'}</span>
								{#if x.givenBy}<span>by {x.givenBy}</span>{/if}
							</div>
						</div>

						<div class="text-right">
							{#if x.reversedOn}
								<p class="text-sm tabular-nums text-ink-muted line-through">{peso(off)}</p>
								<p class="mt-0.5 text-xs text-warning">Reversed {day(x.reversedOn)}, not counted</p>
							{:else}
								<p class="text-sm font-semibold tabular-nums text-ink">{peso(off)}</p>
								<p class="mt-0.5 text-xs tabular-nums text-ink-muted">
									<span class="whitespace-nowrap">{peso(x.discountCentavos)} off</span>
									<span class="ml-1.5 whitespace-nowrap">{peso(x.vatRemovedCentavos)} VAT</span>
								</p>
								<p class="text-xs tabular-nums text-ink-muted">on {peso(x.baseCentavos)}</p>
							{/if}
						</div>
					</li>
				{/each}
			</ol>
		</section>
	{/if}
</div>

<style>
	@media print {
		:global(body) {
			background: #fff;
		}
	}
</style>
