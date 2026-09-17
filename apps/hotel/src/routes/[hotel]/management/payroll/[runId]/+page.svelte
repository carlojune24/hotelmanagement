<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import BanknoteIcon from '@lucide/svelte/icons/banknote';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const base = $derived(`/${page.params.hotel}/management`);
	const peso = (centavos: number) => `₱${(centavos / 100).toFixed(2)}`;

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});

	function fmt(d: string) {
		return new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	}
</script>

<div class="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">
				Payroll run — {fmt(data.run.cutoffStart)} to {fmt(data.run.cutoffEnd)}
			</h1>
			<p class="text-sm text-ink-muted">
				Pay date {fmt(data.run.payDate)} ·
				<Badge variant="outline" class="ml-1 capitalize">{data.run.status}</Badge>
			</p>
		</div>
		<Button variant="outline" href="{base}/payroll">← Payroll</Button>
	</div>

	<div class="flex items-center justify-between gap-4">
		<h2 class="text-base font-semibold text-ink">Lines</h2>
		<form method="POST" action="?/generateLines" use:enhance>
			<Button type="submit" variant="outline">Generate lines</Button>
		</form>
	</div>

	<div class="mt-4 overflow-hidden rounded-xl border border-border">
		{#if data.lines.length === 0}
			<div class="flex flex-col items-center gap-2 p-10 text-center">
				<BanknoteIcon class="size-6 text-ink-muted" />
				<p class="text-sm text-ink-muted">
					No lines yet — computation is not implemented, so "Generate lines" will show why.
				</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Employee</Table.Head>
						<Table.Head class="text-right">Days</Table.Head>
						<Table.Head class="text-right">Gross</Table.Head>
						<Table.Head class="text-right">Net pay</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.lines as line (line.id)}
						<Table.Row>
							<Table.Cell class="font-medium text-ink">{line.employeeName} {line.employeeLastName}</Table.Cell>
							<Table.Cell class="text-right text-ink-muted">{line.daysWorked}</Table.Cell>
							<Table.Cell class="text-right text-ink">{peso(line.grossCentavos)}</Table.Cell>
							<Table.Cell class="text-right text-ink">{peso(line.netPayCentavos)}</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>
</div>
