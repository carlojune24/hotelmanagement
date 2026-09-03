<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const badgeClass: Record<string, string> = {
		draft: 'border-border bg-surface text-ink-muted',
		published: 'border-transparent bg-ok/15 text-ok',
		archived: 'border-transparent bg-danger/10 text-danger'
	};

	$effect(() => {
		if (form?.error) toast.error(form.error);
	});
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
	<h1 class="mb-6 text-xl font-semibold tracking-tight text-ink">Hotels</h1>

	<div class="grid gap-6 md:grid-cols-[1fr_320px]">
		<section class="rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
			{#if data.hotels.length === 0}
				<p class="text-sm text-ink-muted">No hotels yet. Create the first one.</p>
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Name</Table.Head>
							<Table.Head>Slug</Table.Head>
							<Table.Head>Status</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.hotels as h (h.id)}
							<Table.Row>
								<Table.Cell>
									<a class="font-medium text-brand hover:underline" href="/admin/hotels/{h.id}">
										{h.name}
									</a>
								</Table.Cell>
								<Table.Cell><code class="text-xs">/{h.slug}</code></Table.Cell>
								<Table.Cell>
									<Badge variant="outline" class={badgeClass[h.status]}>{h.status}</Badge>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{/if}
		</section>

		<section class="h-fit rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
			<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">Add hotel</h2>
			<form method="POST" action="?/create" use:enhance class="mt-3 space-y-3">
				<div>
					<Label for="name">Name</Label>
					<Input id="name" name="name" required placeholder="Seaside Inn" class="mt-1" />
				</div>
				<div>
					<Label for="slug">URL slug</Label>
					<Input
						id="slug"
						name="slug"
						required
						placeholder="seaside-inn"
						pattern="[a-z0-9][a-z0-9-]&#123;1,38&#125;[a-z0-9]"
						class="mt-1"
					/>
					<p class="mt-1 text-xs text-ink-muted">Guests and staff reach it at /slug</p>
				</div>
				<Button type="submit" class="w-full">Create draft</Button>
			</form>
		</section>
	</div>
</div>
