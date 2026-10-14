<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import BonusGuide from '$lib/components/bonuses/bonus-guide.svelte';
	import { money } from '$lib/components/payroll/money';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const b = $derived(data.batch);
	const thirteenth = $derived(b.kind !== 'other');
	const REASON: Record<string, string> = {
		not_covered: 'Not entitled',
		under_one_month: 'Under one month',
		nothing_earned: 'No basic pay yet',
		paid_in_final_pay: 'Paid in final pay'
	};

	let busy = $state(false);

	$effect(() => {
		if (form && 'error' in form && form.error) toast.error(form.error);
		else if (form && 'ok' in form && form.ok) toast.success(form.ok);
	});

	function submit() {
		busy = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = false;
		};
	}
	// A deleted batch no longer exists, so leave for the list instead of reloading into a 404.
	function remove() {
		busy = true;
		return async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
			if (result.type === 'success') {
				toast.success('Draft deleted.');
				await goto('/bonuses?year=' + b.year);
			} else await update();
			busy = false;
		};
	}
	const dayLabel = (d: string) =>
		new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' });
</script>

<svelte:head><title>{b.establishment} · {b.label} · HR</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-6">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<a href="/bonuses?year={b.year}" class="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
				<ArrowLeftIcon class="size-4" aria-hidden="true" /> Bonuses
			</a>
			<h1 class="mt-2 text-5xl font-light tracking-tight">{b.establishment}</h1>
			<p class="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
				<span>{b.label}</span>
				<Badge variant={b.status === 'issued' ? 'ok' : 'muted'}>
					{b.status === 'issued' ? `Issued ${b.issuedOn ? dayLabel(b.issuedOn) : ''}` : 'Draft'}
				</Badge>
				<span class="tabular-nums">{b.paidCount} paid · {money(b.total)}</span>
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<BonusGuide />
			{#if b.lines.length > 0}
				<Button variant="outline" href="/print/{b.establishmentSlug}/bonuses/{b.id}" target="_blank" rel="noopener">
					Print
				</Button>
			{/if}
			{#if b.status === 'draft'}
				{#if thirteenth}
					<form method="POST" action="?/refresh" use:enhance={submit}>
						<input type="hidden" name="batchId" value={b.id} />
						<Button type="submit" variant="outline" disabled={busy}>Refresh</Button>
					</form>
				{/if}
				<form method="POST" action="?/issue" use:enhance={submit}>
					<input type="hidden" name="batchId" value={b.id} />
					<Button type="submit" disabled={busy || b.total === 0}>Issue</Button>
				</form>
				<form method="POST" action="?/delete" use:enhance={remove}>
					<input type="hidden" name="batchId" value={b.id} />
					<Button type="submit" variant="ghost" disabled={busy}>Delete</Button>
				</form>
			{:else}
				<form method="POST" action="?/reopen" use:enhance={submit}>
					<input type="hidden" name="batchId" value={b.id} />
					<Button type="submit" variant="outline" disabled={busy}>Reopen</Button>
				</form>
			{/if}
		</div>
	</div>

	<section class="panel p-5" aria-label="{b.establishment} · {b.label}">
		{#if b.lines.length === 0}
			<p class="text-sm text-ink-muted">
				{thirteenth
					? 'No locked payslips this year for this establishment yet. Lock its payroll, then refresh.'
					: 'Nobody is assigned here right now.'}
			</p>
		{:else}
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row class="hover:bg-transparent">
							<Table.Head>Employee</Table.Head>
							{#if thirteenth}
								<Table.Head class="text-right">Basic earned</Table.Head>
								<Table.Head class="text-right">Late / undertime</Table.Head>
								<Table.Head class="text-right">13th month (÷ 12)</Table.Head>
								<Table.Head class="text-right">Already paid</Table.Head>
							{/if}
							<Table.Head class="text-right">{thirteenth ? 'Pay now' : 'Amount'}</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each b.lines as l (l.id)}
							<Table.Row>
								<Table.Cell class="align-top">
									<p class="font-medium">{l.employeeName}</p>
									<p class="text-xs text-ink-muted">#{l.employeeNo}{l.position ? ` · ${l.position}` : ''}{l.note ? ` · ${l.note}` : ''}</p>
									{#if l.excludedReason}
										<p class="text-xs font-medium text-ink-muted">{REASON[l.excludedReason] ?? l.excludedReason}</p>
									{/if}
									{#if l.overTaxExemption}
										<p class="text-xs font-medium text-danger">Over the ₱90,000 tax exemption this year</p>
									{/if}
								</Table.Cell>
								{#if thirteenth}
									<Table.Cell class="text-right align-top tabular-nums">{money(l.basicEarned)}</Table.Cell>
									<Table.Cell class="text-right align-top tabular-nums">{l.late > 0 ? money(l.late) : '–'}</Table.Cell>
									<Table.Cell class="text-right align-top tabular-nums">{money(l.accrued)}</Table.Cell>
									<Table.Cell class="text-right align-top tabular-nums">{l.alreadyPaid > 0 ? money(l.alreadyPaid) : '–'}</Table.Cell>
									<Table.Cell class="text-right align-top font-medium tabular-nums">{money(l.amount)}</Table.Cell>
								{:else}
									<Table.Cell class="text-right align-top">
										{#if b.status === 'draft'}
											<form method="POST" action="?/amount" use:enhance={submit} class="flex justify-end gap-2">
												<input type="hidden" name="lineId" value={l.id} />
												<Input
													name="amount"
													type="number"
													min="0"
													step="0.01"
													value={l.amount / 100}
													aria-label="Amount for {l.employeeName}"
													class="h-9 w-36 text-right"
												/>
												<Button type="submit" variant="ghost" size="sm" disabled={busy}>Save</Button>
											</form>
										{:else}
											<span class="font-medium tabular-nums">{money(l.amount)}</span>
										{/if}
									</Table.Cell>
								{/if}
							</Table.Row>
						{/each}
					</Table.Body>
					<Table.Footer class="border-t border-ink/30 bg-transparent">
						<Table.Row class="hover:bg-transparent">
							<Table.Cell class="font-medium">Total · {b.paidCount} paid</Table.Cell>
							{#if thirteenth}
								<Table.Cell class="text-right tabular-nums">{money(b.lines.reduce((t, l) => t + l.basicEarned, 0))}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(b.lines.reduce((t, l) => t + l.late, 0))}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(b.lines.reduce((t, l) => t + l.accrued, 0))}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(b.lines.reduce((t, l) => t + l.alreadyPaid, 0))}</Table.Cell>
							{/if}
							<Table.Cell class="text-right font-medium tabular-nums">{money(b.total)}</Table.Cell>
						</Table.Row>
					</Table.Footer>
				</Table.Root>
			</div>
		{/if}
	</section>
</div>
