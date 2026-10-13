<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let target = $state<{ employeeId: string; name: string; typeId: string; typeName: string } | null>(null);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		else if (form?.ok) {
			toast.success(form.ok);
			target = null;
		}
	});
</script>

<div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h2 class="text-base font-semibold text-ink">Leave balances</h2>
			<p class="text-sm text-ink-muted">
				Remaining = yearly allowance + carried over + adjustments − approved days. Click a balance to
				adjust it.
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
		</div>
	</div>

	<div class="mt-4 overflow-x-auto rounded-lg border border-border bg-surface">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Employee</Table.Head>
					{#each data.types as t (t.id)}
						<Table.Head class="text-right" title={t.name}>{t.code}</Table.Head>
					{/each}
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.rows as r (r.employeeId)}
					<Table.Row>
						<Table.Cell class="font-medium whitespace-nowrap">{r.name}</Table.Cell>
						{#each r.lines as l, i (l.typeId)}
							{@const t = data.types[i]!}
							<Table.Cell class="text-right tabular-nums">
								<button
									type="button"
									class="rounded px-1.5 py-0.5 hover:bg-muted"
									title="{t.name}: {l.entitled} allowed, {l.carried} carried, {l.adjusted} adjusted, {l.used} used"
									onclick={() =>
										(target = { employeeId: r.employeeId, name: r.name, typeId: t.id, typeName: t.name })}
								>
									{#if t.daysPerYear > 0}
										<span class="font-medium text-ink">{l.remaining}</span>
										<span class="text-xs text-ink-muted">/ {l.entitled + l.carried + l.adjusted}</span>
									{:else}
										<span class="text-ink-muted">{l.used} used</span>
									{/if}
								</button>
							</Table.Cell>
						{/each}
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={data.types.length + 1} class="py-10 text-center text-sm text-ink-muted">
							No active employees.
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
	{#if data.types.length === 0}
		<p class="mt-3 text-sm text-ink-muted">
			No leave types are switched on. Turn them on under Settings → Leave &amp; holidays.
		</p>
	{/if}
</div>

<Dialog.Root open={target !== null} onOpenChange={(o) => !o && (target = null)}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Adjust {target?.typeName} · {data.year}</Dialog.Title>
			<Dialog.Description>
				{target?.name}. Use a positive number to add days (opening balance) and a negative one to take
				days off (cash conversion, correction).
			</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/adjust" use:enhance class="space-y-3">
			<input type="hidden" name="employeeId" value={target?.employeeId ?? ''} />
			<input type="hidden" name="leaveTypeId" value={target?.typeId ?? ''} />
			<input type="hidden" name="year" value={data.year} />
			<div>
				<Label for="adjDays">Days</Label>
				<Input id="adjDays" name="days" type="number" step="0.5" class="mt-1" required />
			</div>
			<div>
				<Label for="adjReason">Reason</Label>
				<Input id="adjReason" name="reason" placeholder="e.g. Opening balance; converted to cash" class="mt-1" required />
			</div>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (target = null)}>Cancel</Button>
				<Button type="submit">Save adjustment</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
