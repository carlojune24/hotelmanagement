<script lang="ts">
	import { enhance } from '$app/forms';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const d = $derived(data.dashboard);

	const dayLabel = (iso: string) =>
		new Intl.DateTimeFormat('en-PH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
			new Date(`${iso}T00:00:00Z`)
		);
	const range = (start: string, end: string) => (start === end ? dayLabel(start) : `${dayLabel(start)} – ${dayLabel(end)}`);
	const longDate = (iso: string) =>
		new Intl.DateTimeFormat('en-PH', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

	const fix = $derived(d.attention.filter((a) => a.tone === 'fix'));
	const wait = $derived(d.attention.filter((a) => a.tone === 'wait'));
	const today = $derived(d.onLeave.filter((l) => l.today));
	const soon = $derived(d.onLeave.filter((l) => !l.today));
</script>

<svelte:head><title>Dashboard · {data.establishment.name} · HR</title></svelte:head>

<div class="divide-y divide-dotted divide-ink/20">
	<header class="px-5 py-4 md:px-6">
		<h2 class="text-2xl font-light">Dashboard</h2>
		<p class="text-sm text-ink-muted">{longDate(d.today)} · {d.staffCount} {d.staffCount === 1 ? 'person' : 'people'} assigned here</p>
	</header>

	{#if data.announcements.length > 0}
		<section class="space-y-3 px-5 py-4 md:px-6" aria-label="Announcements from HR">
			<h3 class="text-lg font-light">From Main HR</h3>
			<ul class="space-y-4">
				{#each data.announcements as a (a.id)}
					<li>
						<p class="flex flex-wrap items-center gap-2 font-medium">
							{a.title}
							{#if a.pinned}<Badge variant="gold">Pinned</Badge>{/if}
						</p>
						<p class="text-xs text-ink-muted tabular-nums">
							Posted {a.postedOn}{#if a.expiresOn} · until {a.expiresOn}{/if}
						</p>
						<p class="mt-1 max-w-3xl text-sm whitespace-pre-line">{a.body}</p>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="space-y-3 px-5 py-4 md:px-6" aria-label="Needs attention">
		<h3 class="text-lg font-light">Needs attention</h3>
		{#if d.attention.length === 0}
			<p class="text-sm text-ink-muted">Nothing needs attention right now.</p>
		{:else}
			{#if fix.length > 0}
				<ul class="space-y-1.5">
					{#each fix as a (a.key)}
						<li>
							<a href={a.href} class="flex items-start gap-2 rounded-2xl px-3 py-2 text-sm hover:bg-gold-soft">
								<span class="mt-1.5 size-2 shrink-0 rounded-full bg-danger" aria-hidden="true"></span>
								<span><span class="sr-only">To do: </span>{a.text}</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
			{#if wait.length > 0}
				<p class="pt-1 text-xs font-medium text-ink-muted">With Main HR</p>
				<ul class="space-y-1.5">
					{#each wait as a (a.key)}
						<li>
							<a href={a.href} class="flex items-start gap-2 rounded-2xl px-3 py-2 text-sm hover:bg-gold-soft">
								<span class="mt-1.5 size-2 shrink-0 rounded-full bg-gold-deep" aria-hidden="true"></span>
								<span><span class="sr-only">Waiting: </span>{a.text}</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</section>

	<section class="space-y-3 px-5 py-4 md:px-6" aria-label="Today">
		<h3 class="text-lg font-light">Today</h3>
		<dl class="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
			<div>
				<dt class="text-sm text-ink-muted">Working</dt>
				<dd class="font-display text-3xl font-light tabular-nums">{d.roster.working}</dd>
			</div>
			<div>
				<dt class="text-sm text-ink-muted">Rest day</dt>
				<dd class="font-display text-3xl font-light tabular-nums">{d.roster.rest}</dd>
			</div>
			<div>
				<dt class="text-sm text-ink-muted">On leave</dt>
				<dd class="font-display text-3xl font-light tabular-nums">{d.roster.onLeave}</dd>
			</div>
			<div>
				<dt class="text-sm text-ink-muted">Not scheduled</dt>
				<dd class="font-display text-3xl font-light tabular-nums">{d.roster.unscheduled}</dd>
			</div>
		</dl>
	</section>

	<section class="space-y-3 px-5 py-4 md:px-6" aria-label="Who is on leave">
		<h3 class="text-lg font-light">Who is on leave</h3>
		{#if d.onLeave.length === 0}
			<p class="text-sm text-ink-muted">No one is on approved leave today or in the next 7 days.</p>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row class="hover:bg-transparent">
						<Table.Head>Employee</Table.Head>
						<Table.Head>Leave</Table.Head>
						<Table.Head>Dates</Table.Head>
						<Table.Head>When</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each [...today, ...soon] as l, i (i)}
						<Table.Row>
							<Table.Cell>
								<p class="font-medium">{l.name}</p>
								<p class="text-xs text-ink-muted">{l.position}</p>
							</Table.Cell>
							<Table.Cell>{l.leaveType}</Table.Cell>
							<Table.Cell class="tabular-nums">{range(l.start, l.end)}</Table.Cell>
							<Table.Cell>
								{#if l.today}<Badge variant="gold">Today</Badge>{:else}<span class="text-ink-muted">Coming up</span>{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</section>

	<section class="space-y-3 px-5 py-4 md:px-6" aria-label="Absent today">
		<div class="flex flex-wrap items-baseline justify-between gap-x-4">
			<h3 class="text-lg font-light">Absent today</h3>
			{#if d.rosteredToday.length > 0}
				<p class="text-xs text-ink-muted tabular-nums">
					{d.rosteredToday.filter((p) => p.marked).length} marked · {d.rosteredToday.length} rostered
				</p>
			{/if}
		</div>
		<p class="text-xs text-ink-muted">
			For information only — it is not written to anyone's DTR.{data.canMarkAbsence ? ' Tick who is absent today.' : ''}
		</p>
		{#if d.absentToday.state === 'holiday'}
			<p class="text-sm text-ink-muted">Today is {d.absentToday.holiday}, so no one is counted absent.</p>
		{:else if d.rosteredToday.length === 0}
			<p class="text-sm text-ink-muted">No one is rostered to work today.</p>
		{:else}
			<ul class="divide-y divide-dotted divide-ink/20">
				{#each d.rosteredToday as p (p.id)}
					<li class="py-1">
						<form method="POST" action="?/mark" use:enhance={() => async ({ update }) => update({ reset: false })} class="flex flex-wrap items-center gap-x-3 gap-y-1 py-1 text-sm">
							<input type="hidden" name="employeeId" value={p.id} />
							<label class="flex min-h-11 min-w-0 flex-1 items-center gap-3">
								<input
									type="checkbox"
									name="absent"
									value="1"
									checked={!!p.marked}
									disabled={!data.canMarkAbsence}
									class="size-5 accent-ink"
									onchange={(e) => e.currentTarget.form!.requestSubmit()}
								/>
								<span class="min-w-0">
									<span class="font-medium">{p.name}</span>
									<span class="text-ink-muted"> · {p.position}</span>
								</span>
							</label>
							<span class="flex items-center gap-2 tabular-nums text-ink-muted">
								Shift {p.shift}
								{#if p.noPunch}<Badge variant="destructive">No punch</Badge>{/if}
							</span>
							{#if p.marked}
								<input
									name="note"
									value={p.marked.note}
									maxlength="200"
									placeholder="Note (optional)"
									aria-label="Note for {p.name}"
									disabled={!data.canMarkAbsence}
									class="h-9 w-full rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:ml-8 sm:w-72"
									onchange={(e) => e.currentTarget.form!.requestSubmit()}
								/>
								<span class="w-full text-xs text-ink-muted sm:ml-8">Marked by {p.marked.by}</span>
							{/if}
						</form>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="space-y-3 px-5 py-4 md:px-6" aria-label="This week">
		<h3 class="text-lg font-light">People working this week</h3>
		<div class="overflow-x-auto">
			<Table.Root>
				<Table.Header>
					<Table.Row class="hover:bg-transparent">
						{#each d.week as day (day.date)}
							<Table.Head class="text-center {day.isToday ? 'text-ink' : ''}">{dayLabel(day.date)}</Table.Head>
						{/each}
					</Table.Row>
				</Table.Header>
				<Table.Body>
					<Table.Row class="hover:bg-transparent">
						{#each d.week as day (day.date)}
							<Table.Cell class="text-center text-lg tabular-nums {day.isToday ? 'bg-gold-soft font-medium' : ''}">
								{day.working}
							</Table.Cell>
						{/each}
					</Table.Row>
				</Table.Body>
			</Table.Root>
		</div>
	</section>
</div>
