<script lang="ts">
	import { goto } from '$app/navigation';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Nothing set at all: no employer number and no deadline.
	const missingSetup = $derived(
		Object.values(data.settings.employerIds).every((v) => !v) && Object.values(data.settings.dueDay).every((v) => v == null)
	);
	const money = (c: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(c / 100);
	const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
	const periodYear = $derived(Number(data.period.slice(0, 4)));
	const periodMonth = $derived(data.period.slice(5, 7));
	const thisYear = new Date().getFullYear();
	const years = $derived(
		Array.from(new Set([...Array.from({ length: 8 }, (_, k) => thisYear + 1 - k), periodYear])).sort((a, b) => b - a)
	);
	const pick = (y: number, m: string) => goto(`?period=${y}-${m}`);
	const groups = $derived([
		{ id: 'contributions', title: 'Contributions', note: 'Employee and employer shares', items: data.overview.contributions },
		{ id: 'loans', title: 'Loans', note: 'One payment per loan type, even when nothing was deducted', items: data.overview.loans }
	]);
</script>

<svelte:head><title>Remittances · HR</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
	<div>
		<h1 class="text-5xl font-light tracking-tight">Remittances</h1>
		<p class="mt-2 text-sm text-ink-muted">
			What the company owes each agency for payslips paid in a month. Contributions use the statutory
			rates on file, which have <strong class="font-medium text-ink">not been verified</strong> against the
			current circulars.
		</p>
	</div>

	<div>
		<Label for="period-month">Month paid</Label>
		<div class="mt-1 flex gap-2">
			<select
				id="period-month"
				aria-label="Month"
				class="h-10 w-40 rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
				value={periodMonth}
				onchange={(e) => pick(periodYear, e.currentTarget.value)}
			>
				{#each MONTHS as name, i (name)}
					<option value={String(i + 1).padStart(2, '0')}>{name}</option>
				{/each}
			</select>
			<select
				id="period-year"
				aria-label="Year"
				class="h-10 w-28 rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
				value={String(periodYear)}
				onchange={(e) => pick(Number(e.currentTarget.value), periodMonth)}
			>
				{#each years as y (y)}<option value={String(y)}>{y}</option>{/each}
			</select>
		</div>
	</div>

	{#if missingSetup}
		<p class="rounded-lg border border-dashed border-ink/30 px-4 py-3 text-sm">
			The employer numbers and deadlines are not filled in yet, so no due dates are shown. Add them under
			<a href="/settings?tab=remittances" class="underline underline-offset-4">Settings → Employer numbers</a>.
		</p>
	{/if}

	{#if data.overview.draftBatches > 0}
		<p class="rounded-lg border border-dashed border-ink/30 px-4 py-3 text-sm">
			{data.overview.draftBatches} payroll batch{data.overview.draftBatches === 1 ? '' : 'es'} paid this month
			{data.overview.draftBatches === 1 ? 'is' : 'are'} not locked yet, so the amounts below are incomplete.
		</p>
	{/if}

	<div class="panel divide-y divide-dotted divide-ink/25 overflow-hidden">
		{#each groups as g (g.id)}
			<section aria-labelledby="rem-{g.id}">
				<div class="px-5 pb-2 pt-5">
					<h2 id="rem-{g.id}" class="font-display text-2xl font-light">{g.title}</h2>
					<p class="text-xs text-ink-muted">{g.note}</p>
				</div>
				<ul class="divide-y divide-dotted divide-ink/25">
					{#each g.items as a (a.agency)}
						{@const kept = a.status === 'kept'}
						<li>
							<details class="group">
								<summary
									class="flex min-h-14 cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 outline-none transition-colors hover:bg-gold-soft focus-visible:bg-gold-soft focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
								>
									<ChevronRightIcon class="size-4 shrink-0 text-ink-muted transition-transform group-open:rotate-90" aria-hidden="true" />
									<span class="min-w-0 flex-1 basis-40">
										<span class="block truncate text-sm font-medium {kept ? 'text-ink-muted' : 'text-ink'}">{a.label}</span>
										<span class="block text-xs text-ink-muted">
											{a.people} {a.people === 1 ? 'person' : 'people'}{#if a.dueDate} · due {a.dueDate}{/if}{#if a.warnings > 0} · {a.warnings} missing an ID number{/if}
										</span>
									</span>
									<span class="text-sm tabular-nums {a.amount === 0 || kept ? 'text-ink-muted' : 'font-medium text-ink'}">{money(a.amount)}</span>
									<span class="w-28 text-right">
										{#if kept}
											<Badge variant="outline">No remittance</Badge>
										{:else if a.status === 'remitted'}
											<Badge variant="secondary">Remitted</Badge>
										{:else if a.overdue}
											<Badge variant="destructive">Overdue</Badge>
										{:else}
											<Badge variant="outline">Open</Badge>
										{/if}
									</span>
								</summary>
								<div class="space-y-3 bg-white/50 px-5 pb-4 pl-12 pt-1">
									{#if kept}
										<p class="text-sm text-ink-muted">
											Deducted from pay and kept by the company, so there is nothing to remit.
										</p>
									{/if}
									{#if a.lines.length === 0}
										<p class="text-sm text-ink-muted">Nothing {kept ? 'was deducted' : 'to remit'} for {data.period}.</p>
									{:else}
										<ul class="divide-y divide-dotted divide-ink/25 text-sm">
											{#each a.lines as l (l.employeeId)}
												<li class="flex flex-wrap items-baseline justify-between gap-x-4 py-1.5">
													<span class="text-ink">{l.name} <span class="font-mono text-xs text-ink-muted">{l.employeeNo}</span></span>
													<span class="tabular-nums text-ink">
														{#if l.reference}<span class="mr-3 text-xs text-ink-muted">ref {l.reference}</span>{/if}{money(l.amount)}
													</span>
												</li>
											{/each}
										</ul>
									{/if}
									{#if !kept}
										<a
											href="/remittances/{a.agency}/{data.period}"
											class="inline-flex min-h-11 items-center rounded-full border border-ink/30 bg-white px-4 text-sm font-medium text-ink outline-none hover:bg-gold-soft focus-visible:ring-2 focus-visible:ring-ring"
										>
											Open schedule{a.status === 'remitted' ? '' : ' to print, export or mark remitted'}
										</a>
									{/if}
								</div>
							</details>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>
</div>
