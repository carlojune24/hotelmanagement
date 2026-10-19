<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { CALENDAR_KINDS, CALENDAR_KIND_LABEL } from '$lib/leave';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Day = PageData['days'][number];
	let editing = $state<Day | 'new' | null>(null);
	let busy = $state(false);
	let scope = $state<'company' | 'selected'>('company');
	let picked = $state<string[]>([]);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		else if (form?.ok) {
			toast.success(form.ok);
			editing = null;
		}
	});

	const draft = $derived(
		editing && editing !== 'new'
			? editing
			: ({
					id: '',
					date: '',
					name: '',
					kind: 'regular_holiday',
					scope: 'company',
					establishmentIds: [],
					creditMinutes: null,
					waiveLateness: false
				} as Day)
	);

	// Each time the dialog opens, start from the entry being edited (or a company-wide blank).
	$effect(() => {
		if (editing === null) return;
		scope = draft.scope;
		picked = [...draft.establishmentIds];
	});

	const nameOf = $derived(new Map(data.establishments.map((e) => [e.id, e.name])));
	const fmtDay = (d: string) =>
		new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
	const appliesTo = (d: Day) =>
		d.scope === 'company' ? 'Whole company' : d.establishmentIds.map((id) => nameOf.get(id) ?? 'Former establishment').join(', ');
	const toggle = (id: string, on: boolean) => (picked = on ? [...picked, id] : picked.filter((p) => p !== id));
</script>

<svelte:head><title>Holidays &amp; memos · HR</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
	<div>
		<h1 class="text-5xl font-light tracking-tight">Holidays &amp; memos</h1>
		<p class="mt-2 max-w-3xl text-sm text-ink-muted">
			Main HR sets these once, for the whole company or only for the establishments you choose. They reach each
			establishment's roster, DTR and payroll on their own: no absence that day, and the day is credited. Holiday premium
			pay stays with payroll.
		</p>
	</div>

	<div class="panel space-y-4 p-5">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex items-center gap-2">
				<Button variant="outline" size="icon" href="?year={data.year - 1}" aria-label="Previous year">
					<ChevronLeftIcon class="size-4" />
				</Button>
				<span class="w-14 text-center text-sm font-medium tabular-nums">{data.year}</span>
				<Button variant="outline" size="icon" href="?year={data.year + 1}" aria-label="Next year">
					<ChevronRightIcon class="size-4" />
				</Button>
			</div>
			<Button variant="gold" onclick={() => (editing = 'new')}><PlusIcon class="size-4" /> Add holiday or memo</Button>
		</div>

		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Date</Table.Head>
					<Table.Head>Name</Table.Head>
					<Table.Head>Kind</Table.Head>
					<Table.Head>Applies to</Table.Head>
					<Table.Head>Credited</Table.Head>
					<Table.Head class="w-24"></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.days as d (d.id)}
					<Table.Row>
						<Table.Cell class="whitespace-nowrap">{fmtDay(d.date)}</Table.Cell>
						<Table.Cell class="font-medium">{d.name}</Table.Cell>
						<Table.Cell>{CALENDAR_KIND_LABEL[d.kind as (typeof CALENDAR_KINDS)[number]] ?? d.kind}</Table.Cell>
						<Table.Cell>
							{#if d.scope === 'company'}
								<Badge variant="secondary">Whole company</Badge>
							{:else}
								<span class="text-sm">{appliesTo(d)}</span>
							{/if}
						</Table.Cell>
						<Table.Cell class="text-sm">
							{d.creditMinutes === null ? 'Full day' : `${d.creditMinutes / 60} h`}{d.waiveLateness ? ' · late/under waived' : ''}
						</Table.Cell>
						<Table.Cell class="whitespace-nowrap text-right">
							<Button variant="ghost" size="icon" class="size-8" aria-label="Edit {d.name}" onclick={() => (editing = d)}>
								<PencilIcon class="size-4" />
							</Button>
							<form method="POST" action="?/deleteDay" use:enhance class="inline">
								<input type="hidden" name="id" value={d.id} />
								<Button type="submit" variant="ghost" size="icon" class="size-8" aria-label="Delete {d.name}">
									<Trash2Icon class="size-4" />
								</Button>
							</form>
						</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={6} class="py-10 text-center text-sm text-ink-muted">
							No holidays or memos for {data.year}.
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>

<Dialog.Root open={editing !== null} onOpenChange={(o) => !o && (editing = null)}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title class="font-display text-2xl font-light">
				{editing === 'new' ? 'Add holiday or memo' : `Edit ${draft.name}`}
			</Dialog.Title>
		</Dialog.Header>
		{#key editing === 'new' ? 'new' : draft.id}
			<form
				method="POST"
				action="?/saveDay"
				use:enhance={() => {
					busy = true;
					return async ({ update }) => {
						busy = false;
						await update({ reset: false });
					};
				}}
				class="space-y-3"
			>
				<input type="hidden" name="id" value={draft.id} />
				<div class="grid gap-3 sm:grid-cols-2">
					<div>
						<Label for="cdDate">Date</Label>
						<Input id="cdDate" name="date" type="date" value={draft.date} class="mt-1" required />
					</div>
					<div>
						<Label for="cdKind">Kind</Label>
						<select
							id="cdKind"
							name="kind"
							class="mt-1 h-10 w-full rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							{#each CALENDAR_KINDS as k (k)}
								<option value={k} selected={draft.kind === k}>{CALENDAR_KIND_LABEL[k]}</option>
							{/each}
						</select>
					</div>
				</div>
				<div>
					<Label for="cdName">Name</Label>
					<Input id="cdName" name="name" value={draft.name} placeholder="e.g. Charter Day" class="mt-1" required />
				</div>
				<div>
					<Label for="cdCredit">Hours credited</Label>
					<Input
						id="cdCredit"
						name="creditHours"
						type="number"
						min="0"
						max="24"
						step="0.5"
						value={draft.creditMinutes === null ? '' : draft.creditMinutes / 60}
						placeholder="Blank = the full scheduled day"
						class="mt-1"
					/>
					<p class="mt-1 text-xs text-ink-muted">For a half-day memo, enter 4.</p>
				</div>
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" name="waiveLateness" checked={draft.waiveLateness} class="size-4" />
					Don't count late or undertime that day
				</label>

				<fieldset class="space-y-2">
					<legend class="text-sm font-medium text-ink">Applies to</legend>
					<label class="flex items-center gap-2 text-sm">
						<input type="radio" name="scope" value="company" bind:group={scope} class="size-4" />
						The whole company, including establishments added later
					</label>
					<label class="flex items-center gap-2 text-sm">
						<input type="radio" name="scope" value="selected" bind:group={scope} class="size-4" />
						Only the establishments I choose
					</label>
					{#if scope === 'selected'}
						<ul class="max-h-44 space-y-1 overflow-y-auto rounded-2xl bg-white/70 p-3" aria-label="Establishments">
							{#each data.establishments as e (e.id)}
								<li>
									<label class="flex min-h-9 items-center gap-2 text-sm">
										<input
											type="checkbox"
											name="establishmentIds"
											value={e.id}
											checked={picked.includes(e.id)}
											onchange={(ev) => toggle(e.id, ev.currentTarget.checked)}
											class="size-4"
										/>
										{e.name}
									</label>
								</li>
							{/each}
						</ul>
					{/if}
				</fieldset>

				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (editing = null)}>Cancel</Button>
					<Button type="submit" disabled={busy}>Save</Button>
				</Dialog.Footer>
			</form>
		{/key}
	</Dialog.Content>
</Dialog.Root>
