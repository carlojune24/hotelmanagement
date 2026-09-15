<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let createOpen = $state(false);
	let selectedEmployeeId = $state('');
	const selectedEmployeeLabel = $derived(
		data.employees.find((e) => e.id === selectedEmployeeId)
			? `${data.employees.find((e) => e.id === selectedEmployeeId)!.firstName} ${data.employees.find((e) => e.id === selectedEmployeeId)!.lastName}`
			: 'Select an employee'
	);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) {
			toast.success(form.ok);
			createOpen = false;
			selectedEmployeeId = '';
		}
	});

	function shiftWeek(deltaDays: number) {
		const d = new Date(`${data.weekStart}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() + deltaDays);
		goto(`?week=${d.toISOString().slice(0, 10)}`);
	}

	function fmt(d: string) {
		return new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
	function fmtTime(t: string | Date | null) {
		if (!t) return '—';
		return new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}
	function hm(minutes: number) {
		if (minutes === 0) return '—';
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
	}
</script>

<div class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
	<div class="flex items-center justify-between gap-4">
		<div>
			<h2 class="text-base font-semibold text-ink">Daily Time Record</h2>
			<p class="text-sm text-ink-muted">
				{fmt(data.weekStart)} – {fmt(data.weekEnd)} · Manual entries and corrections. Biometric
				import is a separate, not-yet-built path.
			</p>
		</div>
		<div class="flex items-center gap-2">
			<Button variant="outline" size="icon" onclick={() => shiftWeek(-7)} aria-label="Previous week">
				<ChevronLeftIcon class="size-4" />
			</Button>
			<Button variant="outline" size="icon" onclick={() => shiftWeek(7)} aria-label="Next week">
				<ChevronRightIcon class="size-4" />
			</Button>
			<Button onclick={() => (createOpen = true)}>
				<PlusIcon class="size-4" /> Add entry
			</Button>
		</div>
	</div>

	<div class="mt-4 overflow-hidden rounded-xl border border-border">
		{#if data.entries.length === 0}
			<div class="flex flex-col items-center gap-2 p-10 text-center">
				<ClockIcon class="size-6 text-ink-muted" />
				<p class="text-sm text-ink-muted">No DTR entries this week.</p>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Employee</Table.Head>
							<Table.Head>Date</Table.Head>
							<Table.Head>Time in/out</Table.Head>
							<Table.Head class="text-right">Worked</Table.Head>
							<Table.Head class="text-right">OT</Table.Head>
							<Table.Head class="text-right">Night diff</Table.Head>
							<Table.Head class="text-right">Tardy</Table.Head>
							<Table.Head>Source</Table.Head>
							<Table.Head class="text-right">Remove</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.entries as e (e.id)}
							<Table.Row>
								<Table.Cell class="font-medium text-ink">{e.employeeName} {e.employeeLastName}</Table.Cell>
								<Table.Cell class="text-ink-muted">{fmt(e.date)}</Table.Cell>
								<Table.Cell class="text-ink-muted">
									{#if e.isAbsent}
										<Badge variant="destructive">Absent</Badge>
									{:else}
										{fmtTime(e.timeIn)} – {fmtTime(e.timeOut)}
									{/if}
								</Table.Cell>
								<Table.Cell class="text-right text-ink">{hm(e.workedMinutes)}</Table.Cell>
								<Table.Cell class="text-right text-ink">{hm(e.otMinutes)}</Table.Cell>
								<Table.Cell class="text-right text-ink">{hm(e.nightDiffMinutes)}</Table.Cell>
								<Table.Cell class="text-right text-ink">{hm(e.tardinessMinutes)}</Table.Cell>
								<Table.Cell>
									<Badge variant="outline" class="capitalize">{e.source}</Badge>
								</Table.Cell>
								<Table.Cell class="text-right">
									<form method="POST" action="?/delete" use:enhance>
										<input type="hidden" name="id" value={e.id} />
										<button class="text-xs text-danger hover:underline">Remove</button>
									</form>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{/if}
	</div>
</div>

<Dialog.Root bind:open={createOpen}>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Add / correct a DTR entry</Dialog.Title>
			<Dialog.Description>Saving replaces any existing entry for this employee and date.</Dialog.Description>
		</Dialog.Header>
		<form id="createDtrForm" method="POST" action="?/save" use:enhance class="space-y-3">
			<div>
				<Label for="dtrEmployee">Employee</Label>
				<Select.Root type="single" name="employeeId" bind:value={selectedEmployeeId}>
					<Select.Trigger id="dtrEmployee" class="mt-1 w-full">{selectedEmployeeLabel}</Select.Trigger>
					<Select.Content>
						{#each data.employees as emp (emp.id)}
							<Select.Item value={emp.id} label="{emp.firstName} {emp.lastName}" />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div>
				<Label for="dtrDate">Date</Label>
				<Input id="dtrDate" name="date" type="date" required class="mt-1" />
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="dtrTimeIn">Time in</Label>
					<Input id="dtrTimeIn" name="timeIn" type="time" class="mt-1" />
				</div>
				<div>
					<Label for="dtrTimeOut">Time out</Label>
					<Input id="dtrTimeOut" name="timeOut" type="time" class="mt-1" />
				</div>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="dtrWorked">Worked (minutes)</Label>
					<Input id="dtrWorked" name="workedMinutes" type="number" min="0" value="0" class="mt-1" />
				</div>
				<div>
					<Label for="dtrOt">Overtime (minutes)</Label>
					<Input id="dtrOt" name="otMinutes" type="number" min="0" value="0" class="mt-1" />
				</div>
				<div>
					<Label for="dtrNightDiff">Night diff (minutes)</Label>
					<Input id="dtrNightDiff" name="nightDiffMinutes" type="number" min="0" value="0" class="mt-1" />
				</div>
				<div>
					<Label for="dtrTardiness">Tardiness (minutes)</Label>
					<Input id="dtrTardiness" name="tardinessMinutes" type="number" min="0" value="0" class="mt-1" />
				</div>
				<div>
					<Label for="dtrUndertime">Undertime (minutes)</Label>
					<Input id="dtrUndertime" name="undertimeMinutes" type="number" min="0" value="0" class="mt-1" />
				</div>
			</div>
			<label class="flex items-center gap-2 text-sm text-ink">
				<input type="checkbox" name="isAbsent" class="size-4" />
				Absent
			</label>
			<div>
				<Label for="dtrNote">Correction note (optional)</Label>
				<Input id="dtrNote" name="correctionNote" class="mt-1" />
			</div>
		</form>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (createOpen = false)}>Cancel</Button>
			<Button type="submit" form="createDtrForm">Save</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
