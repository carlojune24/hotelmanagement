<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import ApplicationStatusBadge from '$lib/components/city/application-status-badge.svelte';
	import { APPLICATION_STATUSES, STATUS_LABEL } from '$lib/city/applications';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const tabs = $derived([
		{ key: null, label: 'All', n: data.total, href: '/city/applications' },
		...APPLICATION_STATUSES.map((s) => ({
			key: s,
			label: STATUS_LABEL[s],
			n: data.counts[s],
			href: `/city/applications?status=${s}`
		}))
	]);

	const fmt = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' });
</script>

<svelte:head><title>Applications — City management</title></svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
	<div class="flex items-center justify-between gap-4">
		<h1 class="text-xl font-semibold tracking-tight text-ink">Applications</h1>
		<Button href="/city/apply">New application</Button>
	</div>

	<nav class="mt-5 flex flex-wrap gap-x-5 gap-y-1 border-b border-border" aria-label="Filter by status">
		{#each tabs as t (t.label)}
			<a
				href={t.href}
				aria-current={data.status === t.key ? 'page' : undefined}
				class="-mb-px border-b-2 px-0.5 pb-2 text-sm {data.status === t.key
					? 'border-brand font-medium text-ink'
					: 'border-transparent text-ink-muted hover:text-ink'}"
			>
				{t.label}
				<span class="ml-1 font-mono text-xs tabular-nums">{t.n}</span>
			</a>
		{/each}
	</nav>

	{#if data.rows.length === 0}
		<p class="mt-8 text-sm text-ink-muted">
			{#if data.total === 0}
				No applications yet. Use “New application” to enter the first one.
			{:else}
				No applications with this status.
			{/if}
		</p>
	{:else}
		<Table.Root class="mt-2">
			<Table.Header>
				<Table.Row>
					<Table.Head>Reference</Table.Head>
					<Table.Head>Hotel</Table.Head>
					<Table.Head>Contact</Table.Head>
					<Table.Head>Permit</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head class="text-right">Received</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.rows as a (a.id)}
					<Table.Row>
						<Table.Cell class="font-mono text-xs">
							<a class="text-brand hover:underline" href="/city/applications/{a.id}">{a.ref}</a>
						</Table.Cell>
						<Table.Cell>
							<span class="font-medium text-ink">{a.hotelName}</span>
							{#if a.city}<span class="block text-xs text-ink-muted">{a.city}</span>{/if}
						</Table.Cell>
						<Table.Cell>{a.contactName}</Table.Cell>
						<Table.Cell class="font-mono text-xs">{a.permitNumber ?? '—'}</Table.Cell>
						<Table.Cell><ApplicationStatusBadge status={a.status} /></Table.Cell>
						<Table.Cell class="text-right text-xs text-ink-muted"
							>{fmt.format(a.createdAt)}</Table.Cell
						>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</div>
