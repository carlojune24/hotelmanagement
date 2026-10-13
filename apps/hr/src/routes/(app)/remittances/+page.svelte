<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	$effect(() => {
		if (form?.error) toast.error(form.error);
		else if (form && 'ok' in form && form.ok) toast.success(form.ok);
	});

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

	<section class="panel space-y-4 p-5 md:p-6" aria-label="Remittance settings">
		<div>
			<h2 class="text-xl font-light">Employer numbers and deadlines</h2>
			<p class="mt-1 text-sm text-ink-muted">
				A deadline is "day N of the month after the pay month". Leave blank to show no due date — none
				is assumed.
			</p>
		</div>
		<form method="POST" action="?/saveSettings" use:enhance class="grid gap-3 sm:grid-cols-2">
			<div>
				<Label for="sssNo">SSS employer no.</Label>
				<Input id="sssNo" name="sssNo" value={data.settings.employerIds.sss ?? ''} class="mt-1" />
			</div>
			<div>
				<Label for="dueSss">SSS due day</Label>
				<Input id="dueSss" name="dueSss" type="number" min="1" max="31" value={data.settings.dueDay.sss ?? ''} class="mt-1" />
			</div>
			<div>
				<Label for="philhealthNo">PhilHealth employer no.</Label>
				<Input id="philhealthNo" name="philhealthNo" value={data.settings.employerIds.philhealth ?? ''} class="mt-1" />
			</div>
			<div>
				<Label for="duePhilhealth">PhilHealth due day</Label>
				<Input id="duePhilhealth" name="duePhilhealth" type="number" min="1" max="31" value={data.settings.dueDay.philhealth ?? ''} class="mt-1" />
			</div>
			<div>
				<Label for="pagibigNo">Pag-IBIG employer no.</Label>
				<Input id="pagibigNo" name="pagibigNo" value={data.settings.employerIds.pagibig ?? ''} class="mt-1" />
			</div>
			<div>
				<Label for="duePagibig">Pag-IBIG due day</Label>
				<Input id="duePagibig" name="duePagibig" type="number" min="1" max="31" value={data.settings.dueDay.pagibig ?? ''} class="mt-1" />
			</div>
			<div class="sm:col-start-2">
				<Label for="dueBir">BIR due day</Label>
				<Input id="dueBir" name="dueBir" type="number" min="1" max="31" value={data.settings.dueDay.bir ?? ''} class="mt-1" />
			</div>
			<div class="sm:col-span-2">
				<Button type="submit" variant="outline">Save</Button>
			</div>
		</form>
	</section>
</div>
