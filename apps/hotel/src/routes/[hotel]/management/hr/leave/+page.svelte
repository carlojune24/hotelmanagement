<script lang="ts">
	import { deserialize, enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let fileOpen = $state(false);
	let busy = $state(false);
	let employeeId = $state('');
	let leaveTypeId = $state('');
	let startDate = $state('');
	let endDate = $state('');
	let halfDay = $state<'' | 'am' | 'pm'>('');
	let reason = $state('');
	let documentNote = $state('');
	let statusFilter = $state<'all' | 'approved' | 'cancelled'>('approved');
	let cancelling = $state<{ id: string; label: string } | null>(null);

	type Preview = {
		days: number;
		capped: boolean;
		remaining: number;
		after: number;
		paid: boolean;
		requiresDocument: boolean;
	};
	let preview = $state<Preview | null>(null);
	let previewError = $state<string | null>(null);

	const selectedType = $derived(data.types.find((t) => t.id === leaveTypeId));
	const employeeLabel = $derived(data.employees.find((e) => e.id === employeeId)?.name ?? 'Choose employee');
	const typeLabel = $derived(selectedType ? `${selectedType.name} (${selectedType.code})` : 'Choose leave');
	const rows = $derived(
		statusFilter === 'all' ? data.requests : data.requests.filter((r) => r.status === statusFilter)
	);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		else if (form?.ok) {
			toast.success(form.ok);
			fileOpen = false;
			cancelling = null;
		}
	});

	// Live "how many days / what is left" as the form is filled in.
	let previewSeq = 0;
	$effect(() => {
		const body = new FormData();
		body.set('employeeId', employeeId);
		body.set('leaveTypeId', leaveTypeId);
		body.set('startDate', startDate);
		body.set('endDate', endDate || startDate);
		body.set('halfDay', halfDay);
		if (!fileOpen || !employeeId || !leaveTypeId || !startDate) {
			preview = null;
			previewError = null;
			return;
		}
		const seq = ++previewSeq;
		fetch('?/preview', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } })
			.then(async (res) => deserialize(await res.text()))
			.then((result) => {
				if (seq !== previewSeq || result.type !== 'success') return;
				preview = (result.data?.preview as Preview | null) ?? null;
				previewError = (result.data?.previewError as string | null) ?? null;
			})
			.catch(() => {});
	});

	function openFile() {
		employeeId = '';
		leaveTypeId = '';
		startDate = '';
		endDate = '';
		halfDay = '';
		reason = '';
		documentNote = '';
		preview = null;
		previewError = null;
		fileOpen = true;
	}

	const run: SubmitFunction = () => {
		busy = true;
		return async ({ update }) => {
			busy = false;
			await update({ reset: false });
		};
	};

	const fmt = (d: string) =>
		new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			timeZone: 'UTC'
		});
	const range = (r: { startDate: string; endDate: string; halfDay: string | null }) =>
		r.startDate === r.endDate
			? `${fmt(r.startDate)}${r.halfDay ? ` (${r.halfDay.toUpperCase()})` : ''}`
			: `${fmt(r.startDate)} – ${fmt(r.endDate)}`;
	const dayWord = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
</script>

