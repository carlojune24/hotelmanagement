<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { RANGE_PRESETS, matchPreset, resolveRange } from '$lib/finance-range';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	$effect(() => {
		if (form && 'ok' in form && form.ok) {
			toast.success(form.ok);
			panel = null;
		}
		if (form && 'error' in form && form.error) toast.error(form.error);
	});

	let panel = $state<null | 'transfer' | 'deposit' | 'manual'>(null);

	const kindLabel: Record<string, string> = {
		cash_drawer: 'Drawer',
		petty_cash: 'Petty cash',
		bank: 'Bank',
		e_wallet: 'E-wallet',
		undeposited: 'Undeposited'
	};
	const catLabel = (c: string) => c.replace(/_/g, ' ');

	function applyFilter(e: SubmitEvent) {
		e.preventDefault();
		const fd = new FormData(e.currentTarget as HTMLFormElement);
		const q = new URLSearchParams();
		for (const [k, v] of fd) if (v) q.set(k, String(v));
		location.href = `${location.pathname}?${q}`;
	}

	// Preset date ranges — same control as the Finance dashboard. They set from/to
	// and keep the current Account / Direction filters.
	const activePreset = $derived(
		data.filters.from && data.filters.to
			? matchPreset(data.filters.from, data.filters.to, data.today)
			: 'all'
	);
	function goToRange(from: string | null, to: string | null) {
		const q = new URLSearchParams();
		if (from && to) {
			q.set('from', from);
			q.set('to', to);
		}
		if (data.filters.account) q.set('account', data.filters.account);
		if (data.filters.direction) q.set('direction', data.filters.direction);
		goto(`?${q}`, { keepFocus: true, noScroll: true });
	}
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
	<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
		<h1 class="text-xl font-semibold tracking-tight text-ink">Cash accounts &amp; movements</h1>
		{#if data.finance.canWrite}
			<div class="flex gap-2">
				<Button size="sm" variant="outline" onclick={() => (panel = panel === 'transfer' ? null : 'transfer')}>Transfer</Button>
				<Button size="sm" variant="outline" onclick={() => (panel = panel === 'deposit' ? null : 'deposit')}>Bank deposit</Button>
				<Button size="sm" variant="outline" onclick={() => (panel = panel === 'manual' ? null : 'manual')}>Manual entry</Button>
			</div>
		{/if}
	</div>

	<!-- Accounts -->
	<div class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{#each data.accounts as a (a.id)}
			<div class="rounded-xl border border-border p-4 {a.isActive ? '' : 'opacity-50'}">
				<div class="flex items-center justify-between">
					<span class="text-sm font-medium text-ink">{a.name}</span>
					<Badge variant="outline" class="border-border bg-surface-2 text-ink-muted">{kindLabel[a.kind] ?? a.kind}</Badge>
				</div>
				<div class="mt-1 text-lg font-semibold text-ink tabular-nums">{peso(a.currentBalanceCentavos)}</div>
				{#if a.institution}<div class="text-xs text-ink-muted">{a.institution}{a.accountRef ? ` · ${a.accountRef}` : ''}</div>{/if}
			</div>
		{/each}
	</div>

	{#if panel === 'transfer' || panel === 'deposit'}
		<form
			method="POST"
			action="?/transfer"
			use:enhance
			class="mb-6 grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-4"
		>
			{#if panel === 'deposit'}<input type="hidden" name="isBankDeposit" value="1" />{/if}
			<div>
				<Label class="text-xs">From</Label>
				<select name="fromAccountId" required class="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
					{#each data.activeAccounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
				</select>
			</div>
			<div>
				<Label class="text-xs">To</Label>
				<select name="toAccountId" required class="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
					{#each data.activeAccounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
				</select>
			</div>
			<div>
				<Label class="text-xs">Amount (₱)</Label>
				<Input name="amount" type="number" min="0.01" step="0.01" required class="mt-1" />
			</div>
			<div class="flex items-end gap-2">
				<Input name="memo" placeholder="Memo (optional)" class="mt-1" />
				<Button type="submit" size="sm">{panel === 'deposit' ? 'Deposit' : 'Transfer'}</Button>
			</div>
		</form>
	{/if}

	{#if panel === 'manual'}
		<form
			method="POST"
			action="?/manualMovement"
			use:enhance
			class="mb-6 grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-3"
		>
			<input type="hidden" name="businessDate" value={data.today} />
			<div>
				<Label class="text-xs">Direction</Label>
				<select name="direction" class="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
					<option value="in">Cash in</option>
					<option value="out">Cash out</option>
				</select>
			</div>
			<div>
				<Label class="text-xs">Category</Label>
				<select name="category" class="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
					{#each data.manualCategories as c (c)}<option value={c}>{catLabel(c)}</option>{/each}
				</select>
			</div>
			<div>
				<Label class="text-xs">Account</Label>
				<select name="cashAccountId" required class="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
					{#each data.activeAccounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
				</select>
			</div>
			<div><Label class="text-xs">Amount (₱)</Label><Input name="amount" type="number" min="0.01" step="0.01" required class="mt-1" /></div>
			<div><Label class="text-xs">Counterparty</Label><Input name="counterpartyName" class="mt-1" /></div>
			<div class="flex items-end gap-2">
				<Input name="memo" placeholder="Memo" class="mt-1" />
				<Button type="submit" size="sm">Record</Button>
			</div>
		</form>
	{/if}

	<!-- Date range presets (matches the Finance dashboard) -->
	<div class="mb-2 flex flex-wrap gap-1">
		<Button
			size="sm"
			variant={activePreset === 'all' ? 'default' : 'outline'}
			onclick={() => goToRange(null, null)}
		>
			All time
		</Button>
		{#each RANGE_PRESETS as p (p.key)}
			<Button
				size="sm"
				variant={activePreset === p.key ? 'default' : 'outline'}
				onclick={() => {
					const r = resolveRange(p.key, data.today);
					goToRange(r.from, r.to);
				}}
			>
				{p.label}
			</Button>
		{/each}
		{#if activePreset === 'custom'}
			<Button size="sm" variant="default" disabled>Custom</Button>
		{/if}
	</div>

	<!-- Filters -->
	<form onsubmit={applyFilter} class="mb-3 flex flex-wrap items-end gap-2">
		<div><Label class="text-xs">From</Label><Input name="from" type="date" value={data.filters.from} class="mt-1 h-8" /></div>
		<div><Label class="text-xs">To</Label><Input name="to" type="date" value={data.filters.to} class="mt-1 h-8" /></div>
		<div>
			<Label class="text-xs">Account</Label>
			<select name="account" class="mt-1 h-8 rounded-md border border-input bg-transparent px-2 text-sm">
				<option value="">All</option>
				{#each data.accounts as a (a.id)}<option value={a.id} selected={data.filters.account === a.id}>{a.name}</option>{/each}
			</select>
		</div>
		<div>
			<Label class="text-xs">Direction</Label>
			<select name="direction" class="mt-1 h-8 rounded-md border border-input bg-transparent px-2 text-sm">
				<option value="">Both</option>
				<option value="in" selected={data.filters.direction === 'in'}>In</option>
				<option value="out" selected={data.filters.direction === 'out'}>Out</option>
			</select>
		</div>
		<Button type="submit" size="sm" variant="outline">Filter</Button>
		<a href={location.pathname} class="text-xs text-ink-muted underline underline-offset-2">Clear</a>
	</form>

	<div class="overflow-x-auto rounded-xl border border-border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Date</Table.Head>
					<Table.Head>Account</Table.Head>
					<Table.Head>Category</Table.Head>
					<Table.Head>Details</Table.Head>
					<Table.Head class="text-right">In</Table.Head>
					<Table.Head class="text-right">Out</Table.Head>
					<Table.Head></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.movements as m (m.id)}
					<Table.Row class={m.voidedAt ? 'opacity-40' : ''}>
						<Table.Cell class="whitespace-nowrap text-ink-muted">{m.businessDate}</Table.Cell>
						<Table.Cell class="text-ink">{m.accountName}</Table.Cell>
						<Table.Cell class="text-ink-muted">{catLabel(m.category)}</Table.Cell>
						<Table.Cell class="max-w-[16rem] truncate text-ink-muted">
							{m.counterpartyName ? `${m.counterpartyName} — ` : ''}{m.memo ?? ''}
							{#if m.voidedAt}<span class="text-danger"> (voided)</span>{/if}
						</Table.Cell>
						<Table.Cell class="text-right tabular-nums text-ok">{m.direction === 'in' ? peso(m.amountCentavos) : ''}</Table.Cell>
						<Table.Cell class="text-right tabular-nums text-danger">{m.direction === 'out' ? peso(m.amountCentavos) : ''}</Table.Cell>
						<Table.Cell class="text-right">
							{#if !m.voidedAt && data.finance.canAdmin && m.sourceType === 'manual'}
								<form method="POST" action="?/voidMovement" use:enhance>
									<input type="hidden" name="movementId" value={m.id} />
									<input type="hidden" name="reason" value="Voided from cash ledger" />
									<button type="submit" class="text-xs text-ink-muted underline underline-offset-2 hover:text-danger">Void</button>
								</form>
							{/if}
						</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row><Table.Cell colspan={7} class="py-6 text-center text-ink-muted">No movements match.</Table.Cell></Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>
