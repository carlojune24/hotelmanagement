<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import UploadDialog from './upload-dialog.svelte';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let uploadOpen = $state(false);
	let addOpen = $state(false);
	let removing = $state<{ id: string; name: string } | null>(null);
	let fileFilter = $state('');
	let idSearch = $state('');
	let editing = $state<Record<string, boolean>>({});
	let addId = $state('');
	let addDate = $state('');
	let addTime = $state('');
	let addNote = $state('');

	$effect(() => {
		if (form?.error) toast.error(form.error);
		else if (form?.ok) {
			toast.success(form.ok);
			addOpen = false;
			removing = null;
		}
	});

	const year = $derived(Number(data.month.slice(0, 4)));
	const monthIdx = $derived(Number(data.month.slice(5, 7)));
	const monthName = $derived(
		new Date(Date.UTC(year, monthIdx - 1, 1)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
	);

	function href(over: { month?: string; id?: string | null }): string {
		const q = new URLSearchParams();
		q.set('month', over.month ?? data.month);
		const id = 'id' in over ? over.id : null;
		if (id) q.set('id', id);
		return `?${q.toString()}`;
	}
	function stepMonth(deltaMonths: number): string {
		return new Date(Date.UTC(year, monthIdx - 1 + deltaMonths, 1)).toISOString().slice(0, 7);
	}

	const files = $derived(
		data.uploads.filter((u) => u.fileName.toLowerCase().includes(fileFilter.trim().toLowerCase()))
	);
	const ids = $derived.by(() => {
		const q = idSearch.trim().toLowerCase();
		return q
			? data.ids.filter(
					(i) => i.enrollId.toLowerCase().includes(q) || (i.employeeName ?? '').toLowerCase().includes(q)
				)
			: data.ids;
	});

	type Group = {
		key: string;
		uploadId: string | null;
		title: string;
		sub: string | null;
		punches: PageData['punches'];
	};
	const stamp = (ms: number, withSeconds = false) =>
		new Intl.DateTimeFormat('en-GB', {
			timeZone: data.timezone,
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: withSeconds ? '2-digit' : undefined,
			hourCycle: 'h23'
		})
			.format(ms)
			.replace(',', '');
	const groups = $derived.by(() => {
		const map = new Map<string, Group>();
		for (const p of data.punches) {
			const key = p.source === 'manual' ? 'manual' : (p.uploadId ?? `legacy:${p.fileName ?? ''}`);
			let g = map.get(key);
			if (!g) {
				g = {
					key,
					uploadId: p.source === 'manual' ? null : p.uploadId,
					title: p.source === 'manual' ? 'Added by staff' : (p.fileName ?? 'Earlier upload'),
					sub: p.uploadedAt && p.source !== 'manual' ? `Uploaded ${stamp(p.uploadedAt)}` : null,
					punches: []
				};
				map.set(key, g);
			}
			g.punches.push(p);
		}
		return [...map.values()];
	});

	const done: SubmitFunction = () => {
		return async ({ update }) => {
			await update({ reset: false });
		};
	};

	function openAdd() {
		addId = data.selected?.enrollId ?? '';
		addDate = `${data.month}-01`;
		addTime = '';
		addNote = '';
		addOpen = true;
	}
</script>

<div class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[16rem_minmax(0,1fr)_18rem]">
	<!-- Left: month, actions, files -->
	<aside class="space-y-4">
		<div class="rounded-lg border border-border bg-surface p-3">
			<p class="text-center text-xs text-ink-muted">Year &amp; month</p>
			<div class="mt-2 flex items-center justify-between">
				<Button variant="ghost" size="icon" href={href({ month: stepMonth(-12) })} aria-label="Previous year">
					<ChevronLeftIcon class="size-4" />
				</Button>
				<span class="text-lg font-semibold text-ink tabular-nums">{year}</span>
				<Button variant="ghost" size="icon" href={href({ month: stepMonth(12) })} aria-label="Next year">
					<ChevronRightIcon class="size-4" />
				</Button>
			</div>
			<div class="flex items-center justify-between">
				<Button variant="ghost" size="icon" href={href({ month: stepMonth(-1) })} aria-label="Previous month">
					<ChevronLeftIcon class="size-4" />
				</Button>
				<span class="text-sm text-ink">{monthName}</span>
				<Button variant="ghost" size="icon" href={href({ month: stepMonth(1) })} aria-label="Next month">
					<ChevronRightIcon class="size-4" />
				</Button>
			</div>
		</div>

		<div class="grid gap-2">
			<Button onclick={() => (uploadOpen = true)}>
				<UploadIcon class="size-4" /> Upload file
			</Button>
			<Button variant="outline" onclick={openAdd}>
				<PlusIcon class="size-4" /> Add time
			</Button>
		</div>

		<div>
			<p class="text-xs font-medium text-ink-muted">Uploaded files · {monthName}</p>
			<div class="relative mt-2">
				<SearchIcon class="absolute top-2.5 left-2.5 size-4 text-ink-muted" />
				<Input bind:value={fileFilter} placeholder="Filter files" class="pl-8" aria-label="Filter files" />
			</div>
			<ul class="mt-2 divide-y divide-border rounded-lg border border-border bg-surface">
				{#each files as f (f.id)}
					<li class="flex items-start gap-2 p-2.5">
						<FileTextIcon class="mt-0.5 size-4 shrink-0 text-ink-muted" />
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm text-ink" title={f.fileName}>{f.fileName}</p>
							<p class="text-xs text-ink-muted">
								{stamp(f.createdAt.getTime())} · {f.newCount} new{f.punchCount > f.newCount
									? ` of ${f.punchCount}`
									: ''}
							</p>
						</div>
						<Button
							variant="ghost"
							size="icon"
							class="size-7"
							aria-label="Remove {f.fileName}"
							onclick={() => (removing = { id: f.id, name: f.fileName })}
						>
							<Trash2Icon class="size-4" />
						</Button>
					</li>
				{:else}
					<li class="p-3 text-sm text-ink-muted">
						{data.uploads.length ? 'No file matches.' : 'No files filed under this month.'}
					</li>
				{/each}
			</ul>
		</div>
	</aside>

	<!-- Centre: punches of the selected ID -->
	<section class="min-w-0 space-y-5">
		{#if data.selected}
			<header class="border-b border-border pb-3">
				<h2 class="text-xl font-semibold text-ink">
					{data.selected.employeeName ?? `Biometric ID ${data.selected.enrollId}`}
				</h2>
				<p class="mt-0.5 text-sm text-ink-muted">
					ID <span class="font-mono text-ink">{data.selected.enrollId}</span>
					{#if !data.selected.employeeName}· not linked to an employee yet{/if}
					· {data.selected.punches} punch{data.selected.punches === 1 ? '' : 'es'} in {monthName}
				</p>
			</header>

			{#each groups as g (g.key)}
				<div>
					<div class="flex flex-wrap items-start justify-between gap-2">
						<div class="min-w-0">
							<h3 class="truncate text-sm font-semibold text-ink">{g.title}</h3>
							{#if g.sub}<p class="text-xs text-ink-muted">{g.sub}</p>{/if}
						</div>
						<div class="flex gap-1.5">
							<Button
								variant="outline"
								size="sm"
								onclick={() => (editing[g.key] = !editing[g.key])}
								aria-pressed={!!editing[g.key]}
							>
								<PencilIcon class="size-3.5" />
								{editing[g.key] ? 'Done' : 'Edit'}
							</Button>
							{#if g.uploadId}
								<Button
									variant="outline"
									size="sm"
									class="text-danger"
									onclick={() => (removing = { id: g.uploadId!, name: g.title })}
								>
									<Trash2Icon class="size-3.5" /> Remove file
								</Button>
							{/if}
						</div>
					</div>
					<ul class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
						{#each g.punches as p (p.id)}
							<li
								class="flex items-center justify-between gap-1 rounded-md bg-muted px-2.5 py-1.5 text-sm text-ink tabular-nums"
								title={p.note ?? undefined}
							>
								<span>{stamp(p.punchedAt)}</span>
								{#if editing[g.key]}
									<form method="POST" action="?/removePunch" use:enhance={done}>
										<input type="hidden" name="id" value={p.id} />
										<button
											type="submit"
											class="rounded p-0.5 text-ink-muted hover:text-danger"
											aria-label="Remove punch {stamp(p.punchedAt)}"
										>
											<XIcon class="size-3.5" />
										</button>
									</form>
								{/if}
							</li>
						{/each}
					</ul>
					{#if g.key === 'manual'}
						<ul class="mt-1.5 space-y-0.5 text-xs text-ink-muted">
							{#each g.punches.filter((p) => p.note) as p (p.id)}
								<li>{stamp(p.punchedAt)} — {p.note}</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/each}
		{:else}
			<div class="rounded-xl border border-dashed border-border p-10 text-center">
				<p class="text-sm font-medium text-ink">No punches for {monthName} {year}</p>
				<p class="mt-1 text-sm text-ink-muted">
					Upload the biometric export for this month. Everyone in the file is stored, whether or not
					they have an employee record.
				</p>
				<Button class="mt-4" onclick={() => (uploadOpen = true)}>
					<UploadIcon class="size-4" /> Upload file
				</Button>
			</div>
		{/if}
	</section>

	<!-- Right: every Biometric ID found -->
	<aside class="space-y-2">
		<div class="relative">
			<SearchIcon class="absolute top-2.5 left-2.5 size-4 text-ink-muted" />
			<Input bind:value={idSearch} placeholder="Search Biometric ID or name" class="pl-8" aria-label="Search Biometric ID" />
		</div>
		<p class="text-xs text-ink-muted">{data.ids.length} ID{data.ids.length === 1 ? '' : 's'} in {monthName}</p>
		<ul class="max-h-[70vh] divide-y divide-border overflow-y-auto rounded-lg border border-border bg-surface">
			{#each ids as i (i.enrollKey)}
				<li>
					<a
						href={href({ id: i.enrollKey })}
						class="flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-muted/60 {data.selected?.enrollKey ===
						i.enrollKey
							? 'bg-muted'
							: ''}"
						aria-current={data.selected?.enrollKey === i.enrollKey ? 'true' : undefined}
					>
						<div class="min-w-0">
							<p class="font-mono text-sm font-medium text-ink">{i.enrollId}</p>
							<p class="truncate text-xs {i.employeeName ? 'text-ink-muted' : 'text-warning'}">
								{i.employeeName ?? 'No employee yet'}
							</p>
						</div>
						<Badge variant="secondary" class="tabular-nums">{i.punches}</Badge>
					</a>
				</li>
			{:else}
				<li class="p-3 text-sm text-ink-muted">
					{data.ids.length ? 'No ID matches.' : 'Nothing uploaded for this month.'}
				</li>
			{/each}
		</ul>
	</aside>
</div>

<UploadDialog bind:open={uploadOpen} templates={data.templates} month={data.month} />

<Dialog.Root open={removing !== null} onOpenChange={(o) => !o && (removing = null)}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Remove this file?</Dialog.Title>
			<Dialog.Description>
				<strong class="text-ink">{removing?.name}</strong> and every punch it brought in will be deleted.
				Punches added by staff are kept.
			</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/removeUpload" use:enhance={done} class="contents">
			<input type="hidden" name="id" value={removing?.id ?? ''} />
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (removing = null)}>Cancel</Button>
				<Button type="submit" variant="destructive">Remove file</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={addOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Add time</Dialog.Title>
			<Dialog.Description>
				For someone proven present who forgot to punch. It is stored as a staff-added punch against
				their Biometric ID, with your reason.
			</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/addPunch" use:enhance={done} class="space-y-3">
			<div>
				<Label for="addId">Biometric ID</Label>
				<Input id="addId" name="enrollId" bind:value={addId} class="mt-1 font-mono" required />
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="addDate">Date</Label>
					<Input id="addDate" name="date" type="date" bind:value={addDate} class="mt-1" required />
				</div>
				<div>
					<Label for="addTime">Time</Label>
					<Input id="addTime" name="time" type="time" bind:value={addTime} class="mt-1" required />
				</div>
			</div>
			<div>
				<Label for="addNote">Reason</Label>
				<Input
					id="addNote"
					name="note"
					bind:value={addNote}
					placeholder="e.g. Forgot to punch out; confirmed by supervisor"
					class="mt-1"
					required
				/>
			</div>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (addOpen = false)}>Cancel</Button>
				<Button type="submit">Add time</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
