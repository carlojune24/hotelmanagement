<script lang="ts">
	import { page } from '$app/state';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import SearchIcon from '@lucide/svelte/icons/search';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	type Account = PageData['accounts'][number];

	const peso = (c: number) =>
		`${c < 0 ? '−' : ''}₱${(Math.abs(c) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	const TYPES: { key: Account['type']; label: string; hint: string }[] = [
		{ key: 'asset', label: 'Assets', hint: 'What the hotel holds: cash, bank, e-wallets, receivables.' },
		{ key: 'liability', label: 'Liabilities', hint: 'What the hotel owes: deposits held, taxes, payables.' },
		{ key: 'equity', label: 'Equity', hint: "The owners' stake." },
		{ key: 'income', label: 'Income', hint: 'Where sales are booked: rooms, halls, food & beverage.' },
		{ key: 'expense', label: 'Expenses', hint: 'Where costs are booked.' }
	];

	// What each cash category is called on Finance → Cash and Reports.
	const CATEGORY: Record<string, string> = {
		room_revenue: 'Rooms',
		hall_revenue: 'Function halls',
		incidental_sale: 'Incidentals',
		dining_revenue: 'Dining',
		other_revenue: 'Other revenue',
		deposit: 'Deposits',
		deposit_refund: 'Deposit refunds',
		refund: 'Refunds',
		expense: 'Expenses',
		payroll: 'Payroll',
		statutory_remittance: 'Statutory remittance',
		bank_deposit: 'Bank deposits',
		transfer_in: 'Transfers in',
		transfer_out: 'Transfers out',
		owner_contribution: 'Owner contributions',
		owner_draw: 'Owner draws',
		adjustment: 'Adjustments',
		security_deposit_hold: 'Security deposits held',
		security_deposit_refund: 'Security deposits returned'
	};
	const categoryLabel = (c: string) => CATEGORY[c] ?? c.replace(/_/g, ' ');
	const humanize = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

	let search = $state('');
	let activeOnly = $state(false);
	const wanted = $derived(page.url.searchParams.get('code'));

	const matches = (a: Account) => {
		if (activeOnly && a.lines === 0) return false;
		const q = search.trim().toLowerCase();
		if (!q) return true;
		return (
			a.code.toLowerCase().includes(q) ||
			a.name.toLowerCase().includes(q) ||
			a.subtype.replace(/_/g, ' ').toLowerCase().includes(q) ||
			a.postsFrom.some((c) => categoryLabel(c).toLowerCase().includes(q) || c.includes(q))
		);
	};
	const groups = $derived(
		TYPES.map((t) => ({ ...t, accounts: data.accounts.filter((a) => a.type === t.key && matches(a)) })).filter((g) => g.accounts.length > 0)
	);
	const shown = $derived(groups.reduce((n, g) => n + g.accounts.length, 0));

	// Arriving with ?code=4040 scrolls to that account.
	$effect(() => {
		if (!wanted) return;
		document.getElementById(`acct-${wanted}`)?.scrollIntoView({ block: 'center' });
	});
</script>

<svelte:head><title>Chart of accounts · Finance</title></svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
	<div class="mb-5">
		<h1 class="text-xl font-semibold tracking-tight text-ink">Chart of accounts</h1>
		<p class="mt-1 max-w-2xl text-sm text-ink-muted">
			Every account the hotel's money is booked to. Each payment, expense and refund posts here automatically by its category;
			"Posts from" shows which categories feed an account. This list is read-only.
		</p>
	</div>

	<div class="mb-5 flex flex-wrap items-center gap-x-5 gap-y-3">
		<div class="relative w-full sm:w-80">
			<SearchIcon class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
			<Input bind:value={search} placeholder="Search a code, name or category (try dining)" aria-label="Search accounts" class="pl-8" />
		</div>
		<div class="flex items-center gap-2">
			<Checkbox id="activeOnly" bind:checked={activeOnly} />
			<Label for="activeOnly" class="text-sm font-normal">Only accounts with postings</Label>
		</div>
		<p class="ml-auto text-sm tabular-nums text-ink-muted" aria-live="polite">{shown} of {data.accounts.length} accounts</p>
	</div>

	{#if data.accounts.length === 0}
		<div class="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-12 text-center">
			<BookOpenIcon class="size-6 text-ink-muted" />
			<p class="text-sm text-ink-muted">This hotel has no chart of accounts yet. Run the chart-of-accounts backfill to create it.</p>
		</div>
	{:else if groups.length === 0}
		<p class="rounded-xl border border-dashed border-border p-10 text-center text-sm text-ink-muted">No account matches.</p>
	{:else}
		{#each groups as g (g.key)}
			<section class="mb-8" aria-labelledby="type-{g.key}">
				<div class="mb-2 flex flex-wrap items-baseline gap-x-3">
					<h2 id="type-{g.key}" class="text-sm font-semibold text-ink">{g.label}</h2>
					<p class="text-xs text-ink-muted">{g.hint}</p>
				</div>
				<div class="overflow-x-auto rounded-xl border border-border">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head class="w-20">Code</Table.Head>
								<Table.Head>Account</Table.Head>
								<Table.Head>Posts from</Table.Head>
								<Table.Head class="w-24">Normal</Table.Head>
								<Table.Head class="w-36 text-right">Posted so far</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each g.accounts as a (a.id)}
								<Table.Row id="acct-{a.code}" class={a.code === wanted ? 'bg-brand/10' : ''} aria-current={a.code === wanted ? 'true' : undefined}>
									<Table.Cell class="font-mono text-ink">{a.code}</Table.Cell>
									<Table.Cell>
										<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
											<span class="font-medium text-ink {a.isActive ? '' : 'text-ink-muted line-through'}">{a.name}</span>
											{#if !a.isPostable}<Badge variant="outline">Heading</Badge>{/if}
											{#if !a.isActive}<Badge variant="outline">Inactive</Badge>{/if}
										</div>
										<p class="text-xs text-ink-muted">{humanize(a.subtype)}</p>
									</Table.Cell>
									<Table.Cell>
										{#if a.postsFrom.length > 0}
											<div class="flex flex-wrap gap-1">
												{#each a.postsFrom as c (c)}
													<span class="rounded border border-border px-1.5 py-0.5 text-xs text-ink">{categoryLabel(c)}</span>
												{/each}
											</div>
										{:else}
											<span class="text-xs text-ink-muted">Journal entries only</span>
										{/if}
									</Table.Cell>
									<Table.Cell class="text-sm text-ink-muted">{a.normalBalance === 'debit' ? 'Debit' : 'Credit'}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">
										{#if a.lines === 0}
											<span class="text-ink-muted">Nothing yet</span>
										{:else}
											<span class="font-medium text-ink">{peso(a.balanceCentavos)}</span>
											<span class="block text-xs text-ink-muted">{a.lines} {a.lines === 1 ? 'posting' : 'postings'}</span>
										{/if}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			</section>
		{/each}
		<p class="text-xs text-ink-muted">
			"Posted so far" is the account's balance across everything ever posted, in its own direction (income and liability accounts count credits,
			assets and expenses count debits). For a date range, use <a class="underline" href="/{page.params.hotel}/management/finance/reports">Reports</a>.
		</p>
	{/if}
</div>
