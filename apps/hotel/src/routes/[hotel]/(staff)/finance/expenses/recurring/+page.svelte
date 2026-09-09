<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const base = $derived(`/${page.params.hotel}/finance`);
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	$effect(() => {
		if (form && 'ok' in form && form.ok) {
			toast.success(form.ok);
			showNew = false;
		}
		if (form && 'error' in form && form.error) toast.error(form.error);
	});
	let showNew = $state(false);
</script>

<div class="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
	<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Recurring expenses</h1>
			<p class="text-sm text-ink-muted">Templates that generate draft expenses when due.</p>
		</div>
		<div class="flex gap-2">
			<a href="{base}/expenses" class="text-sm text-ink-muted underline underline-offset-2">← Expenses</a>
			<form method="POST" action="?/generateDue" use:enhance>
				<Button type="submit" size="sm" variant="outline" disabled={data.dueCount === 0}>
					Generate due now{data.dueCount ? ` (${data.dueCount})` : ''}
				</Button>
			</form>
			<Button size="sm" onclick={() => (showNew = !showNew)}>New template</Button>
		</div>
	</div>

	{#if showNew}
		<form method="POST" action="?/create" use:enhance class="mb-6 grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-3">
			<div>
				<Label class="text-xs">Category</Label>
				<select name="categoryId" required class="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
					{#each data.categories as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
				</select>
			</div>
			<div>
				<Label class="text-xs">Vendor</Label>
				<select name="vendorId" class="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
					<option value="">— none —</option>
					{#each data.vendors as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
				</select>
			</div>
			<div><Label class="text-xs">Amount (₱)</Label><Input name="amount" type="number" min="0.01" step="0.01" required class="mt-1" /></div>
			<div class="sm:col-span-2"><Label class="text-xs">Description</Label><Input name="description" required maxlength={300} class="mt-1" /></div>
			<div>
				<Label class="text-xs">Cadence</Label>
				<select name="cadence" class="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
					{#each data.cadences as c (c)}<option value={c}>{c}</option>{/each}
				</select>
			</div>
			<div><Label class="text-xs">Anchor day (1–31, or 0–6 weekly)</Label><Input name="anchorDay" type="number" min="0" max="31" value="1" class="mt-1" /></div>
			<div><Label class="text-xs">Next due on</Label><Input name="nextDueOn" type="date" value={data.today} required class="mt-1" /></div>
			<label class="flex items-center gap-2 pt-5 text-sm text-ink"><input type="checkbox" name="isVatable" class="size-4" /> VAT-inclusive</label>
			<div class="flex items-end sm:col-span-3"><Button type="submit" size="sm">Save template</Button></div>
		</form>
	{/if}

	<div class="overflow-x-auto rounded-xl border border-border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Description</Table.Head>
					<Table.Head>Category</Table.Head>
					<Table.Head class="text-right">Amount</Table.Head>
					<Table.Head>Cadence</Table.Head>
					<Table.Head>Next due</Table.Head>
					<Table.Head></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.rows as r (r.id)}
					<Table.Row class={r.isActive ? '' : 'opacity-50'}>
						<Table.Cell class="text-ink">{r.description}{#if r.vendorName}<span class="block text-xs text-ink-muted">{r.vendorName}</span>{/if}</Table.Cell>
						<Table.Cell class="text-ink-muted">{r.categoryName}</Table.Cell>
						<Table.Cell class="text-right tabular-nums text-ink">{peso(r.amountCentavos)}</Table.Cell>
						<Table.Cell class="text-ink-muted">{r.cadence}</Table.Cell>
						<Table.Cell class="text-ink-muted">
							{r.nextDueOn}
							{#if r.isActive && r.nextDueOn <= data.today}<Badge variant="outline" class="ml-1 border-transparent bg-brand/15 text-brand">due</Badge>{/if}
						</Table.Cell>
						<Table.Cell class="text-right">
							<form method="POST" action="?/toggle" use:enhance>
								<input type="hidden" name="id" value={r.id} />
								<input type="hidden" name="isActive" value={r.isActive ? 'false' : 'true'} />
								<button class="text-xs text-ink-muted underline underline-offset-2">{r.isActive ? 'Pause' : 'Resume'}</button>
							</form>
						</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row><Table.Cell colspan={6} class="py-6 text-center text-ink-muted">No templates yet.</Table.Cell></Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>
