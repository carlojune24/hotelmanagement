<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let creating = $state(false);

	$effect(() => {
		if (form?.error) toast.error(form.error);
	});

	const pageHref = (page: number, size = data.pageSize) =>
		`?page=${page}&size=${size}${data.q ? `&q=${encodeURIComponent(data.q)}` : ''}`;

	const selectClass =
		'h-10 w-full rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';
</script>

<svelte:head><title>Payroll · HR</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<h1 class="text-5xl font-light tracking-tight">Payroll</h1>
		<div class="flex items-center gap-2">
			<Button variant="outline" href="/payroll/annualization">Year-end tax</Button>
			<Button variant="gold" disabled={!data.dayFactor} onclick={() => (creating = true)}><PlusIcon /> New run</Button>
		</div>
	</div>

	{#if !data.dayFactor}
		<p class="panel p-4 text-sm text-ink-muted">
			Choose the working-day factor in <a href="/settings?tab=payroll" class="underline">Settings → Payroll</a> before creating a run.
		</p>
	{/if}

	<section class="panel p-5 md:p-6" aria-label="Runs">
		{#if data.total === 0 && !data.q}
			<div class="hatch rounded-2xl px-6 py-14 text-center">
				<p class="text-lg">No payroll runs yet</p>
				<p class="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
					Payroll is built from each establishment's received DTR, so start once the DTRs are in.
				</p>
			</div>
		{:else}
			<form method="GET" class="mb-4 flex flex-wrap items-center gap-2" role="search">
				<input type="hidden" name="size" value={data.pageSize} />
				<Input
					name="q"
					type="search"
					value={data.q}
					placeholder="Search by date (2026-08, 2026-08-16) or Monthly"
					aria-label="Search payroll runs"
					class="min-w-64 flex-1"
				/>
				<Button type="submit" variant="outline">Search</Button>
				{#if data.q}<Button href="?size={data.pageSize}" variant="ghost">Clear</Button>{/if}
			</form>
			{#if data.runs.length === 0}
				<p class="rounded-lg border border-dashed border-ink/30 px-4 py-6 text-center text-sm text-ink-muted">
					No runs match "{data.q}".
				</p>
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
			<div class="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-muted">
				<label class="flex items-center gap-2">
					Rows per page
					<select
						class="h-9 rounded-full border border-transparent bg-white px-3 text-sm text-ink shadow-sm"
						value={data.pageSize}
						onchange={(e) => goto(pageHref(1, Number(e.currentTarget.value)), { keepFocus: true })}
					>
						{#each data.pageSizes as n (n)}<option value={n}>{n}</option>{/each}
					</select>
				</label>
				<div class="flex items-center gap-2">
					<span class="tabular-nums">Page {data.page} of {data.pageCount} · {data.total} runs</span>
					{#if data.page <= 1}
						<Button variant="outline" size="sm" disabled>Previous</Button>
					{:else}
						<Button href={pageHref(data.page - 1)} variant="outline" size="sm">Previous</Button>
					{/if}
					{#if data.page >= data.pageCount}
						<Button variant="outline" size="sm" disabled>Next</Button>
					{:else}
						<Button href={pageHref(data.page + 1)} variant="outline" size="sm">Next</Button>
					{/if}
				</div>
			</div>
		{/if}
	</section>
</div>

<Dialog.Root open={creating} onOpenChange={(o) => (creating = o)}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="font-display text-2xl font-light">New payroll run</Dialog.Title>
			<Dialog.Description>One run covers every establishment's received DTR for the cutoff.</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/create" use:enhance class="space-y-3">
			<div class="grid gap-3 sm:grid-cols-2">
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
			</div>
			<Dialog.Footer class="gap-2 pt-1">
				<Button type="button" variant="outline" onclick={() => (creating = false)}>Cancel</Button>
				<Button type="submit" variant="gold">Create run</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
