<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import { money } from '$lib/components/payroll/money';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const d = $derived(data.dashboard);

	const day = (iso: string) =>
		new Date(`${iso}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
	const longDay = $derived(
		new Date(`${d.today}T00:00:00`).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
	);
	const TONE = {
		overdue: { label: 'Overdue', variant: 'destructive' },
		soon: { label: 'Due soon', variant: 'gold' },
		info: { label: 'To do', variant: 'muted' }
	} as const;
	const DTR = { received: 'Received', submitted: 'Sent, waiting', returned: 'Returned', draft: 'Not sent' } as const;
	const BATCH = { none: '–', draft: 'Not generated', generated: 'Generated', locked: 'Locked', released: 'Released' } as const;
</script>

<svelte:head><title>Dashboard · HR</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-6">
	<div>
		<h1 class="text-5xl font-light tracking-tight">Dashboard</h1>
		<p class="mt-2 text-sm text-ink-muted">{data.orgName} · {longDay}</p>
	</div>

	<div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
		<section class="panel space-y-4 p-5 md:p-6" aria-label="Needs attention">
			<h2 class="text-2xl font-light">Needs attention</h2>
			{#if d.attention.length === 0}
				<div class="hatch rounded-2xl px-6 py-10 text-center">
					<p class="text-lg">Nothing needs attention</p>
					<p class="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
						No approvals waiting, nothing overdue, and no deadline in the next few days.
					</p>
				</div>
			{:else}
				<ul class="divide-y divide-dotted divide-ink/25">
					{#each d.attention as a (a.key)}
						<li>
							<a
								href={a.href}
								class="group flex items-center gap-3 rounded-xl px-2 py-3 hover:bg-gold-soft focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
							>
								<Badge variant={TONE[a.tone].variant} class="w-20 shrink-0">{TONE[a.tone].label}</Badge>
								<span class="min-w-0 flex-1 text-sm">{a.text}</span>
								<ArrowRightIcon class="size-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5" />
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="panel space-y-4 p-5 md:p-6" aria-label="Cutoff status">
			<h2 class="text-2xl font-light">Cutoff status</h2>
			{#if d.cutoff}
				<p class="text-sm text-ink-muted tabular-nums">
					{d.cutoff.cutoffStart} → {d.cutoff.cutoffEnd}<br />Pay date {d.cutoff.payDate}
				</p>
				<ol class="space-y-3">
					{#each d.cutoff.steps as s (s.label)}
						<li>
							<a href={s.href} class="block rounded-xl px-2 py-1.5 hover:bg-gold-soft">
								<div class="flex items-baseline justify-between text-sm">
									<span>{s.label}</span>
									<span class="tabular-nums {s.of > 0 && s.done === s.of ? 'font-medium' : 'text-ink-muted'}">
										{s.done} of {s.of}
									</span>
								</div>
								<div class="mt-1.5 h-1.5 rounded-full bg-ink/10" aria-hidden="true">
									<div class="h-1.5 rounded-full bg-gold-deep" style="width: {s.of ? Math.round((s.done / s.of) * 100) : 0}%"></div>
								</div>
							</a>
						</li>
					{/each}
				</ol>
				<p class="text-xs text-ink-muted">
					Statutory rates {d.cutoff.ratesConfirmed ? 'confirmed for this run.' : 'not confirmed yet for this run.'}
				</p>
				<Button variant="outline" href="/payroll/{d.cutoff.runId}">Open this run</Button>
			{:else}
				<div class="hatch rounded-2xl px-6 py-10 text-center">
					<p class="text-lg">No payroll run open</p>
					<p class="mx-auto mt-1 max-w-xs text-sm text-ink-muted">Every run is released, or none has been created yet.</p>
				</div>
				<Button variant="outline" href="/payroll">Go to Payroll</Button>
			{/if}
		</section>
	</div>

	<section class="panel space-y-3 p-5 md:p-6" aria-label="Coming up">
		<h2 class="text-2xl font-light">Coming up · next 30 days</h2>
		{#if d.upcoming.length === 0}
			<p class="rounded-lg border border-dashed border-ink/30 px-4 py-3 text-sm text-ink-muted">
				No pay dates, remittance deadlines or holidays in the next 30 days.
			</p>
		{:else}
			<ul class="divide-y divide-dotted divide-ink/25">
				{#each d.upcoming as u, i (u.date + u.label + i)}
					<li>
						<a href={u.href} class="flex items-center gap-4 rounded-xl px-2 py-2.5 text-sm hover:bg-gold-soft">
							<span class="w-16 shrink-0 font-medium tabular-nums">{day(u.date)}</span>
							<span class="min-w-0 flex-1">{u.label}</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="panel p-5 md:p-6" aria-label="Establishments">
		<h2 class="mb-3 text-2xl font-light">Establishments</h2>
		{#if d.establishments.length === 0}
			<p class="text-sm text-ink-muted">No active establishments yet.</p>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row class="hover:bg-transparent">
						<Table.Head>Establishment</Table.Head>
						<Table.Head class="text-right">Staff</Table.Head>
						<Table.Head class="text-right">On leave today</Table.Head>
						<Table.Head class="text-right">Rosters waiting</Table.Head>
						<Table.Head>DTR this month</Table.Head>
						<Table.Head>Payroll batch</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each d.establishments as e (e.id)}
						<Table.Row>
							<Table.Cell class="font-medium"><a href="/{e.slug}/dashboard" class="underline-offset-4 hover:underline">{e.name}</a></Table.Cell>
							<Table.Cell class="text-right tabular-nums">{e.staff}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{e.onLeave || '–'}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{e.rosterWaiting || '–'}</Table.Cell>
							<Table.Cell>
								<Badge variant={e.dtr === 'received' ? 'ok' : e.dtr === 'submitted' ? 'gold' : 'muted'}>{DTR[e.dtr]}</Badge>
							</Table.Cell>
							<Table.Cell>{BATCH[e.batch]}</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</section>

	<dl class="flex flex-wrap gap-x-10 gap-y-3 px-1 text-sm">
		<div>
			<dt class="text-xs text-ink-muted">Headcount</dt>
			<dd class="font-medium tabular-nums">{d.figures.headcount}</dd>
		</div>
		<div>
			<dt class="text-xs text-ink-muted">On leave today</dt>
			<dd class="font-medium tabular-nums">{d.figures.onLeaveToday}</dd>
		</div>
		<div>
			<dt class="text-xs text-ink-muted">Loans still owed</dt>
			<dd class="font-medium tabular-nums">{money(d.figures.loansOutstanding)}</dd>
		</div>
		{#if d.figures.lastRunNet !== null}
			<div>
				<dt class="text-xs text-ink-muted">Net pay, latest run with final batches</dt>
				<dd class="font-medium tabular-nums">{money(d.figures.lastRunNet)}</dd>
			</div>
		{/if}
	</dl>
</div>
