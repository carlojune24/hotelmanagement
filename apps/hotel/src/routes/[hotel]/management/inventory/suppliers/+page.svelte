<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import TruckIcon from '@lucide/svelte/icons/truck';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Supplier = PageData['suppliers'][number];
	let sheet = $state<{ open: boolean; s: Supplier | null }>({ open: false, s: null });
	let busy = $state(false);
	let showInactive = $state(false);

	const active = $derived(data.suppliers.filter((s) => s.isActive));
	const inactive = $derived(data.suppliers.filter((s) => !s.isActive));
	const shown = $derived(showInactive ? data.suppliers : active);

	const dateFmt = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
	const fmtDate = (d: string) => dateFmt.format(new Date(`${d}T00:00:00Z`));
	const contact = (s: Supplier) => [s.contactName, s.contactPhone, s.contactEmail].filter(Boolean).join(' · ');

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});
</script>

<svelte:head><title>Suppliers · Inventory</title></svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<div class="flex max-w-4xl flex-wrap items-end justify-between gap-3">
		<div>
			<h2 class="text-base font-semibold text-ink">Suppliers</h2>
			<p class="mt-1 text-sm text-ink-muted">Who you buy from. Restock and Finance → Expenses pick from this list.</p>
		</div>
		<Button onclick={() => (sheet = { open: true, s: null })}><PlusIcon class="size-4" />Add supplier</Button>
	</div>

	{#if shown.length}
		<ul class="mt-6 max-w-4xl divide-y divide-border border-t border-border">
			{#each shown as s (s.id)}
				<li class="flex items-center gap-3 py-2.5">
					<div class="min-w-0 flex-1">
						<p class="truncate text-base {s.isActive ? 'text-ink' : 'text-ink-muted'}">
							{s.name}{#if s.tin}<span class="ml-2 text-xs text-ink-muted">TIN {s.tin}</span>{/if}{#if !s.isActive}<span class="ml-2 text-xs text-ink-muted">inactive</span>{/if}
						</p>
						<p class="truncate text-xs text-ink-muted">
							{[contact(s), s.receipts ? `${s.receipts} receipt${s.receipts === 1 ? '' : 's'} · last ${fmtDate(s.lastReceipt!)}` : 'No receipts yet'].filter(Boolean).join(' · ')}
						</p>
					</div>
					<Button variant="ghost" class="gap-1.5" onclick={() => (sheet = { open: true, s })} aria-label="Edit {s.name}">
						<PencilIcon class="size-4" aria-hidden="true" /><span class="hidden sm:inline">Edit</span>
					</Button>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="mt-8 max-w-4xl rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
			<TruckIcon class="mx-auto mb-2 size-6" aria-hidden="true" />
			<p class="font-medium text-ink">No suppliers yet.</p>
			<p class="mt-1">Add the shops and suppliers you buy from, so receipts can name them in one tap.</p>
		</div>
	{/if}

	{#if inactive.length}
		<button type="button" class="mt-4 text-sm text-ink-muted underline" onclick={() => (showInactive = !showInactive)}>
			{showInactive ? 'Hide' : 'Show'} {inactive.length} inactive
		</button>
	{/if}
</div>

<Sheet.Root bind:open={sheet.open}>
	<Sheet.Content side="right" class="flex w-full flex-col gap-0 p-0 sm:max-w-md">
		{@const s = sheet.s}
		<Sheet.Header class="border-b border-border px-5 py-4">
			<Sheet.Title>{s ? `Edit ${s.name}` : 'New supplier'}</Sheet.Title>
			<Sheet.Description>Only the name is needed. Finance may want the TIN for receipts with VAT.</Sheet.Description>
		</Sheet.Header>
		<form
			method="POST"
			action="?/save"
			class="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4"
			use:enhance={() => {
				busy = true;
				return async ({ result, update }) => {
					busy = false;
					if (result.type === 'success') sheet.open = false;
					await update({ reset: false });
				};
			}}
		>
			<input type="hidden" name="id" value={s?.id ?? ''} />
			<div>
				<Label for="sp-name">Name</Label>
				<Input id="sp-name" name="name" required maxlength={160} value={s?.name ?? ''} placeholder="CleanPro Supplies Trading" class="mt-1.5" />
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="sp-tin">TIN (optional)</Label>
					<Input id="sp-tin" name="tin" maxlength={40} value={s?.tin ?? ''} class="mt-1.5" />
				</div>
				<div>
					<Label for="sp-phone">Phone (optional)</Label>
					<Input id="sp-phone" name="contactPhone" type="tel" maxlength={40} value={s?.contactPhone ?? ''} class="mt-1.5" />
				</div>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="sp-contact">Contact person (optional)</Label>
					<Input id="sp-contact" name="contactName" maxlength={120} value={s?.contactName ?? ''} class="mt-1.5" />
				</div>
				<div>
					<Label for="sp-email">Email (optional)</Label>
					<Input id="sp-email" name="contactEmail" type="email" maxlength={160} value={s?.contactEmail ?? ''} class="mt-1.5" />
				</div>
			</div>
			<div>
				<Label for="sp-address">Address (optional)</Label>
				<Input id="sp-address" name="address" maxlength={300} value={s?.address ?? ''} class="mt-1.5" />
			</div>
			{#if s}
				<div class="flex items-start gap-2">
					<Checkbox id="sp-active" name="isActive" value="on" checked={s.isActive} class="mt-0.5" />
					<Label for="sp-active" class="font-normal">Active (inactive suppliers are hidden from Restock and Expenses)</Label>
				</div>
			{:else}
				<input type="hidden" name="isActive" value="on" />
			{/if}

			<div class="mt-auto flex items-center justify-between gap-2 border-t border-border pt-4">
				{#if s}
					<Button type="submit" variant="ghost" class="text-danger hover:text-danger" formaction="?/delete" formnovalidate>Delete</Button>
				{:else}
					<span></span>
				{/if}
				<div class="flex gap-2">
					<Button type="button" variant="outline" onclick={() => (sheet.open = false)}>Cancel</Button>
					<Button type="submit" disabled={busy}>{s ? 'Save' : 'Add supplier'}</Button>
				</div>
			</div>
		</form>
	</Sheet.Content>
</Sheet.Root>
