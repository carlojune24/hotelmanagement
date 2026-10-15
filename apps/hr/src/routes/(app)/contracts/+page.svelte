<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABEL } from '$lib/leave';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let creating = $state(false);
	let busy = $state(false);
	let employeeId = $state('');
	let kind = $state<string>('regular');
	let startDate = $state('');
	let endDate = $state('');
	let search = $state('');
	let filter = $state<'live' | 'all'>('live');

	const label = (k: string) => EMPLOYMENT_TYPE_LABEL[k as keyof typeof EMPLOYMENT_TYPE_LABEL] ?? k;
	const needsEnd = $derived(['fixed_term', 'project', 'seasonal', 'casual', 'probationary'].includes(kind));
	const choices = $derived(
		data.people.filter((p) => `${p.name} ${p.employeeNo}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 80)
	);
	const rows = $derived(data.contracts.filter((c) => filter === 'all' || c.status !== 'void'));
	const day = (d: string) =>
		new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
	const STATUS = {
		issued: { label: 'Issued, unsigned', variant: 'gold' },
		signed: { label: 'Signed', variant: 'ok' },
		void: { label: 'Void', variant: 'muted' }
	} as const;

	function pick(id: string) {
		employeeId = id;
		const p = data.people.find((x) => x.id === id);
		if (p) {
			kind = p.employmentType;
			startDate = p.hiredOn;
			endDate = '';
		}
	}
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

<svelte:head><title>Contracts · HR</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-5xl font-light tracking-tight">Contracts</h1>
			<p class="mt-2 max-w-2xl text-sm text-ink-muted">
				Employment contracts generated from your templates. Each one keeps the wording, position and pay it was issued
				with, and the signed copy once you upload it. Edit the wording under
				<a href="/settings?tab=contracts" class="underline underline-offset-4">Settings → Contract templates</a>.
			</p>
		</div>
		<Button variant="gold" onclick={() => (creating = true)}><PlusIcon /> New contract</Button>
	</div>

	{#if data.due.length > 0}
		<section class="panel space-y-2 p-5" aria-label="Ending soon">
			<h2 class="text-xl font-light">Ending within 30 days</h2>
			<ul class="divide-y divide-dotted divide-ink/25">
				{#each data.due as d (d.id)}
					<li>
						<a href="/contracts/{d.id}" class="flex items-center gap-3 rounded-xl px-2 py-2.5 text-sm hover:bg-gold-soft">
							<Badge variant={d.overdue ? 'destructive' : 'gold'} class="w-24 shrink-0">{d.overdue ? 'Ended' : `${d.daysLeft} days`}</Badge>
							<span class="min-w-0 flex-1">{d.employeeName} · {label(d.kind)} ends {day(d.endDate)}</span>
						</a>
					</li>
				{/each}
			</ul>
			<p class="text-xs text-ink-muted">
				Regularize, renew or let it end. Issuing a newer contract for the person takes them off this list.
			</p>
		</section>
	{/if}

	<section class="panel space-y-4 p-5 md:p-6" aria-label="Contracts">
		<div class="flex gap-2" role="group" aria-label="Show">
			{#each [['live', 'Current'], ['all', 'Including void']] as const as [k, l] (k)}
				<button
					type="button"
					aria-pressed={filter === k}
					onclick={() => (filter = k)}
					class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors {filter === k
						? 'bg-ink text-white'
						: 'bg-ink/10 text-ink hover:bg-ink/15'}">{l}</button
				>
			{/each}
		</div>
		{#if rows.length === 0}
			<div class="hatch rounded-2xl px-6 py-14 text-center">
				<p class="text-lg">No contracts yet</p>
				<p class="mx-auto mt-1 max-w-sm text-sm text-ink-muted">Pick an employee and generate their contract from the template.</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row class="hover:bg-transparent">
						<Table.Head>Employee</Table.Head>
						<Table.Head>Contract</Table.Head>
						<Table.Head>Term</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="w-20"><span class="sr-only">Open</span></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each rows as c (c.id)}
						<Table.Row>
							<Table.Cell>
								<p class="font-medium">{c.employeeName}</p>
								<p class="text-xs text-ink-muted">#{c.employeeNo}{c.establishment ? ` · ${c.establishment}` : ''}</p>
							</Table.Cell>
							<Table.Cell>
								<p>{label(c.kind)}</p>
								<p class="text-xs text-ink-muted">{c.position} · issued {day(c.issuedOn)}</p>
							</Table.Cell>
							<Table.Cell class="text-sm tabular-nums">{day(c.startDate)} → {c.endDate ? day(c.endDate) : 'no end date'}</Table.Cell>
							<Table.Cell>
								<Badge variant={STATUS[c.status].variant}>{STATUS[c.status].label}</Badge>
								{#if c.status === 'signed' && c.signedOn}<p class="mt-1 text-xs text-ink-muted">{day(c.signedOn)}</p>{/if}
							</Table.Cell>
							<Table.Cell class="text-right">
								<Button href="/contracts/{c.id}" size="sm" variant="outline">Open</Button>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</section>
</div>

<Dialog.Root open={creating} onOpenChange={(o) => (creating = o)}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title class="font-display text-2xl font-light">New contract</Dialog.Title>
			<Dialog.Description>
				Generated from the template for the type you choose, with the person's current position and pay.
			</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/create" use:enhance={submit} class="space-y-3">
			<div class="space-y-1.5">
				<Label for="ct-search">Employee</Label>
				<Input id="ct-search" bind:value={search} placeholder="Search name or number" />
				<select
					id="ct-employee"
					name="employeeId"
					size="5"
					required
					bind:value={employeeId}
					onchange={() => pick(employeeId)}
					class="w-full rounded-2xl border border-transparent bg-white p-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					{#each choices as p (p.id)}<option value={p.id}>{p.name} · #{p.employeeNo}</option>{/each}
				</select>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-1.5">
					<Label for="ct-kind">Employment type</Label>
					<select
						id="ct-kind"
						name="kind"
						bind:value={kind}
						class="h-10 w-full rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						{#each EMPLOYMENT_TYPES as k (k)}<option value={k}>{label(k)}</option>{/each}
					</select>
				</div>
				<div class="space-y-1.5">
					<Label for="ct-start">Starts</Label>
					<Input id="ct-start" name="startDate" type="date" required bind:value={startDate} />
				</div>
				<div class="col-span-2 space-y-1.5">
					<Label for="ct-end">{kind === 'probationary' ? 'Probation ends' : 'Ends'}{needsEnd ? '' : ' (optional)'}</Label>
					<Input id="ct-end" name="endDate" type="date" required={needsEnd} bind:value={endDate} />
					{#if kind === 'probationary'}<p class="text-xs text-ink-muted">Probation cannot be longer than six months.</p>{/if}
				</div>
			</div>
			<Dialog.Footer class="gap-2 pt-1">
				<Button type="button" variant="outline" onclick={() => (creating = false)}>Cancel</Button>
				<Button type="submit" variant="gold" disabled={busy}>Generate contract</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
