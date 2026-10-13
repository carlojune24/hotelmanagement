<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	type Row = PageData['announcements'][number];

	let open = $state(false);
	let editing = $state<Row | null>(null);
	let everyone = $state(true);
	let busy = $state(false);
	let showArchived = $state(false);

	const shown = $derived(data.announcements.filter((a) => a.status === 'active'));
	const archived = $derived(data.announcements.filter((a) => a.status === 'archived'));
	const nameOf = (id: string) => data.establishments.find((e) => e.id === id)?.name ?? 'Unknown';
	const audienceLabel = (a: Row) => (a.audience ? a.audience.map(nameOf).join(', ') : 'Every establishment');

	function openNew() {
		editing = null;
		everyone = true;
		open = true;
	}
	function openEdit(a: Row) {
		editing = a;
		everyone = a.audience === null;
		open = true;
	}

	$effect(() => {
		if (form && 'error' in form && form.error) toast.error(form.error);
		else if (form && 'ok' in form && form.ok) {
			toast.success(form.ok);
			open = false;
		}
	});

	function submit() {
		busy = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = false;
		};
	}
</script>

<svelte:head><title>Announcements · HR</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
	<div>
		<h1 class="text-5xl font-light tracking-tight">Announcements</h1>
		<p class="mt-2 max-w-2xl text-sm text-ink-muted">
			Notices to your establishments. They show at the top of each addressed establishment's dashboard
			until you take them down or they expire.
		</p>
	</div>

	<section class="panel space-y-5 p-5 md:p-6" aria-label="Announcements">
		<div class="flex justify-end">
			<Button variant="gold" onclick={openNew}><PlusIcon /> New announcement</Button>
		</div>

		{#if shown.length === 0}
			<div class="hatch rounded-2xl px-6 py-14 text-center">
				<p class="text-lg">Nothing posted</p>
				<p class="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
					Post a notice and your managers and clerks will see it when they open their dashboard.
				</p>
			</div>
		{:else}
			<ul class="divide-y divide-dotted divide-ink/20">
				{#each shown as a (a.id)}
					<li class="flex flex-wrap items-start justify-between gap-3 py-4">
						<div class="min-w-0 max-w-2xl">
							<p class="flex flex-wrap items-center gap-2 font-medium">
								{a.title}
								{#if a.pinned}<Badge variant="gold">Pinned</Badge>{/if}
								{#if a.expired}<Badge variant="muted">Expired</Badge>{/if}
							</p>
							<p class="text-xs text-ink-muted tabular-nums">
								Posted {a.postedOn}{#if a.expiresOn} · until {a.expiresOn}{/if} · {audienceLabel(a)}
							</p>
							<p class="mt-1 line-clamp-3 text-sm whitespace-pre-line">{a.body}</p>
						</div>
						<div class="flex gap-2">
							<Button variant="outline" size="sm" onclick={() => openEdit(a)}>Edit</Button>
							<form method="POST" action="?/status" use:enhance={submit}>
								<input type="hidden" name="id" value={a.id} />
								<input type="hidden" name="to" value="archived" />
								<Button type="submit" variant="outline" size="sm" disabled={busy}>Take down</Button>
							</form>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		{#if archived.length > 0}
			<div class="border-t border-dotted border-ink/20 pt-4">
				<Button variant="ghost" size="sm" onclick={() => (showArchived = !showArchived)} aria-expanded={showArchived}>
					{showArchived ? 'Hide' : 'Show'} taken down ({archived.length})
				</Button>
				{#if showArchived}
					<ul class="mt-2 divide-y divide-dotted divide-ink/20">
						{#each archived as a (a.id)}
							<li class="flex flex-wrap items-center justify-between gap-3 py-3">
								<div>
									<p class="font-medium">{a.title}</p>
									<p class="text-xs text-ink-muted tabular-nums">Posted {a.postedOn} · {audienceLabel(a)}</p>
								</div>
								<form method="POST" action="?/status" use:enhance={submit}>
									<input type="hidden" name="id" value={a.id} />
									<input type="hidden" name="to" value="active" />
									<Button type="submit" variant="outline" size="sm" disabled={busy}>Show again</Button>
								</form>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</section>
</div>

<Dialog.Root {open} onOpenChange={(o) => (open = o)}>
	<Dialog.Content class="sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title class="font-display text-2xl font-light">
				{editing ? 'Edit announcement' : 'New announcement'}
			</Dialog.Title>
			<Dialog.Description>Shown on the dashboard of every establishment you address it to.</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action={editing ? '?/update' : '?/create'} use:enhance={submit} class="space-y-3">
			{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
			<div class="space-y-1.5">
				<Label for="annTitle">Title</Label>
				<Input id="annTitle" name="title" maxlength={120} required value={editing?.title ?? ''} />
			</div>
			<div class="space-y-1.5">
				<Label for="annBody">Message</Label>
				<Textarea id="annBody" name="body" rows={5} maxlength={4000} required value={editing?.body ?? ''} />
			</div>
			<fieldset class="space-y-2">
				<legend class="text-sm font-medium">For</legend>
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" name="everyone" class="size-4 accent-black" bind:checked={everyone} />
					Every establishment
				</label>
				{#if !everyone}
					<div class="grid gap-1.5 pl-6">
						{#each data.establishments as e (e.id)}
							<label class="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									name="establishmentIds"
									value={e.id}
									checked={editing?.audience?.includes(e.id) ?? false}
									class="size-4 accent-black"
								/>
								{e.name}
							</label>
						{/each}
					</div>
				{/if}
			</fieldset>
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-1.5">
					<Label for="annExpires">Stop showing after <span class="text-ink-muted">(optional)</span></Label>
					<Input id="annExpires" name="expiresOn" type="date" min={data.today} value={editing?.expiresOn ?? ''} />
				</div>
				<label class="flex items-end gap-2 pb-2 text-sm">
					<input type="checkbox" name="pinned" class="size-4 accent-black" checked={editing?.pinned ?? false} />
					Pin to the top
				</label>
			</div>
			<Dialog.Footer class="gap-2 pt-1">
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={busy}>{editing ? 'Save' : 'Post'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
