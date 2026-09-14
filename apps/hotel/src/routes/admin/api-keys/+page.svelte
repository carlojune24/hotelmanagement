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

	$effect(() => {
		if (form && 'ok' in form && form.ok) toast.success(form.ok);
		if (form && 'error' in form && form.error) toast.error(form.error);
	});
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-start justify-between gap-4">
		<div>
			<h1 class="mb-1 text-xl font-semibold tracking-tight text-ink">API keys</h1>
			<p class="text-sm text-ink-muted">
				Read-only access to <code>/api/v1/finance/*</code> across one or more hotels — for a
				central reporting tool consolidating multiple properties. A key issued here can span any
				set of hotels; a key issued from a single hotel's own Finance settings only ever covers
				that hotel.
			</p>
		</div>
		<a
			href="/admin/api-keys/docs"
			class="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm text-ink hover:bg-surface"
		>
			API docs
		</a>
	</div>

	<div class="grid gap-6 md:grid-cols-[1fr_320px]">
		<section class="rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
			{#if data.keys.length === 0}
				<p class="text-sm text-ink-muted">No API keys yet.</p>
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Name</Table.Head>
							<Table.Head>Key</Table.Head>
							<Table.Head>Hotels</Table.Head>
							<Table.Head>Last used</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.keys as k (k.id)}
							<Table.Row class={k.revokedAt ? 'opacity-50' : ''}>
								<Table.Cell class="font-medium text-ink">{k.name}</Table.Cell>
								<Table.Cell><code class="text-xs">{k.keyPrefix}…</code></Table.Cell>
								<Table.Cell>
									<div class="flex flex-wrap gap-1">
										{#each k.hotels as h (h.id)}
											<Badge variant="outline">{h.name}</Badge>
										{/each}
									</div>
								</Table.Cell>
								<Table.Cell class="text-xs text-ink-muted">
									{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'never'}
								</Table.Cell>
								<Table.Cell>
									{#if k.revokedAt}
										<Badge variant="outline">Revoked</Badge>
									{:else}
										<Badge variant="outline" class="border-transparent bg-ok/15 text-ok">Active</Badge>
									{/if}
								</Table.Cell>
								<Table.Cell>
									{#if !k.revokedAt}
										<form method="POST" action="?/revokeApiKeyAction" use:enhance>
											<input type="hidden" name="id" value={k.id} />
											<button class="text-xs text-ink-muted underline underline-offset-2 hover:text-danger">
												Revoke
											</button>
										</form>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{/if}
		</section>

		<section class="h-fit rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
			<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">New key</h2>
			<form method="POST" action="?/createApiKey" use:enhance class="mt-3 space-y-3">
				<div>
					<Label for="name">Name</Label>
					<Input id="name" name="name" required placeholder="Central reporting — prod" class="mt-1" />
				</div>
				<div>
					<Label>Hotels</Label>
					<div class="mt-1 max-h-56 space-y-1.5 overflow-y-auto rounded-md border border-input p-2">
						{#each data.hotels as h (h.id)}
							<label class="flex items-center gap-2 text-sm text-ink">
								<input type="checkbox" name="hotelIds" value={h.id} class="size-4" />
								{h.name}
								<span class="text-xs text-ink-muted">/{h.slug}</span>
							</label>
						{/each}
					</div>
				</div>
				<Button type="submit" class="w-full">Create</Button>
			</form>
		</section>
	</div>

	{#if form && 'rawKey' in form && form.rawKey}
		<div class="mt-6 rounded-lg border border-border bg-muted/40 p-3 text-sm">
			<p class="mb-1 font-medium text-ink">Copy this key now — it won't be shown again:</p>
			<code class="break-all text-xs">{form.rawKey}</code>
		</div>
	{/if}
</div>
