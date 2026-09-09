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

	let panel = $state<null | 'transfer' | 'deposit' | 'manual' | 'ownerdraw'>(null);
	let drawAccountId = $state('');
	const drawAccount = $derived(data.activeAccounts.find((a) => a.id === drawAccountId));

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
			<div class="flex flex-wrap gap-2">
				<Button size="sm" variant="outline" onclick={() => (panel = panel === 'transfer' ? null : 'transfer')}>Transfer</Button>
				<Button size="sm" variant="outline" onclick={() => (panel = panel === 'deposit' ? null : 'deposit')}>Bank deposit</Button>
				<Button size="sm" variant="outline" onclick={() => (panel = panel === 'ownerdraw' ? null : 'ownerdraw')}>Owner draw</Button>
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

	{#if panel === 'ownerdraw'}
		<form
			method="POST"
			action="?/ownerDraw"
			use:enhance
			class="mb-6 rounded-xl border border-border p-4"
		>
			<input type="hidden" name="businessDate" value={data.today} />
			<p class="mb-3 text-sm text-ink-muted">
				Cash the owner takes out of the business. Records a <em>cash out</em> against the account
				(category <span class="text-ink">owner draw</span>) — it lowers Cash on hand, is not an
				expense, and shows in the ledger and the day's cash-out.
			</p>
			<div class="flex flex-wrap items-end gap-3">
				<div>
					<Label class="text-xs">From account</Label>
					<select
						name="cashAccountId"
						bind:value={drawAccountId}
						required
						class="mt-1 h-9 rounded-md border border-input bg-transparent px-2 text-sm"
					>
						<option value="" disabled selected>Choose…</option>
						{#each data.activeAccounts as a (a.id)}
							<option value={a.id}>{a.name} — {peso(a.currentBalanceCentavos)}</option>
						{/each}
					</select>
				</div>
				<div>
					<Label class="text-xs">Amount (₱)</Label>
					<Input name="amount" type="number" min="0.01" step="0.01" required class="mt-1 w-36" />
				</div>
				{#if drawAccount}
					<label class="flex items-center gap-1.5 pb-2 text-xs text-ink-muted">
						<input
							type="checkbox"
							class="size-3.5"
							onchange={(e) => {
								const amt = e.currentTarget.closest('form')?.querySelector<HTMLInputElement>('[name=amount]');
								if (amt) amt.value = e.currentTarget.checked ? (drawAccount!.currentBalanceCentavos / 100).toFixed(2) : '';
							}}
						/>
						Withdraw the full {peso(drawAccount.currentBalanceCentavos)}
					</label>
				{/if}
				<div class="flex-1"><Input name="memo" placeholder="Memo (optional)" class="mt-1" /></div>
				<Button type="submit" size="sm">Record withdrawal</Button>
			</div>
		</form>
	{/if}

	<!-- Position / reconciliation -->
	<div class="mb-4 overflow-x-auto rounded-xl border border-border">
		<div class="border-b border-border px-4 py-2.5 text-sm font-semibold text-ink">
			Reconciliation {data.rangeActive ? '· selected range' : '· all time'}
		</div>
		<table class="w-full text-sm">
			<thead class="border-b border-border bg-surface-2 text-left text-xs text-ink-muted">
				<tr>
					<th class="px-4 py-2">Account</th>
					<th class="px-4 py-2 text-right">Opening</th>
					<th class="px-4 py-2 text-right">In</th>
					<th class="px-4 py-2 text-right">Out</th>
					<th class="px-4 py-2 text-right">{data.rangeActive ? 'Closing' : 'Balance now'}</th>
				</tr>
			</thead>
			<tbody>
				{#each data.position as p (p.accountId)}
					<tr class="border-b border-border/60 last:border-0">
						<td class="px-4 py-2 text-ink">{p.name}</td>
						<td class="px-4 py-2 text-right tabular-nums text-ink-muted">{peso(p.openingCentavos)}</td>
						<td class="px-4 py-2 text-right tabular-nums text-ok">{p.inCentavos ? peso(p.inCentavos) : '—'}</td>
						<td class="px-4 py-2 text-right tabular-nums text-danger">{p.outCentavos ? peso(p.outCentavos) : '—'}</td>
						<td class="px-4 py-2 text-right font-medium tabular-nums text-ink">{peso(p.closingCentavos)}</td>
					</tr>
				{/each}
				<tr class="border-t border-border font-semibold">
					<td class="px-4 py-2 text-ink">Total</td>
					<td class="px-4 py-2 text-right tabular-nums text-ink-muted">{peso(data.position.reduce((s, p) => s + p.openingCentavos, 0))}</td>
					<td class="px-4 py-2 text-right tabular-nums">{peso(data.position.reduce((s, p) => s + p.inCentavos, 0))}</td>
					<td class="px-4 py-2 text-right tabular-nums">{peso(data.position.reduce((s, p) => s + p.outCentavos, 0))}</td>
					<td class="px-4 py-2 text-right tabular-nums text-ink">{peso(data.position.reduce((s, p) => s + p.closingCentavos, 0))}</td>
				</tr>
			</tbody>
		</table>
		{#if !data.rangeActive}
			<p class="border-t border-border px-4 py-2 text-xs text-ink-muted">
				“Opening” is each account’s starting float, set when it was created (no ledger entry) —
				this is the gap between the movements list and Cash on hand. Total balance here matches
				the dashboard’s Cash on hand.
			</p>
		{/if}
	</div>

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
					<Table.Row
						class={m.voidedAt
							? 'opacity-40'
							: m.sourceType === 'opening'
								? 'bg-surface-2/40 italic text-ink-muted'
								: ''}
					>
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
