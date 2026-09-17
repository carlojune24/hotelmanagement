<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import BanknoteIcon from '@lucide/svelte/icons/banknote';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const base = $derived(`/${page.params.hotel}/management`);

	let createOpen = $state(false);

	$effect(() => {
		if (form?.error) toast.error(form.error);
	});

	function fmt(d: string) {
		return new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	}

	const STATUS_VARIANT: Record<string, 'default' | 'outline' | 'secondary'> = {
		draft: 'outline',
		locked: 'secondary',
		posted: 'default'
	};
</script>

<div class="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
	<div class="flex items-center justify-between gap-4">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Payroll</h1>
			<p class="text-sm text-ink-muted">
				Payroll runs for this hotel. Statutory computation (SSS/PhilHealth/Pag-IBIG/BIR) isn't
				implemented yet — see docs/standards/hr.md — so a run's lines can't be generated until
				then.
			</p>
		</div>
		<Button onclick={() => (createOpen = true)}>
			<PlusIcon class="size-4" /> New run
		</Button>
	</div>

	<div class="mt-4 overflow-hidden rounded-xl border border-border">
		{#if data.runs.length === 0}
			<div class="flex flex-col items-center gap-2 p-10 text-center">
				<BanknoteIcon class="size-6 text-ink-muted" />
				<p class="text-sm text-ink-muted">No payroll runs yet.</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Cutoff</Table.Head>
						<Table.Head>Pay date</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="text-right">Open</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.runs as run (run.id)}
						<Table.Row>
							<Table.Cell class="text-ink">{fmt(run.cutoffStart)} – {fmt(run.cutoffEnd)}</Table.Cell>
							<Table.Cell class="text-ink-muted">{fmt(run.payDate)}</Table.Cell>
							<Table.Cell>
								<Badge variant={STATUS_VARIANT[run.status] ?? 'outline'} class="capitalize">
									{run.status}
								</Badge>
							</Table.Cell>
							<Table.Cell class="text-right">
								<Button variant="ghost" size="sm" href="{base}/payroll/{run.id}">View →</Button>
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
			<Dialog.Title>New payroll run</Dialog.Title>
		</Dialog.Header>
		<form id="createRunForm" method="POST" action="?/create" use:enhance class="space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="cutoffStart">Cutoff start</Label>
					<Input id="cutoffStart" name="cutoffStart" type="date" required class="mt-1" />
				</div>
				<div>
					<Label for="cutoffEnd">Cutoff end</Label>
					<Input id="cutoffEnd" name="cutoffEnd" type="date" required class="mt-1" />
				</div>
			</div>
			<div>
				<Label for="payDate">Pay date</Label>
				<Input id="payDate" name="payDate" type="date" required class="mt-1" />
			</div>
		</form>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (createOpen = false)}>Cancel</Button>
			<Button type="submit" form="createRunForm">Create</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
