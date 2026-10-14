<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import AuditDetail from '$lib/components/staff/audit-detail.svelte';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import { actionLabel, actorOf, ACTOR_KIND_LABEL } from '$lib/audit-labels';
	import { formatTrailTime } from '$lib/dining-trail-doc';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const base = $derived(`/${page.params.hotel}/management`);

	let expanded = $state<Set<string>>(new Set());
	const when = (v: string | Date) => formatTrailTime(new Date(v).toISOString(), data.timezone);

	// Filters live in the URL so a filtered view can be shared, printed or exported as it is.
	const FILTER_KEYS = ['from', 'to', 'action', 'actor', 'entityType', 'q'] as const;
	function go(patch: Record<string, string | null>, resetPage = true) {
		const url = new URL(page.url);
		for (const [k, v] of Object.entries(patch)) {
			if (v) url.searchParams.set(k, v);
			else url.searchParams.delete(k);
		}
		if (resetPage) url.searchParams.delete('page');
		goto(url.pathname + url.search, { keepFocus: true, noScroll: true });
	}
	const exportQuery = $derived(
		(() => {
			const p = new URLSearchParams();
			for (const k of FILTER_KEYS) {
				const v = page.url.searchParams.get(k);
				if (v) p.set(k, v);
			}
			return p.toString();
		})()
	);
	const filtered = $derived(FILTER_KEYS.some((k) => !!page.url.searchParams.get(k)));

	function submitSearch(e: SubmitEvent) {
		e.preventDefault();
		const f = new FormData(e.currentTarget as HTMLFormElement);
		go({
			q: String(f.get('q') ?? '').trim() || null,
			from: String(f.get('from') ?? '') || null,
			to: String(f.get('to') ?? '') || null
		});
	}

	function toggle(id: string) {
		const next = new Set(expanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expanded = next;
	}

	const actorValue = $derived(data.filter.actor ?? 'all');
	const actorText = $derived(
		actorValue === 'all'
			? 'Anyone'
			: actorValue.startsWith('kind:')
				? ACTOR_KIND_LABEL[actorValue.slice(5) as keyof typeof ACTOR_KIND_LABEL]
				: (data.actors.find((a) => a.id === actorValue)?.label ?? 'Anyone')
	);
	const kindClass = (kind: string) =>
		kind === 'staff'
			? 'border-border bg-surface-2 text-ink'
			: kind === 'guest'
				? 'border-amber-300/70 bg-amber-50 text-amber-900'
				: kind === 'system'
					? 'border-sky-300/70 bg-sky-50 text-sky-900'
					: 'border-dashed border-border bg-transparent text-ink-muted';
	const kindText = (kind: string) => (kind === 'unknown' ? 'Not recorded' : ACTOR_KIND_LABEL[kind as keyof typeof ACTOR_KIND_LABEL]);
	const pageHref = (n: number) => {
		const url = new URL(page.url);
		url.searchParams.set('page', String(n));
		return url.pathname + url.search;
	};
</script>

<div class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Audit log</h1>
			<p class="text-sm text-ink-muted">
				Every tracked mutation in this hotel — who booked, checked in/out, cancelled, took a
				payment, or changed a setting, and when. {data.total.toLocaleString()} {data.total === 1 ? 'entry' : 'entries'}{filtered ? ' match these filters' : ''}.
			</p>
		</div>
		<div class="flex items-center gap-2">
			<Button href="/{page.params.hotel}/print/audit?{exportQuery}" target="_blank" rel="noopener" variant="outline" size="sm">
				<PrinterIcon class="size-4" /> Print
			</Button>
			<Button href="{base}/settings/audit/csv?{exportQuery}" variant="outline" size="sm" download>
				<DownloadIcon class="size-4" /> CSV
			</Button>
			<Button variant="outline" size="sm" href="{base}/dashboard">← Dashboard</Button>
		</div>
	</div>

	<!-- Got a booking code, DN-/TB- code, OR number or payment reference? That has its own search. -->
	<form method="GET" action="{base}/lookup" class="mb-4 flex flex-wrap items-center gap-2" role="search">
		<label class="text-sm text-ink-muted" for="auditLookup">Look up a number</label>
		<Input id="auditLookup" name="q" placeholder="Booking code, DN-…, OR-…" class="h-9 w-64" autocomplete="off" />
		<Button type="submit" size="sm" variant="outline">Find</Button>
	</form>

	<form class="mb-3 flex flex-wrap items-end gap-3" onsubmit={submitSearch} aria-label="Filter the audit log">
		<div class="flex flex-col gap-1">
			<label class="text-xs text-ink-muted" for="aFrom">From</label>
			<Input id="aFrom" name="from" type="date" value={data.filter.from ?? ''} class="h-9 w-40" />
		</div>
		<div class="flex flex-col gap-1">
			<label class="text-xs text-ink-muted" for="aTo">To</label>
			<Input id="aTo" name="to" type="date" value={data.filter.to ?? ''} class="h-9 w-40" />
		</div>
		<div class="flex min-w-48 flex-1 flex-col gap-1">
			<label class="text-xs text-ink-muted" for="aQ">Tracking number, id, actor or action</label>
			<Input id="aQ" name="q" value={data.filter.q ?? ''} placeholder="DN-YBCV, TB-…, a name…" class="h-9" autocomplete="off" />
		</div>
		<Button type="submit" size="sm">Apply</Button>
		{#if filtered}
			<Button type="button" size="sm" variant="ghost" onclick={() => goto(page.url.pathname)}>Clear</Button>
		{/if}
	</form>

	<div class="mb-4 flex flex-wrap items-center gap-3">
		<Select.Root type="single" value={actorValue} onValueChange={(v) => go({ actor: v === 'all' ? null : v })}>
			<Select.Trigger class="w-48 shrink-0" aria-label="Who">{actorText}</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="Anyone" />
				<Select.Item value="kind:staff" label="Any staff" />
				<Select.Item value="kind:guest" label="Guests" />
				<Select.Item value="kind:system" label="System" />
				{#each data.actors as a (a.id)}
					<Select.Item value={a.id} label={a.label} />
				{/each}
			</Select.Content>
		</Select.Root>
		<Select.Root type="single" value={data.filter.action ?? 'all'} onValueChange={(v) => go({ action: v === 'all' ? null : v })}>
			<Select.Trigger class="w-64 shrink-0" aria-label="Action">
				{data.filter.action ? actionLabel(data.filter.action) : 'All actions'}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="All actions" />
				{#each data.actions as a (a)}
					<Select.Item value={a} label={actionLabel(a)} />
				{/each}
			</Select.Content>
		</Select.Root>
		<Select.Root type="single" value={data.filter.entityType ?? 'all'} onValueChange={(v) => go({ entityType: v === 'all' ? null : v })}>
			<Select.Trigger class="w-48 shrink-0" aria-label="Entity type">
				{data.filter.entityType ? data.filter.entityType.replace(/_/g, ' ') : 'All entity types'}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="All entity types" />
				{#each data.entityTypes as t (t)}
					<Select.Item value={t} label={t.replace(/_/g, ' ')} />
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<div class="overflow-hidden rounded-xl border border-border">
		{#if data.entries.length === 0}
			<div class="flex flex-col items-center gap-2 p-10 text-center">
				<ShieldCheckIcon class="size-6 text-ink-muted" />
				<p class="text-sm text-ink-muted">
					{filtered ? 'No entries match these filters.' : 'Nothing recorded yet.'}
				</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="w-44">When</Table.Head>
						<Table.Head>Actor</Table.Head>
						<Table.Head>Action</Table.Head>
						<Table.Head>Entity</Table.Head>
						<Table.Head class="w-20"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.entries as e (e.id)}
						{@const actor = actorOf(e)}
						{@const hasDetail = e.before != null || e.after != null || !!e.ipAddress || !!e.userAgent}
						<Table.Row>
							<Table.Cell class="align-top text-xs whitespace-nowrap text-ink-muted tabular-nums">
								{when(e.createdAt)}
							</Table.Cell>
							<Table.Cell class="align-top">
								{#if e.actorLabel}
									<div class="text-ink">{e.actorLabel.split(' <')[0]}</div>
									<div class="text-xs break-all text-ink-muted">
										{e.actorLabel.match(/<(.+)>/)?.[1] ?? ''}
									</div>
								{/if}
								<Badge variant="outline" class="mt-0.5 text-[11px] {kindClass(actor.kind)}">{kindText(actor.kind)}</Badge>
							</Table.Cell>
							<Table.Cell class="align-top">
								<div class="text-ink">{actionLabel(e.action)}</div>
								<div class="text-xs text-ink-muted">{e.action}</div>
							</Table.Cell>
							<Table.Cell class="align-top text-xs text-ink-muted">
								<span class="capitalize">{e.entityType.replace(/_/g, ' ')}</span>
								{#if e.refCode}<span class="ml-1 font-mono text-ink">{e.refCode}</span>{/if}
								{#if e.href}
									<a href={e.href} class="ml-1 underline underline-offset-2 hover:text-ink">open →</a>
								{:else if e.entityId && !e.refCode}
									<span class="ml-1 font-mono">{e.entityId.slice(0, 8)}</span>
								{/if}
							</Table.Cell>
							<Table.Cell class="align-top text-right">
								{#if hasDetail}
									<Button variant="ghost" size="sm" onclick={() => toggle(e.id)} aria-expanded={expanded.has(e.id)} aria-label="Show details">
										<ChevronDownIcon
											class="size-4 transition-transform {expanded.has(e.id) ? 'rotate-180' : ''}"
										/>
									</Button>
								{/if}
							</Table.Cell>
						</Table.Row>
						{#if hasDetail && expanded.has(e.id)}
							<Table.Row>
								<Table.Cell colspan={5} class="bg-surface-2">
									<AuditDetail ip={e.ipAddress} userAgent={e.userAgent} before={e.before} after={e.after} />
								</Table.Cell>
							</Table.Row>
						{/if}
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>

	{#if data.pages > 1}
		<nav class="mt-4 flex items-center justify-between text-sm" aria-label="Pages">
			<span class="text-ink-muted">Page {data.page} of {data.pages}</span>
			<div class="flex gap-2">
				<Button variant="outline" size="sm" href={pageHref(data.page - 1)} disabled={data.page <= 1}>← Newer</Button>
				<Button variant="outline" size="sm" href={pageHref(data.page + 1)} disabled={data.page >= data.pages}>Older →</Button>
			</div>
		</nav>
	{/if}
</div>
