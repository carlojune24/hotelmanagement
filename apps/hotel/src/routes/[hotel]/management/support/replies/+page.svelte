<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { CANNED_PLACEHOLDERS } from '$lib/support-canned';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const back = $derived(`/${page.params.hotel}/management/support`);
	const example = 'Check-in starts at {checkin} and check-out is by {checkout}.';

	$effect(() => {
		if (form && 'error' in form && form.error) toast.error(form.error);
		if (form && 'saved' in form && form.saved) toast.success('Reply saved.');
		if (form && 'removed' in form && form.removed) toast.success('Reply deleted.');
	});
</script>

<svelte:head><title>Canned replies</title></svelte:head>

<div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
	<a href={back} class="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
		<ArrowLeftIcon class="size-4" aria-hidden="true" /> Support inbox
	</a>
	<h1 class="text-lg font-semibold text-ink">Canned replies</h1>
	<p class="mt-1 text-sm text-ink-muted">
		Ready-made answers for the inbox. In a reply box, type <kbd class="rounded border border-border px-1">/</kbd> to search them, or pick one from the list. You can still edit the text before sending.
	</p>
	<p class="mt-2 text-xs text-ink-muted">
		Placeholders filled in for you:
		{#each CANNED_PLACEHOLDERS as ph (ph.token)}
			<code class="mr-1 rounded bg-surface-2 px-1" title={ph.label}>{ph.token}</code>
		{/each}
	</p>

	<form method="POST" action="?/save" use:enhance class="mt-6 space-y-3 rounded-xl border border-border bg-surface p-4">
		<h2 class="text-sm font-semibold text-ink">Add a reply</h2>
		<div>
			<Label for="cr-t">Title</Label>
			<Input id="cr-t" name="title" maxlength={60} required class="mt-1" placeholder="Check-in time" />
		</div>
		<div>
			<Label for="cr-b">Reply</Label>
			<Textarea id="cr-b" name="body" maxlength={1000} rows={3} required class="mt-1" placeholder={example} />
		</div>
		<input type="hidden" name="isActive" value="on" />
		<div class="flex justify-end"><Button type="submit">Add reply</Button></div>
	</form>

	<ul class="mt-6 space-y-3">
		{#each data.replies as r (r.id)}
			<li class="rounded-xl border border-border bg-surface p-4">
				<form method="POST" action="?/save" use:enhance={() => async ({ update }) => update({ reset: false })} class="space-y-3">
					<input type="hidden" name="id" value={r.id} />
					<Input name="title" value={r.title} maxlength={60} required aria-label="Title" />
					<Textarea name="body" value={r.body} maxlength={1000} rows={3} required aria-label="Reply" />
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div class="flex items-center gap-4 text-sm">
							<label class="inline-flex items-center gap-2">
								<input type="checkbox" name="isActive" checked={r.isActive} /> Available to staff
							</label>
							<label class="inline-flex items-center gap-2">
								Order
								<input type="number" name="sortOrder" value={r.sortOrder} min="0" max="9999" class="h-8 w-16 rounded-md border border-border bg-surface px-2 text-sm" />
							</label>
						</div>
						<div class="flex gap-2">
							<Button type="submit" size="sm">Save</Button>
							<Button type="submit" size="sm" variant="outline" formaction="?/remove" formnovalidate>Delete</Button>
						</div>
					</div>
				</form>
			</li>
		{:else}
			<li class="rounded-xl border border-dashed border-border p-6 text-center text-sm text-ink-muted">No canned replies yet. Add your first one above.</li>
		{/each}
	</ul>
</div>
