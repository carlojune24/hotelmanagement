<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import QrCodeIcon from '@lucide/svelte/icons/qr-code';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	type Tbl = PageData['tables'][number];

	const slug = $derived(page.params.hotel);
	const base = $derived(`/${slug}/management/dining`);

	// '' = every area
	let areaFilter = $state('');
	const groups = $derived.by(() => {
		const out = data.areas
			.map((a) => ({ id: a.id, name: a.name, tables: data.tables.filter((t) => t.areaId === a.id) }))
			.filter((g) => g.tables.length > 0);
		const loose = data.tables.filter((t) => !t.areaId || !data.areas.some((a) => a.id === t.areaId));
		if (loose.length > 0) out.push({ id: '_none', name: 'No area', tables: loose });
		return out.filter((g) => !areaFilter || g.id === areaFilter);
	});
	const areaLabel = $derived(data.areas.find((a) => a.id === areaFilter)?.name ?? 'All areas');

	let rotating = $state<Tbl | null>(null);

	async function copy(link: string) {
		try {
			await navigator.clipboard.writeText(link);
			toast.success('Link copied.');
		} catch {
			toast.error('Could not copy. Select the link and copy it yourself.');
		}
	}

	$effect(() => {
		const f = form;
		if (f?.error) toast.error(f.error);
		if (f?.ok) {
			toast.success(f.ok);
			untrack(() => (rotating = null));
		}
	});
</script>

<svelte:head><title>Table QR codes · Dining</title></svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<div class="mb-5 flex flex-wrap items-end gap-x-4 gap-y-3">
		<div>
			<a href="{base}/floor?venue={data.venue?.id ?? ''}" class="mb-1 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
				<ArrowLeftIcon class="size-4" /> Floor
			</a>
			<h2 class="text-base font-semibold text-ink">Table QR codes</h2>
			<p class="mt-1 max-w-xl text-sm text-ink-muted">
				Print one per table. A guest scans it, sees the menu for that table and orders; a waiter accepts each order before the kitchen
				sees it. Rotating a code makes the printed one stop working.
			</p>
		</div>
		<div class="ml-auto flex flex-wrap items-end gap-3">
			{#if data.venues.length > 1}
				<div>
					<Label for="qrVenue" class="text-xs">Venue</Label>
					<Select.Root type="single" value={data.venue?.id ?? ''} onValueChange={(v) => goto(`?venue=${v}`)}>
						<Select.Trigger id="qrVenue" class="mt-1 w-48">{data.venue?.title ?? 'Choose'}</Select.Trigger>
						<Select.Content>
							{#each data.venues as v (v.id)}<Select.Item value={v.id} label={v.title} />{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/if}
			{#if data.areas.length > 1}
				<div>
					<Label for="qrArea" class="text-xs">Area</Label>
					<Select.Root type="single" value={areaFilter || 'all'} onValueChange={(v) => (areaFilter = v === 'all' ? '' : v)}>
						<Select.Trigger id="qrArea" class="mt-1 w-44">{areaLabel}</Select.Trigger>
						<Select.Content>
							<Select.Item value="all" label="All areas" />
							{#each data.areas as a (a.id)}<Select.Item value={a.id} label={a.name} />{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/if}
			{#if data.venue && data.tables.length > 0}
				<Button href="/{slug}/print/table-qr?venue={data.venue.id}{areaFilter ? `&area=${areaFilter}` : ''}" target="_blank" rel="noopener">
					<PrinterIcon class="size-4" /> Print table tents
				</Button>
			{/if}
		</div>
	</div>

	{#if !data.venue}
		<div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
			<QrCodeIcon class="size-6 text-ink-muted" />
			<p class="text-sm text-ink-muted">Add a venue and its tables first.</p>
			<Button href="{base}/settings" variant="outline">Set up venues</Button>
		</div>
	{:else if data.tables.length === 0}
		<div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
			<QrCodeIcon class="size-6 text-ink-muted" />
			<p class="text-sm text-ink-muted">No tables in {data.venue.title} yet. Add them on the Floor and their QR codes appear here.</p>
			<Button href="{base}/floor?venue={data.venue.id}" variant="outline">Go to the Floor</Button>
		</div>
	{:else}
		{#each groups as g (g.id)}
			<section class="mb-8" aria-labelledby="qr-{g.id}">
				<h3 id="qr-{g.id}" class="mb-3 text-sm font-semibold text-ink">
					{g.name} <span class="font-normal tabular-nums text-ink-muted">· {g.tables.length}</span>
				</h3>
				<ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each g.tables as t (t.id)}
						<li class="flex flex-col rounded-xl border border-border bg-surface p-4">
							<div class="flex items-baseline justify-between">
								<p class="text-base font-semibold text-ink">Table {t.name}</p>
								<p class="text-xs text-ink-muted">{t.seats} seats</p>
							</div>
							<div class="mx-auto my-3 aspect-square w-full max-w-44 rounded-lg border border-border bg-white p-1 [&>svg]:size-full" aria-label="QR code for table {t.name}" role="img">
								{@html t.svg}
							</div>
							<p class="truncate text-xs text-ink-muted" title={t.link}>{t.link}</p>
							<div class="mt-3 flex gap-2">
								<Button variant="outline" size="sm" class="flex-1" onclick={() => copy(t.link)}><CopyIcon class="size-3.5" /> Copy link</Button>
								<Button variant="outline" size="sm" href={t.link} target="_blank" rel="noopener">Open</Button>
								{#if data.canManage}
									<Button variant="ghost" size="icon" class="size-8" aria-label="Rotate the QR code for table {t.name}" onclick={() => (rotating = t)}>
										<RefreshCwIcon class="size-4" />
									</Button>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	{/if}
</div>

<Dialog.Root open={rotating !== null} onOpenChange={(o) => { if (!o) rotating = null; }}>
	<Dialog.Content class="sm:max-w-sm">
		{#if rotating}
			<Dialog.Header>
				<Dialog.Title>New QR code for table {rotating.name}?</Dialog.Title>
				<Dialog.Description>
					The printed code stops working straight away, so you will need to print and replace it. Do this if a code was photographed or
					shared outside the restaurant.
				</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/rotate" use:enhance>
				<input type="hidden" name="tableId" value={rotating.id} />
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (rotating = null)}>Keep it</Button>
					<Button type="submit" variant="destructive">Make a new code</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
