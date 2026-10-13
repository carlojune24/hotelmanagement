<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data }: { data: PageData; form: ActionData } = $props();

	let fileOpen = $state(false);
	let busy = $state(false);
	let cancelling = $state<{ id: string; label: string } | null>(null);

	const hours = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
	const selectClass =
		'h-10 w-full rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

	function run() {
		busy = true;
		return async ({
			result,
			update
		}: {
			result: { type: string; data?: unknown };
			update: (o?: { reset?: boolean }) => Promise<void>;
		}) => {
			await update({ reset: result.type === 'success' });
			busy = false;
			const d = result.data as { ok?: string; error?: string } | undefined;
			if (result.type === 'success') {
				fileOpen = false;
				cancelling = null;
				toast.success(d?.ok ?? 'Saved.');
			} else if (result.type === 'failure') toast.error(d?.error ?? 'Could not save.');
		};
	}
</script>

<svelte:head><title>Overtime · HR</title></svelte:head>

<div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h2 class="text-base font-semibold text-ink">Overtime</h2>
			<p class="text-sm text-ink-muted">
				Only approved overtime is credited on the DTR; time worked past the shift without it is
				flagged instead.
			</p>
		</div>
		<div class="flex items-center gap-2">
			<Input
				type="month"
				value={data.month}
				aria-label="Month"
				class="h-9 w-44"
				onchange={(e) => goto(`?month=${(e.currentTarget as HTMLInputElement).value}`)}
			/>
			<Button onclick={() => (fileOpen = true)}>
				<PlusIcon class="size-4" /> {data.canApprove ? 'File overtime' : 'Request overtime'}
			</Button>
		</div>
	</div>

	<div class="mt-4 overflow-hidden rounded-2xl border border-border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Employee</Table.Head>
					<Table.Head>Date</Table.Head>
					<Table.Head>Time</Table.Head>
					<Table.Head class="text-right">Length</Table.Head>
					<Table.Head>Reason</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head class="text-right"><span class="sr-only">Actions</span></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.requests as r (r.id)}
					<Table.Row class={r.status === 'cancelled' || r.status === 'rejected' ? 'text-ink-muted' : ''}>
						<Table.Cell class="font-medium">{r.employeeName}</Table.Cell>
						<Table.Cell class="whitespace-nowrap tabular-nums">{r.date}</Table.Cell>
						<Table.Cell class="whitespace-nowrap tabular-nums">{r.startTime}–{r.endTime}</Table.Cell>
						<Table.Cell class="text-right tabular-nums">{hours(r.minutes)}</Table.Cell>
						<Table.Cell class="text-ink-muted">{r.reason || '—'}</Table.Cell>
						<Table.Cell>
							<Badge variant={r.status === 'approved' ? 'ok' : r.status === 'submitted' ? 'gold' : 'muted'}>
								{r.status === 'approved'
									? 'Approved'
									: r.status === 'submitted'
										? 'Waiting'
										: r.status === 'rejected'
											? 'Rejected'
											: 'Cancelled'}
							</Badge>
							{#if r.status === 'rejected' && r.decisionNote}
								<p class="mt-1 text-xs text-ink-muted">{r.decisionNote}</p>
							{/if}
						</Table.Cell>
						<Table.Cell class="text-right">
							{#if r.status === 'submitted' || (r.status === 'approved' && data.canApprove)}
								<Button
									variant="ghost"
									size="sm"
									onclick={() => (cancelling = { id: r.id, label: `${r.employeeName} · ${r.date} ${r.startTime}–${r.endTime}` })}
								>
									{r.status === 'submitted' ? 'Withdraw' : 'Cancel'}
								</Button>
							{/if}
						</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={7} class="py-10 text-center text-sm text-ink-muted">
							No overtime filed for {data.month}.
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>

<Dialog.Root bind:open={fileOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{data.canApprove ? 'File overtime' : 'Request overtime'}</Dialog.Title>
			<Dialog.Description>
				{data.canApprove
					? 'Filed and approved in one step.'
					: 'Main HR reviews it. It is only credited once approved.'}
			</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/file" use:enhance={run} class="space-y-3">
			<div class="space-y-1.5">
				<Label for="otEmployee">Employee</Label>
				<select id="otEmployee" name="employeeId" class={selectClass} required>
					<option value="" disabled selected>Choose…</option>
					{#each data.employees as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
				</select>
			</div>
			<div class="grid grid-cols-3 gap-3">
				<div class="space-y-1.5">
					<Label for="otDate">Shift date</Label>
					<Input id="otDate" name="date" type="date" value={data.today} required />
				</div>
				<div class="space-y-1.5">
					<Label for="otStart">From</Label>
					<Input id="otStart" name="startTime" type="time" required />
				</div>
				<div class="space-y-1.5">
					<Label for="otEnd">To</Label>
					<Input id="otEnd" name="endTime" type="time" required />
				</div>
			</div>
			<div class="space-y-1.5">
				<Label for="otReason">Reason</Label>
				<Input id="otReason" name="reason" maxlength={200} placeholder="e.g. Banquet ran late" />
			</div>
			<Dialog.Footer class="gap-2 pt-1">
				<Button type="button" variant="outline" onclick={() => (fileOpen = false)}>Close</Button>
				<Button type="submit" disabled={busy}>{data.canApprove ? 'File' : 'Send for approval'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={cancelling !== null} onOpenChange={(o) => !o && (cancelling = null)}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Cancel this overtime?</Dialog.Title>
			<Dialog.Description>{cancelling?.label}</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/cancel" use:enhance={run} class="space-y-3">
			<input type="hidden" name="id" value={cancelling?.id ?? ''} />
			<Input name="note" placeholder="Note (optional)" maxlength={300} aria-label="Note" />
			<Dialog.Footer class="gap-2">
				<Button type="button" variant="outline" onclick={() => (cancelling = null)}>Keep it</Button>
				<Button type="submit" variant="destructive" disabled={busy}>Cancel overtime</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
