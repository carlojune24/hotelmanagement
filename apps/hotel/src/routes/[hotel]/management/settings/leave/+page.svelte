<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { CALENDAR_KINDS, CALENDAR_KIND_LABEL, EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABEL } from '$lib/leave';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const base = $derived(`/${page.params.hotel}/management`);

	type LeaveType = PageData['types'][number];
	type Day = PageData['calendar'][number];

	let tab = $state<'types' | 'calendar'>('types');
	let editingType = $state<LeaveType | 'new' | null>(null);
	let editingDay = $state<Day | 'new' | null>(null);
	let deletingType = $state<LeaveType | null>(null);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		else if (form?.ok) {
			toast.success(form.ok);
			editingType = null;
			editingDay = null;
			deletingType = null;
		}
	});

	const blankType: LeaveType = {
		id: '',
		code: '',
		name: '',
		description: '',
		statutory: false,
		paid: true,
		daysPerYear: 0,
		dayCount: 'working',
		minServiceMonths: 0,
		employmentTypes: [],
		sexRestriction: null,
		halfDayAllowed: false,
		carryOverDays: 0,
		cashConvertible: false,
		requiresDocument: false,
		active: true
	};
	const typeDraft = $derived(editingType === 'new' || editingType === null ? blankType : editingType);
	const dayDraft = $derived(
		editingDay && editingDay !== 'new'
			? editingDay
			: ({ id: '', date: '', name: '', kind: 'regular_holiday', creditMinutes: null, waiveLateness: false } as Day)
	);

	const fmtDay = (d: string) =>
		new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});
	function rule(t: LeaveType): string {
		const bits: string[] = [];
		bits.push(t.daysPerYear > 0 ? `${t.daysPerYear} ${t.dayCount === 'calendar' ? 'calendar' : 'working'} days` : 'No fixed allowance');
		if (t.minServiceMonths) bits.push(`after ${t.minServiceMonths} mo`);
		if (t.employmentTypes.length) bits.push(t.employmentTypes.map((e) => e.replace('_', '-')).join(', '));
		if (t.sexRestriction) bits.push(`${t.sexRestriction} only`);
		return bits.join(' · ');
	}
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between gap-3">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Leave &amp; holidays</h1>
			<p class="text-sm text-ink-muted">
				The rules leave is filed under, and the holidays and memorandums that cover everyone's schedule.
				Changing a rule affects new requests only; leave already approved keeps what it was filed with.
			</p>
		</div>
		<Button variant="outline" href="{base}/settings">← Settings</Button>
	</div>

	<div class="mb-4 flex gap-1.5" role="group" aria-label="Section">
		<Button variant={tab === 'types' ? 'default' : 'outline'} size="sm" onclick={() => (tab = 'types')} aria-pressed={tab === 'types'}>Leave types</Button>
		<Button variant={tab === 'calendar' ? 'default' : 'outline'} size="sm" onclick={() => (tab = 'calendar')} aria-pressed={tab === 'calendar'}>Holidays &amp; memos</Button>
	</div>

	{#if tab === 'types'}
		<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
			<p class="text-sm text-ink-muted">
				Statutory leaves follow Philippine law as commonly summarised. Check them with DOLE or your
				counsel before relying on them.
			</p>
			<div class="flex gap-2">
				<form method="POST" action="?/restoreDefaults" use:enhance class="contents">
					<Button type="submit" variant="outline" size="sm">Restore legal defaults</Button>
				</form>
				<Button size="sm" onclick={() => (editingType = 'new')}><PlusIcon class="size-4" /> Add leave</Button>
			</div>
		</div>
		<div class="overflow-x-auto rounded-lg border border-border bg-surface">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Leave</Table.Head>
						<Table.Head>Rule</Table.Head>
						<Table.Head>Pay</Table.Head>
						<Table.Head>On</Table.Head>
						<Table.Head class="w-24"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.types as t (t.id)}
						<Table.Row class={t.active ? '' : 'text-ink-muted'}>
							<Table.Cell>
								<span class="font-mono text-xs">{t.code}</span>
								<span class="ml-1 font-medium">{t.name}</span>
								{#if t.statutory}<Badge variant="secondary" class="ml-1">Statutory</Badge>{/if}
							</Table.Cell>
							<Table.Cell class="text-sm">{rule(t)}</Table.Cell>
							<Table.Cell>{t.paid ? 'Paid' : 'Unpaid'}</Table.Cell>
							<Table.Cell>{t.active ? 'Yes' : 'Off'}</Table.Cell>
							<Table.Cell class="text-right whitespace-nowrap">
								<Button variant="ghost" size="icon" class="size-8" aria-label="Edit {t.name}" onclick={() => (editingType = t)}>
									<PencilIcon class="size-4" />
								</Button>
								{#if !t.statutory}
									<Button variant="ghost" size="icon" class="size-8" aria-label="Delete {t.name}" onclick={() => (deletingType = t)}>
										<Trash2Icon class="size-4" />
									</Button>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{:else}
		<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
			<p class="text-sm text-ink-muted">
				A holiday or memo covers everyone scheduled that day: no absence, and the day is credited.
				Holiday premium pay stays with payroll.
			</p>
			<div class="flex items-center gap-2">
				<Button variant="outline" size="icon" href="?year={data.year - 1}" aria-label="Previous year">
					<ChevronLeftIcon class="size-4" />
				</Button>
				<span class="w-12 text-center text-sm font-medium tabular-nums">{data.year}</span>
				<Button variant="outline" size="icon" href="?year={data.year + 1}" aria-label="Next year">
					<ChevronRightIcon class="size-4" />
				</Button>
				<Button size="sm" onclick={() => (editingDay = 'new')}><PlusIcon class="size-4" /> Add day</Button>
			</div>
		</div>
		<div class="overflow-x-auto rounded-lg border border-border bg-surface">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Date</Table.Head>
						<Table.Head>Name</Table.Head>
						<Table.Head>Kind</Table.Head>
						<Table.Head>Credited</Table.Head>
						<Table.Head class="w-24"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.calendar as c (c.id)}
						<Table.Row>
							<Table.Cell class="whitespace-nowrap">{fmtDay(c.date)}</Table.Cell>
							<Table.Cell class="font-medium">{c.name}</Table.Cell>
							<Table.Cell>{CALENDAR_KIND_LABEL[c.kind as (typeof CALENDAR_KINDS)[number]] ?? c.kind}</Table.Cell>
							<Table.Cell>
								{c.creditMinutes === null ? 'Full day' : `${c.creditMinutes / 60} h`}{c.waiveLateness ? ' · late/under waived' : ''}
							</Table.Cell>
							<Table.Cell class="text-right whitespace-nowrap">
								<Button variant="ghost" size="icon" class="size-8" aria-label="Edit {c.name}" onclick={() => (editingDay = c)}>
									<PencilIcon class="size-4" />
								</Button>
								<form method="POST" action="?/deleteDay" use:enhance class="inline">
									<input type="hidden" name="id" value={c.id} />
									<Button type="submit" variant="ghost" size="icon" class="size-8" aria-label="Delete {c.name}">
										<Trash2Icon class="size-4" />
									</Button>
								</form>
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={5} class="py-10 text-center text-sm text-ink-muted">
								No holidays or memorandums entered for {data.year}.
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{/if}
</div>

<Dialog.Root open={editingType !== null} onOpenChange={(o) => !o && (editingType = null)}>
	<Dialog.Content class="flex max-h-[90vh] flex-col sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>{editingType === 'new' ? 'Add leave' : `Edit ${typeDraft.name}`}</Dialog.Title>
			{#if typeDraft.description}
				<Dialog.Description>{typeDraft.description}</Dialog.Description>
			{/if}
		</Dialog.Header>
		{#key editingType === 'new' ? 'new' : typeDraft.id}
			<form method="POST" action="?/saveType" use:enhance class="flex min-h-0 flex-1 flex-col gap-3">
				<input type="hidden" name="id" value={typeDraft.id} />
				<div class="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
					<div class="grid gap-3 sm:grid-cols-[8rem_1fr]">
						<div>
							<Label for="ltCode">Code</Label>
							<Input id="ltCode" name="code" value={typeDraft.code} class="mt-1 font-mono uppercase" required maxlength={8} />
						</div>
						<div>
							<Label for="ltName">Name</Label>
							<Input id="ltName" name="name" value={typeDraft.name} class="mt-1" required />
						</div>
					</div>
					<div>
						<Label for="ltDesc">Notes</Label>
						<Textarea id="ltDesc" name="description" value={typeDraft.description} rows={2} class="mt-1" />
					</div>
					<div class="grid gap-3 sm:grid-cols-3">
						<div>
							<Label for="ltDays">Days per year</Label>
							<Input id="ltDays" name="daysPerYear" type="number" min="0" step="0.5" value={typeDraft.daysPerYear} class="mt-1" />
							<p class="mt-1 text-xs text-ink-muted">0 = no fixed allowance</p>
						</div>
						<div>
							<Label for="ltCount">Days counted as</Label>
							<select id="ltCount" name="dayCount" class="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
								<option value="working" selected={typeDraft.dayCount === 'working'}>Working days</option>
								<option value="calendar" selected={typeDraft.dayCount === 'calendar'}>Calendar days</option>
							</select>
						</div>
						<div>
							<Label for="ltTenure">Months of service</Label>
							<Input id="ltTenure" name="minServiceMonths" type="number" min="0" value={typeDraft.minServiceMonths} class="mt-1" />
						</div>
					</div>
					<div class="grid gap-3 sm:grid-cols-2">
						<div>
							<Label for="ltSex">Open to</Label>
							<select id="ltSex" name="sexRestriction" class="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
								<option value="" selected={!typeDraft.sexRestriction}>Everyone</option>
								<option value="female" selected={typeDraft.sexRestriction === 'female'}>Female employees</option>
								<option value="male" selected={typeDraft.sexRestriction === 'male'}>Male employees</option>
							</select>
						</div>
						<div>
							<Label for="ltCarry">Carry over to next year (days)</Label>
							<Input id="ltCarry" name="carryOverDays" type="number" min="0" step="0.5" value={typeDraft.carryOverDays} class="mt-1" />
						</div>
					</div>
					<fieldset>
						<legend class="text-sm font-medium text-ink">Employment types allowed</legend>
						<p class="text-xs text-ink-muted">Leave all unticked for everyone.</p>
						<div class="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
							{#each EMPLOYMENT_TYPES as e (e)}
								<label class="flex items-center gap-1.5 text-sm">
									<input type="checkbox" name="employmentTypes" value={e} checked={typeDraft.employmentTypes.includes(e)} class="size-4" />
									{EMPLOYMENT_TYPE_LABEL[e]}
								</label>
							{/each}
						</div>
					</fieldset>
					<div class="grid gap-2 sm:grid-cols-2">
						{#each [['paid', 'Paid leave', typeDraft.paid], ['halfDayAllowed', 'Can be taken as a half day', typeDraft.halfDayAllowed], ['cashConvertible', 'Unused days convertible to cash', typeDraft.cashConvertible], ['requiresDocument', 'Needs a supporting document', typeDraft.requiresDocument], ['active', 'In use (employees can file it)', typeDraft.active]] as const as [name, label, on] (name)}
							<label class="flex items-center gap-2 text-sm">
								<input type="checkbox" {name} checked={on} class="size-4" />
								{label}
							</label>
						{/each}
					</div>
				</div>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (editingType = null)}>Cancel</Button>
					<Button type="submit">{editingType === 'new' ? 'Add leave' : 'Save changes'}</Button>
				</Dialog.Footer>
			</form>
		{/key}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={deletingType !== null} onOpenChange={(o) => !o && (deletingType = null)}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Delete {deletingType?.name}?</Dialog.Title>
			<Dialog.Description>
				A leave with requests on file can't be deleted; switch it off instead.
			</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/deleteType" use:enhance>
			<input type="hidden" name="id" value={deletingType?.id ?? ''} />
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (deletingType = null)}>Keep</Button>
				<Button type="submit" variant="destructive">Delete</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={editingDay !== null} onOpenChange={(o) => !o && (editingDay = null)}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{editingDay === 'new' ? 'Add holiday or memo' : `Edit ${dayDraft.name}`}</Dialog.Title>
		</Dialog.Header>
		{#key editingDay === 'new' ? 'new' : dayDraft.id}
			<form method="POST" action="?/saveDay" use:enhance class="space-y-3">
				<input type="hidden" name="id" value={dayDraft.id} />
				<div class="grid gap-3 sm:grid-cols-2">
					<div>
						<Label for="cdDate">Date</Label>
						<Input id="cdDate" name="date" type="date" value={dayDraft.date} class="mt-1" required />
					</div>
					<div>
						<Label for="cdKind">Kind</Label>
						<select id="cdKind" name="kind" class="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
							{#each CALENDAR_KINDS as k (k)}
								<option value={k} selected={dayDraft.kind === k}>{CALENDAR_KIND_LABEL[k]}</option>
							{/each}
						</select>
					</div>
				</div>
				<div>
					<Label for="cdName">Name</Label>
					<Input id="cdName" name="name" value={dayDraft.name} placeholder="e.g. Charter Day" class="mt-1" required />
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
						value={dayDraft.creditMinutes === null ? '' : dayDraft.creditMinutes / 60}
						placeholder="Blank = the full scheduled day"
						class="mt-1"
					/>
					<p class="mt-1 text-xs text-ink-muted">For a half-day memo, enter 4.</p>
				</div>
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" name="waiveLateness" checked={dayDraft.waiveLateness} class="size-4" />
					Don't count late or undertime that day
				</label>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (editingDay = null)}>Cancel</Button>
					<Button type="submit">Save</Button>
				</Dialog.Footer>
			</form>
		{/key}
	</Dialog.Content>
</Dialog.Root>
