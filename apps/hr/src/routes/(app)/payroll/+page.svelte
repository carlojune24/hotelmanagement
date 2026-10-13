<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	$effect(() => {
		if (form?.error) toast.error(form.error);
		else if (form && 'ok' in form && form.ok) toast.success(form.ok);
	});

	const selectClass =
		'h-10 w-full rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';
</script>

<svelte:head><title>Payroll · HR</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
	<h1 class="text-5xl font-light tracking-tight">Payroll</h1>

	<section class="panel space-y-4 p-5 md:p-6" aria-label="Payroll settings">
		<div>
			<h2 class="text-xl font-light">Working-day factor</h2>
			<p class="mt-1 text-sm text-ink-muted">
				Turns a monthly rate into a daily one (rate × 12 ÷ factor), which sets what an absence costs
				and the hourly rate for overtime. It is a company policy, so there is no default —
				{#if data.dayFactor}currently <strong class="font-medium text-ink">{data.dayFactor}</strong>.{:else}choose
					one before creating a run.{/if}
			</p>
		</div>
		<form method="POST" action="?/saveSettings" use:enhance class="flex flex-wrap items-end gap-2">
			<div class="min-w-64 flex-1">
				<Label for="dayFactor">Days a year</Label>
				<select id="dayFactor" name="dayFactor" class={selectClass + ' mt-1'} required>
					{#if !data.dayFactor}<option value="" disabled selected>Choose…</option>{/if}
					{#each data.factors as f (f.value)}
						<option value={f.value} selected={data.dayFactor === f.value}>{f.label}</option>
					{/each}
				</select>
			</div>
			<Button type="submit" variant="outline">Save</Button>
		</form>
	</section>

	<section class="panel space-y-4 p-5 md:p-6" aria-label="New payroll run">
		<h2 class="text-xl font-light">New run</h2>
		<form method="POST" action="?/create" use:enhance class="grid gap-3 sm:grid-cols-5 sm:items-end">
			<div class="space-y-1.5">
				<Label for="cutoffStart">Cutoff from</Label>
				<Input id="cutoffStart" name="cutoffStart" type="date" required />
			</div>
			<div class="space-y-1.5">
				<Label for="cutoffEnd">to</Label>
				<Input id="cutoffEnd" name="cutoffEnd" type="date" required />
			</div>
			<div class="space-y-1.5">
				<Label for="payDate">Pay date</Label>
				<Input id="payDate" name="payDate" type="date" required />
			</div>
			<div class="space-y-1.5">
				<Label for="frequency">Paid</Label>
				<select id="frequency" name="frequency" class={selectClass}>
					<option value="semi_monthly">Twice a month</option>
					<option value="monthly">Monthly</option>
				</select>
			</div>
			<Button type="submit" variant="gold" disabled={!data.dayFactor}>Create run</Button>
		</form>
		{#if !data.dayFactor}
			<p class="text-sm text-ink-muted">Choose the working-day factor above first.</p>
		{/if}
	</section>

	<section class="panel p-5 md:p-6" aria-label="Runs">
		{#if data.runs.length === 0}
			<div class="hatch rounded-2xl px-6 py-14 text-center">
				<p class="text-lg">No payroll runs yet</p>
				<p class="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
					Payroll is built from each establishment's received DTR, so start once the DTRs are in.
				</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row class="hover:bg-transparent">
						<Table.Head>Cutoff</Table.Head>
						<Table.Head>Pay date</Table.Head>
						<Table.Head>Paid</Table.Head>
						<Table.Head>Establishments</Table.Head>
						<Table.Head><span class="sr-only">Open</span></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.runs as r (r.id)}
						<Table.Row>
							<Table.Cell class="font-medium tabular-nums">{r.cutoffStart} → {r.cutoffEnd}</Table.Cell>
							<Table.Cell class="tabular-nums">{r.payDate}</Table.Cell>
							<Table.Cell>{r.frequency === 'monthly' ? 'Monthly' : 'Twice a month'}</Table.Cell>
							<Table.Cell>
								<Badge variant={r.released === r.batchCount && r.batchCount > 0 ? 'ok' : 'muted'}>
									{r.released} of {r.batchCount} released
								</Badge>
								{#if r.locked > 0}<span class="ml-2 text-xs text-ink-muted">{r.locked} locked</span>{/if}
							</Table.Cell>
							<Table.Cell class="text-right">
								<Button href="/payroll/{r.id}" variant="outline" size="sm">Open</Button>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</section>
</div>
