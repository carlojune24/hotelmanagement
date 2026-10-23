<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
import * as Table from '$lib/components/ui/table/index.js';
		import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
const base = $derived(`/${page.params.est}`);

	type LeaveType = PageData['types'][number];

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
			<h1 class="text-xl font-semibold tracking-tight text-ink">Leave types</h1>
			<p class="text-sm text-ink-muted">
				The rules leave is filed under.
				{#if data.canEdit}
					Changing a rule affects new requests only; leave already approved keeps what it was filed with.
				{:else}
					<strong class="font-medium text-ink">View only</strong> — Main HR sets these for your establishment.
				{/if}
				Holidays and memos are set by Main HR for the whole company and show on your roster and DTR automatically.
			</p>
		</div>
		<Button variant="outline" href="{base}/settings">← Settings</Button>
	</div>

		<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
			<p class="text-sm text-ink-muted">
Leave types are set once by Main HR for the whole company and used by every establishment.
Statutory leaves follow Philippine law as commonly summarised.
			</p>
{#if data.canEditTypes}
<Button variant="outline" size="sm" href="/settings?tab=leave">Change leave types in Settings</Button>
{/if}
		</div>
		<div class="overflow-x-auto rounded-lg border border-border bg-surface">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Leave</Table.Head>
						<Table.Head>Rule</Table.Head>
						<Table.Head>Pay</Table.Head>
<Table.Head>On</Table.Head>
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

						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
</div>
