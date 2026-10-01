<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import PermitStatusBadge from '$lib/components/city/permit-status-badge.svelte';
	import { EXPIRING_SOON_DAYS, PERMIT_STATUS_LABEL } from '$lib/city/permits';
	import type { PermitStatus } from '$lib/city/permits';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const order: PermitStatus[] = ['expired', 'expiring', 'none', 'valid'];
	const tabs = $derived([
		{ key: null, label: 'All hotels', n: data.total, href: '/city/permits' },
		...order.map((s) => ({
			key: s,
			label: PERMIT_STATUS_LABEL[s],
			n: data.counts[s],
			href: `/city/permits?status=${s}`
		}))
	]);

	const day = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'UTC' });
	const fmtDay = (s: string) => day.format(new Date(`${s}T00:00:00Z`));
	const when = (n: number) =>
		n === 0 ? 'today' : n > 0 ? `in ${n} ${n === 1 ? 'day' : 'days'}` : `${-n} ${n === -1 ? 'day' : 'days'} ago`;
</script>

<svelte:head><title>Permits — City management</title></svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
	<h1 class="text-xl font-semibold tracking-tight text-ink">Permits</h1>
	<p class="mt-1 text-sm text-ink-muted">
		Each hotel's current business permit — the one expiring latest. “Expiring soon” means within
		{EXPIRING_SOON_DAYS} days.
	</p>

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
				No hotels yet. Permits are tracked per hotel once one exists.
			{:else}
				No hotels in this group.
			{/if}
		</p>
	{:else}
		<Table.Root class="mt-2">
			<Table.Header>
				<Table.Row>
					<Table.Head>Hotel</Table.Head>
					<Table.Head>Permit number</Table.Head>
					<Table.Head>Expires</Table.Head>
					<Table.Head>Status</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.rows as r (r.hotelId)}
					<Table.Row>
						<Table.Cell>
							<a class="font-medium text-brand hover:underline" href="/city/permits/{r.hotelId}"
								>{r.hotelName}</a
							>
						</Table.Cell>
						<Table.Cell class="font-mono text-xs">{r.permitNumber ?? '—'}</Table.Cell>
						<Table.Cell class="text-sm">
							{#if r.expiresOn && r.daysLeft !== null}
								{fmtDay(r.expiresOn)}
								<span class="block text-xs text-ink-muted">{when(r.daysLeft)}</span>
							{:else}
								—
							{/if}
						</Table.Cell>
						<Table.Cell><PermitStatusBadge status={r.status} /></Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</div>
