<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	$effect(() => {
		if (form && 'ok' in form && form.ok) toast.success(form.ok);
		if (form && 'error' in form && form.error) toast.error(form.error);
	});

	let showAccount = $state(false);
	let showCategory = $state(false);
	let showVendor = $state(false);
	const kindLabel = (k: string) => k.replace(/_/g, ' ');
</script>

<div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
	<h1 class="mb-5 text-xl font-semibold tracking-tight text-ink">Finance settings</h1>

	<!-- Preferences -->
	<section class="mb-8 rounded-xl border border-border p-5">
		<h2 class="mb-3 text-sm font-semibold text-ink">Preferences</h2>
		<form method="POST" action="?/updateSettings" use:enhance class="space-y-3">
			<div class="grid gap-3 sm:grid-cols-3">
				<div>
					<Label class="text-xs">Default drawer</Label>
					<select name="defaultDrawerAccountId" class="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
						<option value="">— none —</option>
						{#each data.accounts.filter((a) => a.kind === 'cash_drawer') as a (a.id)}
							<option value={a.id} selected={data.settings.defaultDrawerAccountId === a.id}>{a.name}</option>
						{/each}
					</select>
				</div>
				<div>
					<Label class="text-xs">Default bank / e-wallet</Label>
					<select name="defaultBankAccountId" class="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
						<option value="">— none —</option>
						{#each data.accounts.filter((a) => a.kind === 'bank' || a.kind === 'e_wallet') as a (a.id)}
							<option value={a.id} selected={data.settings.defaultBankAccountId === a.id}>{a.name}</option>
						{/each}
					</select>
				</div>
				<div>
					<Label class="text-xs">Undeposited (online) account</Label>
					<select name="undepositedAccountId" class="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
						<option value="">— none —</option>
						{#each data.accounts as a (a.id)}
							<option value={a.id} selected={data.settings.undepositedAccountId === a.id}>{a.name}</option>
						{/each}
					</select>
				</div>
			</div>
			<label class="flex items-center gap-2 text-sm text-ink">
				<input type="checkbox" name="autoPostOnlinePayments" class="size-4" checked={data.settings.autoPostOnlinePayments} />
				Post online (PayMongo) payments into the undeposited account automatically
			</label>
			<label class="flex items-center gap-2 text-sm text-ink">
				<input type="checkbox" name="requireExpenseApproval" class="size-4" checked={data.settings.requireExpenseApproval} />
				Require approval before an expense can be paid
			</label>
			<label class="flex items-center gap-2 text-sm text-ink">
				<input type="checkbox" name="lockOnDayClose" class="size-4" checked={data.settings.lockOnDayClose} />
				Lock a business date once it is day-closed (a manager can reopen)
			</label>
			<label class="flex items-center gap-2 text-sm text-ink">
				<input type="checkbox" name="requireOpenShiftForCashPayment" class="size-4" checked={data.settings.requireOpenShiftForCashPayment} />
				Require an open cashier shift before taking a cash payment
			</label>
			<Button type="submit" size="sm">Save preferences</Button>
		</form>
	</section>

	<!-- Cash accounts -->
	<section class="mb-8 rounded-xl border border-border p-5">
		<div class="mb-3 flex items-center justify-between">
			<h2 class="text-sm font-semibold text-ink">Cash accounts</h2>
			<Button size="sm" variant="outline" onclick={() => (showAccount = !showAccount)}>Add account</Button>
		</div>
		{#if showAccount}
			<form method="POST" action="?/createAccount" use:enhance class="mb-3 grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-3">
				<Input name="name" placeholder="Name" required />
				<select name="kind" class="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
					{#each data.accountKinds as k (k)}<option value={k}>{kindLabel(k)}</option>{/each}
				</select>
				<Input name="openingBalance" type="number" step="0.01" placeholder="Opening balance ₱" />
				<Input name="institution" placeholder="Institution (optional)" />
				<Input name="accountRef" placeholder="Acct/wallet no. (optional)" />
				<Button type="submit" size="sm">Add</Button>
			</form>
		{/if}
		<div class="divide-y divide-border">
			{#each data.accounts as a (a.id)}
				<div class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
					<div>
						<span class="text-ink">{a.name}</span>
						<Badge variant="outline" class="ml-1.5 border-border bg-surface-2 text-ink-muted">{kindLabel(a.kind)}</Badge>
						{#if a.isSystem}<Badge variant="outline" class="ml-1 border-border bg-surface-2 text-ink-muted">system</Badge>{/if}
						{#if !a.isActive}<span class="ml-1.5 text-xs text-danger">inactive</span>{/if}
						<span class="ml-2 text-ink-muted tabular-nums">{peso(a.currentBalanceCentavos)}</span>
					</div>
					<div class="flex gap-2">
						<form method="POST" action="?/updateAccount" use:enhance>
							<input type="hidden" name="id" value={a.id} />
							<input type="hidden" name="isActive" value={a.isActive ? 'false' : 'true'} />
							<button class="text-xs text-ink-muted underline underline-offset-2">{a.isActive ? 'Deactivate' : 'Activate'}</button>
						</form>
						{#if !a.isSystem}
							<form method="POST" action="?/deleteAccount" use:enhance>
								<input type="hidden" name="id" value={a.id} />
								<button class="text-xs text-ink-muted underline underline-offset-2 hover:text-danger">Delete</button>
							</form>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</section>

	<!-- Expense categories -->
	<section class="mb-8 rounded-xl border border-border p-5">
		<div class="mb-3 flex items-center justify-between">
			<h2 class="text-sm font-semibold text-ink">Expense categories</h2>
			<Button size="sm" variant="outline" onclick={() => (showCategory = !showCategory)}>Add category</Button>
		</div>
		{#if showCategory}
			<form method="POST" action="?/createCategory" use:enhance class="mb-3 flex flex-wrap gap-2 rounded-lg border border-border p-3">
				<Input name="name" placeholder="Name" required class="max-w-xs" />
				<select name="group" class="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
					{#each data.expenseGroups as g (g)}<option value={g}>{g.replace('_', ' ')}</option>{/each}
				</select>
				<Button type="submit" size="sm">Add</Button>
			</form>
		{/if}
		<div class="flex flex-wrap gap-2">
			{#each data.categories as c (c.id)}
				<span class="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm {c.isActive ? '' : 'opacity-50'}">
					<span class="text-ink">{c.name}</span>
					<span class="text-xs text-ink-muted">{c.group.replace('_', ' ')}</span>
					<form method="POST" action="?/deleteCategory" use:enhance class="inline">
						<input type="hidden" name="id" value={c.id} />
						<button class="text-xs text-ink-muted hover:text-danger">×</button>
					</form>
				</span>
			{/each}
		</div>
	</section>

	<!-- Vendors -->
	<section class="rounded-xl border border-border p-5">
		<div class="mb-3 flex items-center justify-between">
			<h2 class="text-sm font-semibold text-ink">Vendors</h2>
			<Button size="sm" variant="outline" onclick={() => (showVendor = !showVendor)}>Add vendor</Button>
		</div>
		{#if showVendor}
			<form method="POST" action="?/createVendor" use:enhance class="mb-3 grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-3">
				<Input name="name" placeholder="Name" required />
				<Input name="tin" placeholder="TIN" />
				<Input name="contactPhone" placeholder="Phone" />
				<Input name="address" placeholder="Address" class="sm:col-span-2" />
				<Input name="contactEmail" placeholder="Email" />
				<Button type="submit" size="sm">Add</Button>
			</form>
		{/if}
		<div class="divide-y divide-border">
			{#each data.vendors as v (v.id)}
				<div class="flex items-center justify-between py-2 text-sm {v.isActive ? '' : 'opacity-50'}">
					<div>
						<span class="text-ink">{v.name}</span>
						{#if v.tin}<span class="ml-2 text-xs text-ink-muted">TIN {v.tin}</span>{/if}
					</div>
					<div class="flex gap-2">
						<form method="POST" action="?/updateVendor" use:enhance>
							<input type="hidden" name="id" value={v.id} />
							<input type="hidden" name="isActive" value={v.isActive ? 'false' : 'true'} />
							<button class="text-xs text-ink-muted underline underline-offset-2">{v.isActive ? 'Deactivate' : 'Activate'}</button>
						</form>
						<form method="POST" action="?/deleteVendor" use:enhance>
							<input type="hidden" name="id" value={v.id} />
							<button class="text-xs text-ink-muted underline underline-offset-2 hover:text-danger">Delete</button>
						</form>
					</div>
				</div>
			{/each}
		</div>
	</section>
</div>