<div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h2 class="text-base font-semibold text-ink">Leave requests</h2>
			<p class="text-sm text-ink-muted">
				Filed leave covers the employee's schedule and shows on the roster and DTR.
			</p>
		</div>
		<div class="flex items-center gap-2">
			<Button variant="outline" size="icon" href="?year={data.year - 1}" aria-label="Previous year">
				<ChevronLeftIcon class="size-4" />
			</Button>
			<span class="w-12 text-center text-sm font-medium tabular-nums">{data.year}</span>
			<Button variant="outline" size="icon" href="?year={data.year + 1}" aria-label="Next year">
				<ChevronRightIcon class="size-4" />
			</Button>
			<Button onclick={openFile}><PlusIcon class="size-4" /> File leave</Button>
		</div>
	</div>

	<div class="mt-4 flex gap-1.5" role="group" aria-label="Status">
		{#each [['approved', 'Active'], ['cancelled', 'Cancelled'], ['all', 'All']] as const as [v, label] (v)}
			<Button
				variant={statusFilter === v ? 'default' : 'outline'}
				size="sm"
				onclick={() => (statusFilter = v)}
				aria-pressed={statusFilter === v}>{label}</Button
			>
		{/each}
	</div>

	<div class="mt-3 overflow-x-auto rounded-lg border border-border bg-surface">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Employee</Table.Head>
					<Table.Head>Leave</Table.Head>
					<Table.Head>Dates</Table.Head>
					<Table.Head class="text-right">Days</Table.Head>
					<Table.Head>Pay</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head class="w-24"></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each rows as r (r.id)}
					<Table.Row class={r.status === 'cancelled' ? 'text-ink-muted' : ''}>
						<Table.Cell class="font-medium">{r.employeeName}</Table.Cell>
						<Table.Cell>
							<span class="font-mono text-xs">{r.code}</span>
							<span class="ml-1">{r.typeName}</span>
							{#if r.reason}<p class="text-xs text-ink-muted">{r.reason}</p>{/if}
						</Table.Cell>
						<Table.Cell class="whitespace-nowrap">{range(r)}</Table.Cell>
						<Table.Cell class="text-right tabular-nums">{r.days}</Table.Cell>
						<Table.Cell>{r.paid ? 'Paid' : 'Unpaid'}</Table.Cell>
						<Table.Cell>
							<Badge variant={r.status === 'approved' ? 'secondary' : 'outline'}>
								{r.status === 'approved' ? 'Approved' : 'Cancelled'}
							</Badge>
						</Table.Cell>
						<Table.Cell class="text-right">
							{#if r.status === 'approved'}
								<Button
									variant="ghost"
									size="sm"
									onclick={() => (cancelling = { id: r.id, label: `${r.employeeName} · ${r.code} ${range(r)}` })}
								>
									Cancel
								</Button>
							{/if}
						</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={7} class="py-10 text-center text-sm text-ink-muted">
							No leave on file for {data.year}.
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>

<Dialog.Root bind:open={fileOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>File leave</Dialog.Title>
			<Dialog.Description>
				Approved on filing. The days are counted from the employee's schedule, and the leave then
				covers them on the roster and DTR.
			</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/file" use:enhance={run} class="space-y-3">
			<input type="hidden" name="employeeId" value={employeeId} />
			<input type="hidden" name="leaveTypeId" value={leaveTypeId} />
			<input type="hidden" name="halfDay" value={halfDay} />
			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<Label for="lvEmp">Employee</Label>
					<Select.Root type="single" bind:value={employeeId}>
						<Select.Trigger id="lvEmp" class="mt-1 w-full">{employeeLabel}</Select.Trigger>
						<Select.Content>
							{#each data.employees as e (e.id)}
								<Select.Item value={e.id} label={e.name} />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div>
					<Label for="lvType">Leave</Label>
					<Select.Root type="single" bind:value={leaveTypeId}>
						<Select.Trigger id="lvType" class="mt-1 w-full">{typeLabel}</Select.Trigger>
						<Select.Content>
							{#each data.types as t (t.id)}
								<Select.Item value={t.id} label="{t.name} ({t.code})" />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>
			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<Label for="lvStart">First day</Label>
					<Input id="lvStart" name="startDate" type="date" bind:value={startDate} class="mt-1" required />
				</div>
				<div>
					<Label for="lvEnd">Last day</Label>
					<Input id="lvEnd" name="endDate" type="date" bind:value={endDate} min={startDate} class="mt-1" />
				</div>
			</div>
			{#if selectedType?.halfDayAllowed && (!endDate || endDate === startDate)}
				<div class="flex gap-1.5" role="group" aria-label="Part of the day">
					{#each [['', 'Whole day'], ['am', 'Morning only'], ['pm', 'Afternoon only']] as const as [v, label] (v)}
						<Button
							type="button"
							size="sm"
							variant={halfDay === v ? 'default' : 'outline'}
							onclick={() => (halfDay = v)}
							aria-pressed={halfDay === v}>{label}</Button
						>
					{/each}
				</div>
			{/if}
			<div>
				<Label for="lvReason">Reason</Label>
				<Input id="lvReason" name="reason" bind:value={reason} class="mt-1" />
			</div>
			{#if selectedType?.requiresDocument}
				<div>
					<Label for="lvDoc">Supporting document</Label>
					<Input
						id="lvDoc"
						name="documentNote"
						bind:value={documentNote}
						placeholder="e.g. Medical certificate received"
						class="mt-1"
					/>
				</div>
			{/if}

			<p class="min-h-5 text-sm" aria-live="polite">
				{#if previewError}
					<span class="text-danger">{previewError}</span>
				{:else if preview}
					<span class="font-medium text-ink">{dayWord(preview.days)}</span>
					<span class="text-ink-muted">
						· {preview.paid ? 'paid' : 'unpaid'}
						{#if preview.capped}
							· {preview.remaining} left this year → {preview.after} after
						{/if}
					</span>
				{/if}
			</p>

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (fileOpen = false)}>Cancel</Button>
				<Button type="submit" disabled={busy || !!previewError || !preview}>File leave</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={cancelling !== null} onOpenChange={(o) => !o && (cancelling = null)}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Cancel this leave?</Dialog.Title>
			<Dialog.Description>
				{cancelling?.label}. The days go back to the employee's balance and the schedule and DTR show
				them as normal working days again.
			</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/cancel" use:enhance={run} class="space-y-3">
			<input type="hidden" name="id" value={cancelling?.id ?? ''} />
			<div>
				<Label for="cxNote">Reason (optional)</Label>
				<Input id="cxNote" name="note" class="mt-1" />
			</div>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (cancelling = null)}>Keep it</Button>
				<Button type="submit" variant="destructive" disabled={busy}>Cancel leave</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
