<script lang="ts">
	import { page } from '$app/state';
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
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let createOpen = $state(false);
	let isRestDay = $state(false);
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
			isRestDay = false;
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
	function fmtTime(t: string) {
		const [h, m] = t.split(':');
		return new Date(2000, 0, 1, Number(h), Number(m)).toLocaleTimeString(undefined, {
			hour: 'numeric',
			minute: '2-digit'
		});
	}
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
	<div class="flex items-center justify-between gap-4">
		<div>
			<h2 class="text-base font-semibold text-ink">Schedule</h2>
			<p class="text-sm text-ink-muted">
				{fmt(data.weekStart)} – {fmt(data.weekEnd)}
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
				<PlusIcon class="size-4" /> Add shift
			</Button>
		</div>
	</div>

	<div class="mt-4 overflow-hidden rounded-xl border border-border">
		{#if data.entries.length === 0}
			<div class="flex flex-col items-center gap-2 p-10 text-center">
				<CalendarDaysIcon class="size-6 text-ink-muted" />
				<p class="text-sm text-ink-muted">No shifts scheduled this week.</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Employee</Table.Head>
						<Table.Head>Date</Table.Head>
						<Table.Head>Shift</Table.Head>
						<Table.Head class="text-right">Remove</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.entries as e (e.id)}
						<Table.Row>
							<Table.Cell class="font-medium text-ink">{e.employeeName} {e.employeeLastName}</Table.Cell>
							<Table.Cell class="text-ink-muted">{fmt(e.date)}</Table.Cell>
							<Table.Cell>
								{#if e.isRestDay}
									<Badge variant="outline">Rest day</Badge>
								{:else}
									<span class="text-ink">
										{e.startTime ? fmtTime(e.startTime) : '—'} – {e.endTime ? fmtTime(e.endTime) : '—'}
									</span>
									{#if e.breakMinutes > 0}
										<span class="text-ink-muted">({e.breakMinutes}m break)</span>
									{/if}
								{/if}
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
		{/if}
	</div>
</div>

<Dialog.Root bind:open={createOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Add a shift</Dialog.Title>
		</Dialog.Header>
		<form id="createScheduleForm" method="POST" action="?/save" use:enhance class="space-y-3">
			<div>
				<Label for="scheduleEmployee">Employee</Label>
				<Select.Root type="single" name="employeeId" bind:value={selectedEmployeeId}>
					<Select.Trigger id="scheduleEmployee" class="mt-1 w-full">{selectedEmployeeLabel}</Select.Trigger>
					<Select.Content>
						{#each data.employees as emp (emp.id)}
							<Select.Item value={emp.id} label="{emp.firstName} {emp.lastName}" />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div>
				<Label for="scheduleDate">Date</Label>
				<Input id="scheduleDate" name="date" type="date" required class="mt-1" />
			</div>
			<label class="flex items-center gap-2 text-sm text-ink">
				<input type="checkbox" name="isRestDay" bind:checked={isRestDay} class="size-4" />
				Rest day
			</label>
			{#if !isRestDay}
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="scheduleStart">Start time</Label>
						<Input id="scheduleStart" name="startTime" type="time" class="mt-1" />
					</div>
					<div>
						<Label for="scheduleEnd">End time</Label>
						<Input id="scheduleEnd" name="endTime" type="time" class="mt-1" />
					</div>
				</div>
				<div>
					<Label for="scheduleBreak">Break (minutes)</Label>
					<Input id="scheduleBreak" name="breakMinutes" type="number" min="0" value="0" class="mt-1" />
				</div>
			{/if}
		</form>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (createOpen = false)}>Cancel</Button>
			<Button type="submit" form="createScheduleForm">Save</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
