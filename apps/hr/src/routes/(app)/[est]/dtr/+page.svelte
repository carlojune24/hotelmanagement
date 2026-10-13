<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Action } from 'svelte/action';
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';

	/**
	 * On a wide screen, size the element to the space left under it so the page itself never needs a
	 * scrollbar and only the element's own contents scroll. Measured, not guessed, because what sits above
	 * (hand-off strip, notes) varies. Narrow screens fall back to the CSS max-height on the element.
	 */
	const fitToViewport: Action<HTMLElement, { prop: 'height' | 'maxHeight'; min: number }> = (node, opts) => {
		const reserve = 64; // the panel's and the page's bottom padding
		const fit = () => {
			if (!window.matchMedia('(min-width: 1024px)').matches) {
				node.style[opts!.prop] = '';
				return;
			}
			const top = node.getBoundingClientRect().top + window.scrollY;
			node.style[opts!.prop] = `${Math.max(opts!.min, window.innerHeight - top - reserve)}px`;
		};
		fit();
		window.addEventListener('resize', fit);
		const ro = new ResizeObserver(fit);
		ro.observe(document.body);
		return {
			destroy() {
				window.removeEventListener('resize', fit);
				ro.disconnect();
			}
		};
	};
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import SaveIcon from '@lucide/svelte/icons/save';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/** Sent to Main HR (waiting or already received): the cards take the colour of the Send button. */
	const sent = $derived(data.handoff.status === 'submitted' || data.handoff.status === 'received');
	const handoffBadge = $derived(
		(
			{
				draft: { label: 'Not sent to Main HR', variant: 'muted' },
				returned: { label: 'Returned by Main HR', variant: 'destructive' },
				submitted: { label: 'Sent · awaiting Main HR', variant: 'gold' },
				received: { label: 'Received by Main HR', variant: 'ok' }
			} as const
		)[data.handoff.status]
	);

	// A saved record is what people come to look at, so it opens first; Preview is one tap away.
	const defaultMode = () => (untrack(() => data.savedState) !== 'none' ? 'saved' : 'preview');
	let mode = $state<'preview' | 'saved'>(defaultMode());
	// Opening another person or month starts from that default again; saving or toggling does not.
	$effect(() => {
		void data.selected?.id;
		void data.month;
		mode = defaultMode();
	});
	let search = $state('');
let addOpen = $state(false);
	let returnOpen = $state(false);
	let addDate = $state('');
	let addTime = $state('');
	let addNote = $state('');
	let busy = $state(false);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		else if (form?.ok) {
			toast.success(form.ok);
			addOpen = false;
		}
	});

	const year = $derived(Number(data.month.slice(0, 4)));
	const monthIdx = $derived(Number(data.month.slice(5, 7)));
	const monthName = $derived(
		new Date(Date.UTC(year, monthIdx - 1, 1)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
	);
	function href(over: { month?: string; employee?: string }): string {
		const q = new URLSearchParams();
		q.set('month', over.month ?? data.month);
		const employee = over.employee ?? data.selected?.id;
		if (employee) q.set('employee', employee);
		return `?${q.toString()}`;
	}
	function stepMonth(delta: number): string {
		return new Date(Date.UTC(year, monthIdx - 1 + delta, 1)).toISOString().slice(0, 7);
	}

	const people = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return q
			? data.people.filter((p) => p.name.toLowerCase().includes(q) || p.enrollId.toLowerCase().includes(q))
			: data.people;
	});
	const view = $derived(mode === 'saved' ? data.saved : data.preview);
	const initials = $derived(
		(data.selected?.name ?? '')
			.split(/[ ,]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => w[0])
			.join('')
			.toUpperCase()
	);
	const printHref = $derived(
		data.selected
			? `/print/${page.params.est}/dtr?month=${data.month}&employee=${data.selected.id}`
			: '#'
	);

	function dayTitle(d: string) {
		return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
			weekday: 'short',
			month: 'short',
			day: '2-digit',
			year: 'numeric',
			timeZone: 'UTC'
		});
	}
	function hm(minutes: number) {
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return h > 0 ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
	}
	function openAdd(date: string) {
		addDate = date;
		addTime = '';
		addNote = '';
		addOpen = true;
	}

