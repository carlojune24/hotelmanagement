<script lang="ts">
	import { goto } from '$app/navigation';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Nothing set at all: no employer number and no deadline.
	const missingSetup = $derived(
		Object.values(data.settings.employerIds).every((v) => !v) && Object.values(data.settings.dueDay).every((v) => v == null)
	);
	const money = (c: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(c / 100);
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
		<Label for="period">Month paid</Label>
		<Input
			id="period"
			type="month"
			value={data.period}
			class="mt-1 w-48"
			onchange={(e) => e.currentTarget.value && goto(`?period=${e.currentTarget.value}`)}
		/>
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

	<div class="grid gap-4 sm:grid-cols-2">
		{#each data.overview.agencies as a (a.agency)}
			<a href="/remittances/{a.agency}/{data.period}" class="panel block space-y-2 p-5 hover:shadow-md">
				<div class="flex items-center justify-between">
					<h2 class="text-xl font-light">{a.label}</h2>
					{#if a.status === 'remitted'}
						<Badge variant="secondary">Remitted</Badge>
					{:else if a.overdue}
						<Badge variant="destructive">Overdue</Badge>
					{:else}
						<Badge variant="outline">Open</Badge>
					{/if}
				</div>
				<p class="text-3xl font-light tabular-nums">{money(a.amount)}</p>
				<p class="text-sm text-ink-muted">
					{a.people} {a.people === 1 ? 'person' : 'people'}{#if a.dueDate} · due {a.dueDate}{/if}
					{#if a.warnings > 0} · {a.warnings} missing an ID number{/if}
				</p>
			</a>
		{/each}
	</div>
</div>
