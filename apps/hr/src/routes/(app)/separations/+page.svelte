<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { money } from '$lib/components/payroll/money';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Filter = 'process' | 'owing' | 'cleared' | 'all';
	const FILTERS: Array<{ key: Filter; label: string }> = [
		{ key: 'process', label: 'In process' },
		{ key: 'owing', label: 'Owing' },
		{ key: 'cleared', label: 'Cleared' },
		{ key: 'all', label: 'All' }
	];
	const selectClass =
		'h-10 w-full rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

	let filter = $state<Filter>('process');
	let query = $state('');
	let starting = $state(false);
	let busy = $state(false);

	const kindLabel = (k: string) => data.kinds.find((x) => x.value === k)?.label ?? k;
	const rows = $derived(
		data.rows.filter((r) => {
			const q = query.trim().toLowerCase();
			const inFilter =
				filter === 'all' ||
				(filter === 'process' && r.status === 'in_process') ||
				(filter === 'cleared' && r.status === 'cleared') ||
				(filter === 'owing' && r.stillOwed > 0);
			return inFilter && (!q || r.employeeName.toLowerCase().includes(q) || r.employeeNo.toLowerCase().includes(q));
		})
	);
	const owing = $derived(data.rows.filter((r) => r.stillOwed > 0));
	const owedTotal = $derived(owing.reduce((t, r) => t + r.stillOwed, 0));

	$effect(() => {
		if (form && 'error' in form && form.error) toast.error(form.error);
	});

	function submit() {
		busy = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = false;
		};
	}
</script>

<svelte:head><title>Separations · HR</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
	<div>
		<h1 class="text-5xl font-light tracking-tight">Separations</h1>
		<p class="mt-2 max-w-2xl text-sm text-ink-muted">
			Everyone who is leaving, in one place: final pay, loans and what they still owe, and clearance. A person stays
			here, marked as owing, until everything is settled.
		</p>
	</div>

	<section class="panel space-y-5 p-5 md:p-6" aria-label="Separations">
		{#if owing.length > 0}
			<p class="rounded-lg border border-dashed border-danger/50 px-4 py-2 text-sm">
				{owing.length} {owing.length === 1 ? 'person' : 'people'} still {owing.length === 1 ? 'owes' : 'owe'}
				<span class="font-medium tabular-nums">{money(owedTotal)}</span> in total.
			</p>
		{/if}

		<div class="flex flex-wrap items-center gap-3">
			<div class="relative min-w-52 flex-1">
				<SearchIcon class="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink-muted" />
				<Input type="search" placeholder="Search by name or number" aria-label="Search separations" class="pl-10" bind:value={query} />
			</div>
			<Button variant="gold" onclick={() => (starting = true)}><PlusIcon /> Start separation</Button>
		</div>

		<div class="flex flex-wrap gap-2" role="group" aria-label="Status">
			{#each FILTERS as f (f.key)}
				<button
					type="button"
					aria-pressed={filter === f.key}
					class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors {filter === f.key
						? 'bg-ink text-white'
						: 'bg-ink/10 text-ink hover:bg-ink/15'}"
					onclick={() => (filter = f.key)}>{f.label}</button
				>
			{/each}
		</div>

		{#if data.rows.length === 0}
			<div class="hatch rounded-2xl px-6 py-14 text-center">
				<p class="text-lg">No separations yet</p>
				<p class="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
					When someone resigns or is let go, start it here. You settle their final pay, loans and clearance on one page.
				</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row class="hover:bg-transparent">
						<Table.Head>Employee</Table.Head>
						<Table.Head>Reason</Table.Head>
						<Table.Head>Last day</Table.Head>
						<Table.Head>Progress</Table.Head>
						<Table.Head class="text-right">Still owes</Table.Head>
						<Table.Head class="w-24"><span class="sr-only">Actions</span></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each rows as r (r.id)}
						<Table.Row>
							<Table.Cell>
								<p class="font-medium">{r.employeeName}</p>
								<p class="text-xs text-ink-muted">#{r.employeeNo}{r.establishment ? ` · ${r.establishment}` : ''}</p>
							</Table.Cell>
							<Table.Cell>{kindLabel(r.kind)}</Table.Cell>
							<Table.Cell class="tabular-nums">{r.lastDay}</Table.Cell>
							<Table.Cell>
								<Badge variant={r.status === 'cleared' ? 'ok' : 'gold'}>
									<span class="size-1.5 rounded-full bg-current opacity-70"></span>
									{r.status === 'cleared' ? 'Cleared' : 'In process'}
								</Badge>
								<p class="mt-1 text-xs text-ink-muted tabular-nums">{r.stepsDone} of {r.stepsTotal} steps</p>
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">
								{#if r.stillOwed > 0}
									<span class="font-medium text-danger">{money(r.stillOwed)}</span>
								{:else}
									<span class="text-ink-muted">–</span>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-right">
								<Button variant="outline" size="sm" href="/separations/{r.id}">Open</Button>
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row class="hover:bg-transparent">
							<Table.Cell colspan={6} class="py-10 text-center text-ink-muted">No separations match.</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</section>
</div>

<Dialog.Root open={starting} onOpenChange={(o) => (starting = o)}>
	<Dialog.Content class="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
		<Dialog.Header class="bg-gold px-7 py-5 pr-14 text-ink">
			<Dialog.Title class="font-display text-2xl font-light">Start separation</Dialog.Title>
			<Dialog.Description class="text-ink/70">
				Their assignments end on the last day, so scheduling and DTR stop there.
			</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/start" use:enhance={submit} class="flex min-h-0 flex-1 flex-col">
			<div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-7 py-6">
				<div class="space-y-1.5">
					<Label for="employeeId">Employee</Label>
					<select id="employeeId" name="employeeId" class={selectClass} required>
						<option value="" disabled selected>Choose a person</option>
						{#each data.people as p (p.id)}
							<option value={p.id}>{p.name} · #{p.employeeNo}{p.alreadySeparated ? ' (marked separated)' : ''}</option>
						{/each}
					</select>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div class="space-y-1.5">
						<Label for="kind">Reason</Label>
						<select id="kind" name="kind" class={selectClass} required>
							{#each data.kinds as k (k.value)}<option value={k.value}>{k.label}</option>{/each}
						</select>
					</div>
					<div class="space-y-1.5">
						<Label for="lastDay">Last day</Label>
						<Input id="lastDay" name="lastDay" type="date" value={data.today} required />
					</div>
				</div>
				<div class="space-y-1.5">
					<Label for="note">Note <span class="text-ink-muted">(optional)</span></Label>
					<Input id="note" name="note" maxlength={500} />
				</div>
			</div>
			<Dialog.Footer class="flex-row justify-end gap-2 border-t border-dotted border-ink/20 bg-white/70 px-7 py-4">
				<Button type="button" variant="outline" onclick={() => (starting = false)}>Cancel</Button>
				<Button type="submit" disabled={busy}>Start</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
