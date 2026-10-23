<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import BonusGuide from '$lib/components/bonuses/bonus-guide.svelte';
	import { money } from '$lib/components/payroll/money';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const selectClass =
		'h-10 w-full rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

	let creating = $state(false);
	let kind = $state('thirteenth_year_end');
	let busy = $state(false);

	$effect(() => {
		if (form && 'error' in form && form.error) toast.error(form.error);
		else if (form && 'ok' in form && form.ok) {
			toast.success(form.ok);
			creating = false;
		}
	});

	function submit() {
		busy = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = false;
		};
	}
	const dayLabel = (d: string) =>
		new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' });
</script>

<svelte:head><title>Bonuses · HR</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-6">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-5xl font-light tracking-tight">Bonuses</h1>
			<p class="mt-2 max-w-2xl text-sm text-ink-muted">
				The 13th month pay (one twelfth of basic earned in the year, due by December 24) and other bonuses, issued and
				printed per establishment. Paid outside payroll, so nothing here touches a payslip.
			</p>
		</div>
		<div class="flex items-center gap-2">
			<BonusGuide />
			<Button variant="outline" size="sm" href="?year={data.year - 1}">← {data.year - 1}</Button>
			<span class="px-2 text-lg tabular-nums">{data.year}</span>
			<Button variant="outline" size="sm" href="?year={data.year + 1}">{data.year + 1} →</Button>
			<Button variant="outline" size="sm" href="/reports/13th-month?year={data.year}">
				13th-month report
			</Button>
			<Button variant="gold" onclick={() => (creating = true)}><PlusIcon /> New batch</Button>
		</div>
	</div>

	{#if data.thirteenth.pending.length > 0 && (data.thirteenth.overdue || data.thirteenth.daysLeft <= 60)}
		<p
			class="rounded-2xl border border-dashed px-4 py-3 text-sm {data.thirteenth.overdue
				? 'border-danger/50 text-danger'
				: 'border-ink/30'}"
			role="status"
		>
			{#if data.thirteenth.overdue}
				<strong class="font-medium">13th month was due {dayLabel(data.thirteenth.due)}.</strong>
			{:else}
				<strong class="font-medium">13th month is due {dayLabel(data.thirteenth.due)}</strong>
				({data.thirteenth.daysLeft} {data.thirteenth.daysLeft === 1 ? 'day' : 'days'} left).
			{/if}
			Year-end batch not issued for: {data.thirteenth.pending.join(', ')}.
		</p>
	{/if}

	{#if data.batches.length === 0}
		<section class="panel p-6">
			<div class="hatch rounded-2xl px-6 py-14 text-center">
				<p class="text-lg">No bonus batches for {data.year}</p>
				<p class="mx-auto mt-1 max-w-md text-sm text-ink-muted">
					Create a mid-year installment or the year-end 13th month for every establishment, or a one-off bonus such as a
					Christmas bonus.
				</p>
			</div>
		</section>
	{/if}

	{#if data.batches.length > 0}
		<section class="panel p-5">
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row class="hover:bg-transparent">
							<Table.Head>Establishment</Table.Head>
							<Table.Head>Batch</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head class="text-right">People paid</Table.Head>
							<Table.Head class="text-right">Total</Table.Head>
							<Table.Head><span class="sr-only">Actions</span></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.batches as b (b.id)}
							<Table.Row>
								<Table.Cell class="font-medium">{b.establishment}</Table.Cell>
								<Table.Cell>{b.label}</Table.Cell>
								<Table.Cell>
									<Badge variant={b.status === 'issued' ? 'ok' : 'muted'}>
										{b.status === 'issued' ? `Issued ${b.issuedOn ? dayLabel(b.issuedOn) : ''}` : 'Draft'}
									</Badge>
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{b.paidCount}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(b.total)}</Table.Cell>
								<Table.Cell class="text-right">
									<Button variant="gold" size="sm" href="/bonuses/{b.id}" aria-label="View {b.establishment} · {b.label}">
										View
									</Button>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</section>
	{/if}
</div>

<Dialog.Root open={creating} onOpenChange={(o) => (creating = o)}>
	<Dialog.Content class="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
		<Dialog.Header class="bg-gold px-7 py-5 pr-14 text-ink">
			<Dialog.Title class="font-display text-2xl font-light">New bonus batch</Dialog.Title>
			<Dialog.Description class="text-ink/70">One batch per establishment, so each can be issued and printed on its own.</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/create" use:enhance={submit} class="flex min-h-0 flex-1 flex-col">
			<div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-7 py-6">
				<div class="space-y-1.5">
					<Label for="kind">What to pay</Label>
					<select id="kind" name="kind" class={selectClass} bind:value={kind}>
						{#each data.kinds as k (k.value)}<option value={k.value}>{k.label}</option>{/each}
					</select>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div class="space-y-1.5">
						<Label for="year">Year</Label>
						<Input id="year" name="year" type="number" min="2000" max="2100" value={data.year} required />
					</div>
					<div class="space-y-1.5">
						<Label for="establishmentId">Establishment</Label>
						<select id="establishmentId" name="establishmentId" class={selectClass} required>
							<option value="all">All establishments</option>
							{#each data.establishments as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
						</select>
					</div>
				</div>
				{#if kind === 'thirteenth_mid_year'}
					<div class="space-y-1.5">
						<Label for="throughDate">Accrued up to</Label>
						<Input id="throughDate" name="throughDate" type="date" value="{data.year}-06-30" />
						<p class="text-xs text-ink-muted">Basic pay earned up to this date, ÷ 12. The year-end batch deducts it.</p>
					</div>
				{:else if kind === 'other'}
					<div class="grid grid-cols-2 gap-3">
						<div class="space-y-1.5">
							<Label for="label">Name</Label>
							<Input id="label" name="label" maxlength={80} placeholder="e.g. Christmas bonus" required />
						</div>
						<div class="space-y-1.5">
							<Label for="defaultAmount">Same amount for everyone (₱)</Label>
							<Input id="defaultAmount" name="defaultAmount" type="number" min="0" step="0.01" placeholder="0.00" />
						</div>
					</div>
					<p class="text-xs text-ink-muted">Everyone currently assigned is listed; you can change each amount before issuing.</p>
				{:else}
					<p class="text-xs text-ink-muted">
						Computed from locked payslips: (basic earned − late/undertime) ÷ 12, less any mid-year installment or 13th
						month already paid with final pay. Due on or before December 24.
					</p>
				{/if}
			</div>
			<Dialog.Footer class="flex-row justify-end gap-2 border-t border-dotted border-ink/20 bg-white/70 px-7 py-4">
				<Button type="button" variant="outline" onclick={() => (creating = false)}>Cancel</Button>
				<Button type="submit" disabled={busy}>Create</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