const run: SubmitFunction = ({ action }) => {
busy = true;
const isSave = action.search === '?/save';
const isReturn = action.search === '?/returnMonth';
return async ({ result, update }) => {
busy = false;
await update({ reset: false });
if (isSave && result.type === 'success') mode = 'saved';
if (isReturn && result.type === 'success') returnOpen = false;
};
};
</script>

<!-- Hand-off to Main HR -->
<div class="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6">
	<div class="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-white/70 p-4">
		<div class="min-w-0 space-y-1">
			<div class="flex flex-wrap items-center gap-2 text-sm font-medium">
				Hand-off to Main HR
				<span
					class="inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium {data.handoff.status === 'received'
						? 'bg-ok/15'
						: data.handoff.status === 'submitted'
							? 'bg-gold'
							: data.handoff.status === 'returned'
								? 'bg-destructive/15'
								: 'bg-ink/10'}"
				>
					<span class="size-1.5 rounded-full bg-current opacity-70"></span>
					{data.handoff.status === 'received'
						? 'Received — locked'
						: data.handoff.status === 'submitted'
							? 'Waiting for Main HR — locked'
							: data.handoff.status === 'returned'
? 'Returned for correction'
: 'Not sent yet'}
</span>
{#if data.canApprove && (data.handoff.status === 'submitted' || data.handoff.status === 'received')}
<!-- Main HR, opening the establishment's DTR, decides it here instead of going to Approvals. -->
{#if data.handoff.status === 'submitted'}
<form method="POST" action="?/receiveMonth" use:enhance={run} class="contents">
<input type="hidden" name="month" value={data.month} />
<Button type="submit" variant="gold" size="sm" disabled={busy}>Receive DTR</Button>
</form>
{/if}
<Button variant="outline" size="sm" disabled={busy} onclick={() => (returnOpen = true)}>
Return for correction
</Button>
{/if}
			</div>
			{#if data.handoff.status === 'returned' && data.handoff.note}
				<p class="text-sm"><strong class="font-medium">Main HR says:</strong> {data.handoff.note}</p>
			{/if}
			{#if data.locked}
				<p class="text-sm text-ink-muted">
					Records and punches for this month can't be changed until Main HR returns it.
				</p>
			{:else if data.handoff.status === 'draft' || data.handoff.status === 'returned'}
				{#if data.warnings.unapprovedWeeks.length > 0}
					<p class="text-sm text-ink-muted">
						{data.warnings.unapprovedWeeks.length} roster week{data.warnings.unapprovedWeeks.length === 1 ? '' : 's'}
						this month {data.warnings.unapprovedWeeks.length === 1 ? 'is' : 'are'} not approved yet.
					</p>
				{/if}
				{#if data.warnings.missingEmployees.length > 0}
					<p class="text-sm text-ink-muted">
						No saved DTR yet for {data.warnings.missingEmployees.length}:
						{data.warnings.missingEmployees.slice(0, 4).join('; ')}{data.warnings.missingEmployees.length > 4
							? '…'
							: ''}
					</p>
				{/if}
			{/if}
		</div>
{#if !data.canApprove && (data.handoff.status === 'draft' || data.handoff.status === 'returned')}
<form method="POST" action="?/submitMonth" use:enhance={run}>
<input type="hidden" name="month" value={data.month} />
<Button type="submit" variant="gold" disabled={busy}>Send to Main HR</Button>
</form>
{/if}
	</div>
</div>

<div class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[16rem_minmax(0,1fr)_18rem]">
	{#if !data.selected}
		<div class="rounded-xl border border-dashed border-border p-10 text-center lg:col-span-3">
			<p class="text-sm font-medium text-ink">No employee has a Biometric ID yet</p>
			<p class="mt-1 text-sm text-ink-muted">
				Set it under Employees, and upload the biometric file under Biometric data. DTR is worked out
				from the two.
			</p>
		</div>
	{:else}
		<!-- Left: who, when, actions -->
		<aside class="space-y-4">
			<div class="flex flex-col items-center gap-2 text-center">
				<div
					class="flex size-20 items-center justify-center rounded-full border-2 border-primary/60 bg-muted text-xl font-semibold text-ink"
					aria-hidden="true"
				>
					{initials}
				</div>
				<p class="font-medium text-ink">{data.selected.name}</p>
				<p class="font-mono text-xs text-ink-muted">ID {data.selected.enrollId}</p>
				{#if data.selected.position}
					<p class="text-xs text-ink-muted">{data.selected.position}</p>
				{/if}
			</div>

			<div class="rounded-lg border border-border bg-surface p-3">
				<p class="text-center text-xs text-ink-muted">Year &amp; month</p>
				<div class="mt-2 flex items-center justify-between">
					<Button variant="ghost" size="icon" href={href({ month: stepMonth(-12) })} aria-label="Previous year">
						<ChevronLeftIcon class="size-4" />
					</Button>
					<span class="text-lg font-semibold text-ink tabular-nums">{year}</span>
					<Button variant="ghost" size="icon" href={href({ month: stepMonth(12) })} aria-label="Next year">
						<ChevronRightIcon class="size-4" />
					</Button>
				</div>
				<div class="flex items-center justify-between">
					<Button variant="ghost" size="icon" href={href({ month: stepMonth(-1) })} aria-label="Previous month">
						<ChevronLeftIcon class="size-4" />
					</Button>
					<span class="text-sm text-ink">{monthName}</span>
					<Button variant="ghost" size="icon" href={href({ month: stepMonth(1) })} aria-label="Next month">
						<ChevronRightIcon class="size-4" />
					</Button>
				</div>
			</div>

			<div class="grid grid-cols-2 rounded-lg border border-border bg-surface p-0.5" role="group" aria-label="View">
				{#each [['preview', 'Preview'], ['saved', 'Saved']] as const as [value, label] (value)}
					<button
						type="button"
						class="rounded-md py-1.5 text-sm font-medium {mode === value
							? 'bg-primary text-primary-foreground'
							: 'text-ink-muted hover:text-ink'}"
						aria-pressed={mode === value}
						onclick={() => (mode = value)}
					>
						{label}
					</button>
				{/each}
			</div>

			{#if mode === 'preview'}
				<div class="grid gap-2">
					<Button variant="outline" disabled={data.locked} onclick={() => openAdd(`${data.month}-01`)}>
						<PlusIcon class="size-4" /> Add time
					</Button>
					<form method="POST" action="?/save" use:enhance={run} class="contents">
						<input type="hidden" name="month" value={data.month} />
						<input type="hidden" name="employeeId" value={data.selected.id} />
						<Button type="submit" disabled={busy || data.locked}>
							<SaveIcon class="size-4" /> Save record
						</Button>
					</form>
					<form method="POST" action="?/save" use:enhance={run} class="contents">
						<input type="hidden" name="month" value={data.month} />
						<Button type="submit" variant="outline" disabled={busy || data.locked}>
							Save all ({data.unsavedCount} unsaved)
						</Button>
					</form>
				</div>
				<p class="text-xs text-ink-muted">
					Worked out live from the biometric data and the schedule. Nothing is saved until you press
					Save.
				</p>
			{:else}
				<div class="grid gap-2">
					<Button variant="outline" href={printHref} target="_blank" rel="noopener" disabled={data.savedState === 'none'}>
						<PrinterIcon class="size-4" /> Print record
					</Button>
				</div>
			{/if}

			{#if data.savedState === 'none'}
				<Badge variant="outline">Not saved yet</Badge>
			{:else if data.savedState === 'differs'}
				<p class="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs text-ink">
					Preview differs from what is saved (new punches or schedule changes). Save record to update it.
				</p>
			{:else}
				<Badge variant="secondary">Saved · matches preview</Badge>
			{/if}
		</aside>

		<!-- Centre: the days -->
		<!-- Only the day list scrolls; the month title and totals stay put. Height leaves room for the
		     page header and the hand-off strip above, with a floor so a short window still has a list. -->
		<section
			class="flex min-w-0 flex-col gap-3 max-lg:max-h-[75dvh]"
			use:fitToViewport={{ prop: 'height', min: 384 }}
		>
			<div class="flex shrink-0 flex-wrap items-center justify-between gap-2">
				<h2 class="text-base font-semibold text-ink">
					{monthName} {year} · {mode === 'saved' ? 'Saved record' : 'Preview'}
				</h2>
				{#if view}
					<div class="flex flex-wrap gap-1.5 text-xs">
						<Badge variant="outline">{view.totals.scheduledDays} scheduled</Badge>
						<Badge variant="outline">{view.totals.workedDays} days worked</Badge>
						<Badge variant="outline">{view.totals.absentDays} absent</Badge>
						{#if view.totals.unscheduledDays > 0}
							<span title="Absences can only be counted on days that have a shift on the roster.">
								<Badge variant="outline">{view.totals.unscheduledDays} with no schedule</Badge>
							</span>
						{/if}
						<Badge variant="outline">Late {view.totals.lateMinutes ? hm(view.totals.lateMinutes) : '—'}</Badge>
						<Badge variant="outline">
							Undertime {view.totals.undertimeMinutes ? hm(view.totals.undertimeMinutes) : '—'}
						</Badge>
					</div>
				{/if}
			</div>

			{#if mode === 'saved' && data.savedState === 'none'}
				<p class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-ink-muted">
					Nothing is saved for {monthName} {year} yet. Check the Preview, then Save record.
				</p>
			{:else if view}
				<div class="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
				{#each view.days as d (d.date)}
					<article class="overflow-hidden rounded-lg border border-border bg-surface">
						<header class="flex items-center justify-between gap-2 bg-primary/10 px-3 py-2">
							<div class="flex flex-wrap items-center gap-2">
								<h3 class="text-sm font-medium text-ink">{dayTitle(d.date)}</h3>
								{#if d.shift && d.kind !== 'rest'}
									<span class="text-xs text-ink-muted">{d.shift}</span>
								{/if}
								{#if d.kind === 'rest'}<Badge variant="secondary">Day off</Badge>{/if}
								{#if d.kind === 'absent'}<Badge variant="destructive">Absent</Badge>{/if}
								{#if d.kind === 'leave'}<Badge>Leave</Badge>{/if}
								{#if d.kind === 'holiday'}<Badge>Holiday / memo</Badge>{/if}
								{#if d.manual}<Badge variant="outline">Staff-added</Badge>{/if}
							</div>
							{#if mode === 'preview'}
								<Button
									variant="ghost"
									size="icon"
									class="size-7"
									aria-label="Add time on {dayTitle(d.date)}"
									onclick={() => openAdd(d.date)}
								>
									<PlusIcon class="size-4" />
								</Button>
							{/if}
						</header>
						{#if d.kind === 'work'}
							<div class="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-3 sm:grid-cols-4">
								{#each [['In', d.timeIn], ['Break out', d.breakOut], ['Break in', d.breakIn], ['Out', d.timeOut]] as const as [label, c] (label)}
									<div>
										<p class="text-xs font-medium text-ink-muted">{label}</p>
										<p class="text-sm font-medium tabular-nums {c ? 'text-ink' : 'text-ink-muted'}">
											{c?.t12 ?? '—'}
										</p>
									</div>
								{/each}
							</div>
							{#if d.lateMinutes || d.undertimeMinutes || d.remarks}
								<div class="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2 text-xs">
									{#if d.lateMinutes}<Badge variant="outline">Late {hm(d.lateMinutes)}</Badge>{/if}
									{#if d.undertimeMinutes}<Badge variant="outline">Undertime {hm(d.undertimeMinutes)}</Badge>{/if}
									{#if d.remarks}<span class="text-warning">{d.remarks}</span>{/if}
								</div>
							{/if}
						{:else if d.kind === 'rest'}
							<p class="px-3 py-3 text-sm font-medium text-ink-muted">Day off</p>
						{:else if d.kind === 'leave' || d.kind === 'holiday'}
							<p class="px-3 py-3 text-sm text-ink">
								{d.remarks}
								<span class="text-ink-muted">
									· {d.workedMinutes ? `${hm(d.workedMinutes)} credited` : 'unpaid'}
								</span>
							</p>
						{:else if d.kind === 'absent'}
							<p class="px-3 py-3 text-sm text-ink-muted">No punches on a scheduled day.</p>
						{:else}
							<p class="px-3 py-3 text-sm text-ink-muted">
								{d.shift ? 'Nothing recorded yet.' : 'No schedule and no punches.'}
							</p>
						{/if}
					</article>
				{/each}
				</div>
			{/if}
		</section>

		<!-- Right: employees -->
		<aside class="space-y-2">
			<div class="relative">
				<SearchIcon class="absolute top-2.5 left-2.5 size-4 text-ink-muted" />
				<Input bind:value={search} placeholder="Search name or Biometric ID" class="pl-8" aria-label="Search employees" />
			</div>
			<ul use:fitToViewport={{ prop: 'maxHeight', min: 240 }} class="max-h-[75vh] divide-y divide-border overflow-y-auto rounded-lg border border-border bg-surface">
				{#each people as p (p.id)}
					<li>
						<a
							href={href({ employee: p.id })}
							class="block px-3 py-2.5 {sent
								? 'bg-gold hover:bg-gold-deep'
								: 'hover:bg-muted/60'} {data.selected.id === p.id ? (sent ? 'ring-2 ring-inset ring-ink' : 'bg-muted') : ''}"
							aria-current={data.selected.id === p.id ? 'true' : undefined}
						>
							<p class="truncate text-sm font-medium text-ink">{p.name}</p>
							<p class="font-mono text-xs text-ink-muted">{p.enrollId}</p>
							<!-- The hand-off is per establishment and month, so every row carries the same state. -->
							<Badge variant={sent ? 'default' : handoffBadge.variant} class="mt-1">{handoffBadge.label}</Badge>
						</a>
					</li>
				{:else}
					<li class="p-3 text-sm text-ink-muted">No employee matches.</li>
				{/each}
			</ul>
		</aside>
	{/if}
</div>

{#if data.selected}
	<Dialog.Root bind:open={addOpen}>
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Add time · {data.selected.name}</Dialog.Title>
				<Dialog.Description>
					For when they were present but forgot to punch. It is added to their biometric data as a
					staff-added punch, with your reason, and the preview updates.
				</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/addTime" use:enhance={run} class="space-y-3">
				<input type="hidden" name="employeeId" value={data.selected.id} />
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="addDate">Date</Label>
						<Input id="addDate" name="date" type="date" bind:value={addDate} class="mt-1" required />
					</div>
					<div>
						<Label for="addTime">Time</Label>
						<Input id="addTime" name="time" type="time" bind:value={addTime} class="mt-1" required />
					</div>
				</div>
				<div>
					<Label for="addNote">Reason</Label>
					<Input
						id="addNote"
						name="note"
						bind:value={addNote}
						placeholder="e.g. Forgot to punch out; confirmed by supervisor"
						class="mt-1"
						required
					/>
				</div>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (addOpen = false)}>Cancel</Button>
					<Button type="submit" disabled={busy}>Add time</Button>
				</Dialog.Footer>
			</form>
		</Dialog.Content>
	</Dialog.Root>
{/if}

<Dialog.Root bind:open={returnOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title class="font-display text-2xl font-light">Return for correction</Dialog.Title>
			<Dialog.Description>
				{monthName} {year} · the establishment sees your note and can correct the DTR and send it again.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-2">
			<p class="text-sm font-medium">Earlier remarks</p>
			{#if data.returnHistory.length === 0}
				<p class="text-sm text-ink-muted">This month has not been returned before.</p>
			{:else}
				<ul class="max-h-48 space-y-2 overflow-y-auto">
					{#each data.returnHistory as r, i (i)}
						<li class="rounded-2xl bg-ink/5 px-3 py-2 text-sm">
							<p class="whitespace-pre-line">{r.note}</p>
							<p class="mt-0.5 text-xs text-ink-muted tabular-nums">
								{r.by} · {new Date(r.at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
							</p>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
		<form method="POST" action="?/returnMonth" use:enhance={run} class="space-y-3">
			<input type="hidden" name="month" value={data.month} />
			<div class="space-y-1.5">
				<Label for="returnNote">What needs correcting</Label>
				<Textarea id="returnNote" name="note" rows={4} required maxlength={300} placeholder="e.g. Oct 8–10 punches missing for Caimen; please re-import." />
			</div>
			<Dialog.Footer class="gap-2 pt-1">
				<Button type="button" variant="outline" onclick={() => (returnOpen = false)}>Cancel</Button>
				<Button type="submit" disabled={busy}>Return to establishment</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
