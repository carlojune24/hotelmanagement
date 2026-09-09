<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	$effect(() => {
		if (form && 'ok' in form && form.ok) toast.success(form.ok);
		if (form && 'error' in form && form.error) toast.error(form.error);
	});

	let showForm = $state(false);
	let newType = $state<'invoice' | 'official_receipt'>('official_receipt');

	const typeLabel = (t: string) => (t === 'invoice' ? 'Invoice' : 'Official Receipt');
	const statusVariant = (s: string) =>
		s === 'active' ? 'default' : s === 'exhausted' ? 'destructive' : 'secondary';
	const remaining = (r: { serialTo: number; nextSerial: number }) =>
		Math.max(0, r.serialTo - r.nextSerial + 1);
</script>

<div class="mb-4 flex items-center justify-between">
	<p class="text-sm text-ink-muted">
		Each row is one BIR-authorized serial range. Numbers are drawn from the <strong>active</strong>
		range for a type; registering a new one supersedes the current active range.
	</p>
	<Button
		size="sm"
		variant={showForm ? 'secondary' : 'default'}
		onclick={() => (showForm = !showForm)}
	>
		{showForm ? 'Cancel' : 'Register series'}
	</Button>
</div>

{#if showForm}
	<form method="POST" action="?/create" use:enhance class="mb-6 rounded-xl border border-border p-5">
		<div class="grid gap-3 sm:grid-cols-2">
			<div>
				<Label class="text-xs" for="type">Document type</Label>
				<select
					id="type"
					name="type"
					bind:value={newType}
					class="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
				>
					<option value="official_receipt">Official Receipt</option>
					<option value="invoice">Invoice</option>
				</select>
			</div>
			<div>
				<Label class="text-xs" for="prefix">Prefix</Label>
				<Input
					id="prefix"
					name="prefix"
					value={newType === 'invoice' ? data.defaults.invoicePrefix : data.defaults.orPrefix}
				/>
			</div>
			<div>
				<Label class="text-xs" for="serialFrom">Serial from</Label>
				<Input id="serialFrom" name="serialFrom" type="number" min="1" placeholder="1" />
			</div>
			<div>
				<Label class="text-xs" for="serialTo">Serial to</Label>
				<Input id="serialTo" name="serialTo" type="number" min="1" placeholder="10000" />
			</div>
			<div>
				<Label class="text-xs" for="startAt">Start at (optional)</Label>
				<Input id="startAt" name="startAt" type="number" min="1" placeholder="= serial from" />
			</div>
			<div>
				<Label class="text-xs" for="atpOrPermitNo">ATP / permit no.</Label>
				<Input id="atpOrPermitNo" name="atpOrPermitNo" />
			</div>
			<div>
				<Label class="text-xs" for="dateRegistered">Date registered</Label>
				<Input id="dateRegistered" name="dateRegistered" type="date" />
			</div>
			<div>
				<Label class="text-xs" for="accreditedPrinter">Accredited printer</Label>
				<Input id="accreditedPrinter" name="accreditedPrinter" />
			</div>
			<div>
				<Label class="text-xs" for="accreditationNo">Accreditation no.</Label>
				<Input id="accreditationNo" name="accreditationNo" />
			</div>
			<div class="sm:col-span-2">
				<Label class="text-xs" for="notes">Notes</Label>
				<Input id="notes" name="notes" />
			</div>
		</div>
		<Button type="submit" class="mt-4">Register series</Button>
	</form>
{/if}

{#if data.series.length === 0}
	<p class="rounded-xl border border-dashed border-border p-6 text-center text-sm text-ink-muted">
		No series registered yet. Documents can't be issued until an active range exists for each type.
	</p>
{:else}
	<div class="space-y-3">
		{#each data.series as r (r.id)}
			<div class="rounded-xl border border-border p-4">
				<div class="flex flex-wrap items-center gap-2">
					<span class="font-medium text-ink">{typeLabel(r.type)}</span>
					<Badge variant={statusVariant(r.status)}>{r.status}</Badge>
					<span class="font-mono text-sm text-ink-muted">
						{r.prefix} {r.serialFrom}–{r.serialTo}
					</span>
				</div>
				<div class="mt-1 text-xs text-ink-muted">
					Next: <span class="font-mono">{r.prefix}{r.nextSerial}</span> ·
					{remaining(r)} of {r.serialTo - r.serialFrom + 1} left
					{#if r.atpOrPermitNo}· ATP {r.atpOrPermitNo}{/if}
					{#if r.dateRegistered}· registered {r.dateRegistered}{/if}
				</div>
				<div class="mt-3 flex gap-2">
					{#if r.status !== 'active'}
						<form method="POST" action="?/setStatus" use:enhance>
							<input type="hidden" name="seriesId" value={r.id} />
							<input type="hidden" name="status" value="active" />
							<Button type="submit" size="sm" variant="outline">Set active</Button>
						</form>
					{/if}
					{#if r.status === 'active'}
						<form method="POST" action="?/setStatus" use:enhance>
							<input type="hidden" name="seriesId" value={r.id} />
							<input type="hidden" name="status" value="exhausted" />
							<Button type="submit" size="sm" variant="outline">Mark exhausted</Button>
						</form>
					{/if}
					<form method="POST" action="?/setStatus" use:enhance>
						<input type="hidden" name="seriesId" value={r.id} />
						<input type="hidden" name="status" value="cancelled" />
						<Button type="submit" size="sm" variant="ghost">Cancel</Button>
					</form>
				</div>
			</div>
		{/each}
	</div>
{/if}
