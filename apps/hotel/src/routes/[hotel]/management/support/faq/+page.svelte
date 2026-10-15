<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const back = $derived(`/${page.params.hotel}/management/support`);

	$effect(() => {
		if (form && 'error' in form && form.error) toast.error(form.error);
		if (form && 'saved' in form && form.saved) toast.success('FAQ saved.');
		if (form && 'removed' in form && form.removed) toast.success('FAQ deleted.');
	});
</script>

<svelte:head><title>Support FAQ</title></svelte:head>

<div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
	<a href={back} class="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
		<ArrowLeftIcon class="size-4" aria-hidden="true" /> Support inbox
	</a>
	<h1 class="text-lg font-semibold text-ink">Support FAQ</h1>
	<p class="mt-1 text-sm text-ink-muted">
		Guests see these as quick questions when they open the chat. Check-in and check-out times and how to book are added for you.
	</p>

	<form method="POST" action="?/save" use:enhance class="mt-6 space-y-3 rounded-xl border border-border bg-surface p-4">
		<h2 class="text-sm font-semibold text-ink">Add a question</h2>
		<div>
			<Label for="faq-q">Question</Label>
			<Input id="faq-q" name="question" maxlength={200} required class="mt-1" placeholder="Is parking free?" />
		</div>
		<div>
			<Label for="faq-a">Answer</Label>
			<Textarea id="faq-a" name="answer" maxlength={2000} rows={3} required class="mt-1" />
		</div>
		<input type="hidden" name="isActive" value="on" />
		<div class="flex justify-end"><Button type="submit">Add question</Button></div>
	</form>

	<ul class="mt-6 space-y-3">
		{#each data.faqs as f (f.id)}
			<li class="rounded-xl border border-border bg-surface p-4">
				<form method="POST" action="?/save" use:enhance={() => async ({ update }) => update({ reset: false })} class="space-y-3">
					<input type="hidden" name="id" value={f.id} />
					<Input name="question" value={f.question} maxlength={200} required aria-label="Question" />
					<Textarea name="answer" value={f.answer} maxlength={2000} rows={3} required aria-label="Answer" />
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div class="flex items-center gap-4 text-sm">
							<label class="inline-flex items-center gap-2">
								<input type="checkbox" name="isActive" checked={f.isActive} /> Shown to guests
							</label>
							<label class="inline-flex items-center gap-2">
								Order
								<input type="number" name="sortOrder" value={f.sortOrder} min="0" max="9999" class="h-8 w-16 rounded-md border border-border bg-surface px-2 text-sm" />
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
			<li class="rounded-xl border border-dashed border-border p-6 text-center text-sm text-ink-muted">No custom questions yet.</li>
		{/each}
	</ul>
</div>
