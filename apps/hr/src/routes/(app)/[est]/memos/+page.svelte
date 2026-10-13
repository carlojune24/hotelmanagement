<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { CALENDAR_KIND_LABEL, type CALENDAR_KINDS } from '$lib/leave';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let open = $state(false);
	let busy = $state(false);

	const STATUS = {
		submitted: { label: 'Waiting for Main HR', variant: 'gold' },
		approved: { label: 'Approved', variant: 'ok' },
		rejected: { label: 'Rejected', variant: 'destructive' }
	} as const;

	const day = (iso: string) =>
		new Intl.DateTimeFormat('en-PH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
			new Date(`${iso}T00:00:00Z`)
		);

	$effect(() => {
		if (form && 'error' in form && form.error) toast.error(form.error);
		else if (form && 'ok' in form && form.ok) {
			toast.success(form.ok);
			open = false;
		}
	});

	function submit() {
		busy = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: true });
			busy = false;
		};
	}
</script>

<svelte:head><title>Memos · {page.params.est} · HR</title></svelte:head>

<div class="space-y-5 px-5 py-5 md:px-6">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="max-w-2xl">
			<h2 class="text-2xl font-light">Memos</h2>
			<p class="mt-1 text-sm text-ink-muted">
				A memo or local holiday you send to Main HR. Nothing changes on the roster or the DTR until Main HR
				approves it; once approved, everyone scheduled that day is credited.
			</p>
		</div>
		{#if data.canPropose}
			<Button variant="gold" onclick={() => (open = true)}><PlusIcon /> New memo</Button>
		{:else}
			<Button variant="outline" href="/{page.params.est}/settings/leave">Add one in Leave rules &amp; holidays</Button>
		{/if}
	</div>

	{#if data.proposals.length === 0}
		<div class="hatch rounded-2xl px-6 py-12 text-center">
			<p class="text-lg">No memos sent yet</p>
			<p class="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
				When you send one it shows here with Main HR's decision.
			</p>
		</div>
	{:else}
		<ul class="divide-y divide-dotted divide-ink/20">
			{#each data.proposals as m (m.id)}
				<li class="space-y-1 py-4">
					<div class="flex flex-wrap items-center gap-2">
						<p class="font-medium">{m.name}</p>
						<Badge variant={STATUS[m.status].variant}>{STATUS[m.status].label}</Badge>
					</div>
					<p class="text-sm text-ink-muted tabular-nums">
						{day(m.date)} · {CALENDAR_KIND_LABEL[m.kind as (typeof CALENDAR_KINDS)[number]] ?? m.kind}{m.creditMinutes !== null
							? ` · ${m.creditMinutes / 60} h credited`
							: ' · full day credited'}{m.waiveLateness ? ' · lateness waived' : ''}
					</p>
					{#if m.note}<p class="max-w-2xl text-sm whitespace-pre-line">{m.note}</p>{/if}
					<p class="text-xs text-ink-muted tabular-nums">
						{#if m.sentOn}Sent {m.sentOn}{/if}{#if m.decidedOn} · decided {m.decidedOn}{/if}
					</p>
					{#if m.status === 'rejected' && m.decisionNote}
						<p class="text-sm text-danger">Main HR: {m.decisionNote}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title class="font-display text-2xl font-light">New memo</Dialog.Title>
			<Dialog.Description>
				Main HR reviews it from their Approvals. Say what it is for so they can decide quickly.
			</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/proposeMemo" use:enhance={submit} class="space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-1.5">
					<Label for="memoDate">Date</Label>
					<Input id="memoDate" name="date" type="date" required min={data.today} />
				</div>
				<div class="space-y-1.5">
					<Label for="memoKind">Type</Label>
					<select
						id="memoKind"
						name="kind"
						class="h-10 w-full rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
					>
						<option value="memo">Memo (staff go early / credited time)</option>
						<option value="local_holiday">Local holiday</option>
					</select>
				</div>
			</div>
			<div class="space-y-1.5">
				<Label for="memoName">Title</Label>
				<Input id="memoName" name="name" required maxlength={80} placeholder="e.g. Fiesta — early release" />
			</div>
			<div class="space-y-1.5">
				<Label for="memoNote">Details <span class="text-ink-muted">(optional)</span></Label>
				<Textarea id="memoNote" name="note" rows={4} maxlength={1000} placeholder="Who it covers and why." />
			</div>
			<div class="space-y-1.5">
				<Label for="memoCredit">Hours credited <span class="text-ink-muted">(blank = full day)</span></Label>
				<Input id="memoCredit" name="creditHours" type="number" min="0" max="24" step="0.25" />
			</div>
			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" name="waiveLateness" class="size-4 accent-black" />
				Don't count lateness or undertime that day
			</label>
			<Dialog.Footer class="gap-2 pt-1">
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={busy}>Send to Main HR</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
