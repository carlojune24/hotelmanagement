<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import PlusIcon from '@lucide/svelte/icons/plus';
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
	const REASON: Record<string, string> = {
		not_covered: 'Not entitled',
		under_one_month: 'Under one month',
		nothing_earned: 'No basic pay yet',
		paid_in_final_pay: 'Paid in final pay'
	};

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
			<Button variant="outline" size="sm" href="?year={data.year - 1}">← {data.year - 1}</Button>
			<span class="px-2 text-lg tabular-nums">{data.year}</span>
			<Button variant="outline" size="sm" href="?year={data.year + 1}">{data.year + 1} →</Button>
			<Button variant="gold" onclick={() => (creating = true)}><PlusIcon /> New batch</Button>
		</div>
	</div>

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

	{#each data.batches as b (b.id)}
		{@const thirteenth = b.kind !== 'other'}
		<section class="panel p-5" aria-label="{b.establishment} · {b.label}">
			<details class="group/batch" open>
				<summary
					class="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 [&::-webkit-details-marker]:hidden"
				>
					<div>
						<h2 class="flex items-center gap-2 text-2xl font-light">
							<ChevronDownIcon
								class="size-5 shrink-0 -rotate-90 text-ink-muted transition-transform group-open/batch:rotate-0"
								aria-hidden="true"
							/>
							{b.establishment}
						</h2>
						<p class="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
							<span>{b.label}</span>
							<Badge variant={b.status === 'issued' ? 'ok' : 'muted'}>
								{b.status === 'issued' ? `Issued ${b.issuedOn ? dayLabel(b.issuedOn) : ''}` : 'Draft'}
							</Badge>
							<span class="tabular-nums">{b.paidCount} paid · {money(b.total)}</span>
						</p>
					</div>
					<div class="flex flex-wrap gap-2">
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
							<form method="POST" action="?/delete" use:enhance={submit}>
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
				</summary>

				<div class="mt-4 space-y-3">
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
				</div>
			</details>
		</section>
	{/each}
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
