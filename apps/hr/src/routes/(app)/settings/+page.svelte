<script lang="ts">
	import { enhance } from '$app/forms';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABEL } from '$lib/leave';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const TABS = [
		{ key: 'establishments', label: 'Establishment types' },
{ key: 'leave', label: 'Leave types' },
		{ key: 'loans', label: 'Loan types' },
		{ key: 'remittances', label: 'Employer numbers' },
		{ key: 'clearance', label: 'Clearance items' },
		{ key: 'payroll', label: 'Payroll' },
		{ key: 'costcenters', label: 'Cost centers' },
		{ key: 'contracts', label: 'Contract templates' },
		{ key: 'logo', label: 'Company logo' }
	] as const;
	type Tab = (typeof TABS)[number]['key'];
	// The tab lives in the address (?tab=) so a reload or a shared link lands on the same one.
const tabParam = page.url.searchParams.get('tab');
	let tab = $state<Tab>(tabParam === 'loans' || tabParam === 'leave' || tabParam === 'remittances' || tabParam === 'clearance' || tabParam === 'logo' || tabParam === 'costcenters' || tabParam === 'payroll' || tabParam === 'contracts'
			? tabParam
			: 'establishments');
	function pick(next: Tab) {
		tab = next;
		replaceState(`?tab=${next}`, {});
	}

	// Contract wording: one text per employment type, edited here and saved as a whole.
	let contractKind = $state<string>('probationary');
	// svelte-ignore state_referenced_locally
	let contractDraft = $state<Record<string, string>>({ ...data.contractTemplates });
	const contractCustomised = $derived(contractDraft[contractKind] !== data.contractDefaults[contractKind as keyof typeof data.contractDefaults]);
	const contractUnknown = $derived(
		[...(contractDraft[contractKind] ?? '').matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)]
			.map((m) => m[1]!)
			.filter((f) => !data.contractFields.some(([k]) => k === f))
	);
	let adding = $state(false);
	// Editable copy of the default clearance checklist; saved as a whole.
	// svelte-ignore state_referenced_locally
	let clearance = $state<string[]>([...data.clearanceItems]);
	function moveClearance(i: number, by: -1 | 1) {
		const next = [...clearance];
		[next[i], next[i + by]] = [next[i + by]!, next[i]!];
		clearance = next;
	}
	let editingId = $state<string | null>(null);
type LeaveType = PageData['leaveTypes'][number];
	let editingLeave = $state<LeaveType | 'new' | null>(null);
	let deletingLeave = $state<LeaveType | null>(null);
	const blankLeave: LeaveType = {
		id: '', code: '', name: '', description: '', statutory: false, paid: true, daysPerYear: 0,
		dayCount: 'working', minServiceMonths: 0, employmentTypes: [], sexRestriction: null,
		halfDayAllowed: false, carryOverDays: 0, cashConvertible: false, requiresDocument: false, active: true
	};
	const leaveDraft = $derived(editingLeave === 'new' || editingLeave === null ? blankLeave : editingLeave);
	function leaveRule(t: LeaveType): string {
		const bits: string[] = [];
		bits.push(t.daysPerYear > 0 ? `${t.daysPerYear} ${t.dayCount === 'calendar' ? 'calendar' : 'working'} days` : 'No fixed allowance');
		if (t.minServiceMonths) bits.push(`after ${t.minServiceMonths} mo`);
		if (t.employmentTypes.length) bits.push(t.employmentTypes.map((e) => e.replace('_', '-')).join(', '));
		if (t.sexRestriction) bits.push(`${t.sexRestriction} only`);
		return bits.join(' · ');
	}
	let addingEst = $state(false);
	let editingEstId = $state<string | null>(null);
	let busy = $state(false);
	const editingEst = $derived(data.establishmentTypes.find((t) => t.id === editingEstId) ?? null);
	const editing = $derived(data.loanTypes.find((t) => t.id === editingId) ?? null);
	const remitLabel = (v: string) => data.remitOptions.find((o) => o.value === v)?.label ?? v;
	const selectClass =
		'h-10 w-full rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

	$effect(() => {
		if (form && 'error' in form && form.error) toast.error(form.error);
		else if (form && 'ok' in form && form.ok) {
			toast.success(form.ok);
			adding = false;
			editingId = null;
addingEst = false;
editingEstId = null;
editingLeave = null;
deletingLeave = null;
}
	});

	function submit() {
		busy = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = false;
		};
	}
</script>

<svelte:head><title>Settings · HR</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
	<h1 class="text-5xl font-light tracking-tight">Settings</h1>

	<div class="flex flex-wrap gap-2" role="tablist" aria-label="Settings">
		{#each TABS as t (t.key)}
			<button
				type="button"
				role="tab"
				id="tab-{t.key}"
				aria-selected={tab === t.key}
				aria-controls="panel-{t.key}"
				class="rounded-full px-5 py-2 text-sm font-medium transition-colors {tab === t.key
					? 'bg-ink text-white'
					: 'bg-ink/10 text-ink hover:bg-ink/15'}"
				onclick={() => pick(t.key)}>{t.label}</button
			>
		{/each}
	</div>

	{#if tab === 'establishments'}
	<div id="panel-establishments" role="tabpanel" aria-labelledby="tab-establishments" class="panel space-y-5 p-5 md:p-6" aria-label="Establishment types">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="max-w-2xl">
				<h2 class="text-2xl font-light">Establishment types</h2>
				<p class="mt-1 text-sm text-ink-muted">
					The kinds of establishment you run — Hotel, Restaurant, Retail and so on. Choose one when you add an
					establishment. Only a type marked as linking to the hotel app carries a hotel reference.
				</p>
			</div>
			<Button variant="gold" onclick={() => (addingEst = true)}><PlusIcon /> Add type</Button>
		</div>

		<Table.Root>
			<Table.Header>
				<Table.Row class="hover:bg-transparent">
					<Table.Head>Name</Table.Head>
					<Table.Head>Hotel app link</Table.Head>
					<Table.Head class="text-right">Establishments</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head class="w-24"><span class="sr-only">Actions</span></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.establishmentTypes as t (t.id)}
					<Table.Row>
						<Table.Cell class="font-medium">{t.name}</Table.Cell>
						<Table.Cell>{t.linksToHotelApp ? 'Links to the hotel app' : 'HR only'}</Table.Cell>
						<Table.Cell class="text-right tabular-nums">{t.establishmentCount}</Table.Cell>
						<Table.Cell>
							<Badge variant={t.active ? 'ok' : 'muted'}>
								<span class="size-1.5 rounded-full bg-current opacity-70"></span>
								{t.active ? 'In use' : 'Retired'}
							</Badge>
						</Table.Cell>
						<Table.Cell class="text-right">
							<Button variant="outline" size="sm" onclick={() => (editingEstId = t.id)}>Edit</Button>
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
{:else if tab === 'loans'}
<div id="panel-loans" role="tabpanel" aria-labelledby="tab-loans" class="panel space-y-5 p-5 md:p-6" aria-label="Loan types">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="max-w-2xl">
				<h2 class="text-2xl font-light">Loan types</h2>
				<p class="mt-1 text-sm text-ink-muted">
					The kinds of loan you can record under Loans. Each type says where its deductions are remitted;
					a type that is not remitted is deducted from pay only.
				</p>
			</div>
			<Button variant="gold" onclick={() => (adding = true)}><PlusIcon /> Add loan type</Button>
		</div>

		<Table.Root>
			<Table.Header>
				<Table.Row class="hover:bg-transparent">
					<Table.Head>Name</Table.Head>
					<Table.Head>Remitted to</Table.Head>
					<Table.Head class="text-right">Loans</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head class="w-24"><span class="sr-only">Actions</span></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.loanTypes as t (t.id)}
					<Table.Row>
						<Table.Cell class="font-medium">{t.name}</Table.Cell>
						<Table.Cell>{remitLabel(t.remitTo)}</Table.Cell>
						<Table.Cell class="text-right tabular-nums">{t.loanCount}</Table.Cell>
						<Table.Cell>
							<Badge variant={t.active ? 'ok' : 'muted'}>
								<span class="size-1.5 rounded-full bg-current opacity-70"></span>
								{t.active ? 'In use' : 'Retired'}
							</Badge>
						</Table.Cell>
						<Table.Cell class="text-right">
							<Button variant="outline" size="sm" onclick={() => (editingId = t.id)}>Edit</Button>
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
</div>
{:else if tab === 'remittances'}
	<div id="panel-remittances" role="tabpanel" aria-labelledby="tab-remittances" class="panel space-y-5 p-5 md:p-6" aria-label="Employer numbers and deadlines">
		<div class="max-w-2xl">
			<h2 class="text-2xl font-light">Employer numbers and deadlines</h2>
			<p class="mt-1 text-sm text-ink-muted">
				Your employer numbers and the day each remittance is due. A deadline is "day N of the month after the pay
				month". Leave blank to show no due date — none is assumed. Used on the Remittances page.
			</p>
		</div>
		<form method="POST" action="?/saveRemittance" use:enhance={submit} class="grid gap-3 sm:grid-cols-2">
				<div>
					<Label for="sssNo">SSS employer no.</Label>
					<Input id="sssNo" name="sssNo" value={data.remittance.employerIds.sss ?? ''} class="mt-1" />
				</div>
				<div>
					<Label for="dueSss">SSS due day</Label>
					<Input id="dueSss" name="dueSss" type="number" min="1" max="31" value={data.remittance.dueDay.sss ?? ''} class="mt-1" />
				</div>
				<div>
					<Label for="philhealthNo">PhilHealth employer no.</Label>
					<Input id="philhealthNo" name="philhealthNo" value={data.remittance.employerIds.philhealth ?? ''} class="mt-1" />
				</div>
				<div>
					<Label for="duePhilhealth">PhilHealth due day</Label>
					<Input id="duePhilhealth" name="duePhilhealth" type="number" min="1" max="31" value={data.remittance.dueDay.philhealth ?? ''} class="mt-1" />
				</div>
				<div>
					<Label for="pagibigNo">Pag-IBIG employer no.</Label>
					<Input id="pagibigNo" name="pagibigNo" value={data.remittance.employerIds.pagibig ?? ''} class="mt-1" />
				</div>
				<div>
					<Label for="duePagibig">Pag-IBIG due day</Label>
					<Input id="duePagibig" name="duePagibig" type="number" min="1" max="31" value={data.remittance.dueDay.pagibig ?? ''} class="mt-1" />
				</div>
				<div>
					<Label for="dueSssLoan">SSS loans due day</Label>
					<Input id="dueSssLoan" name="dueSssLoan" type="number" min="1" max="31" value={data.remittance.dueDay.sss_loan ?? ''} class="mt-1" />
				</div>
				<div>
					<Label for="duePagibigLoan">Pag-IBIG loans due day</Label>
					<Input id="duePagibigLoan" name="duePagibigLoan" type="number" min="1" max="31" value={data.remittance.dueDay.pagibig_loan ?? ''} class="mt-1" />
				</div>
				<div>
					<Label for="dueBir">BIR due day</Label>
					<Input id="dueBir" name="dueBir" type="number" min="1" max="31" value={data.remittance.dueDay.bir ?? ''} class="mt-1" />
				</div>
			<div class="sm:col-span-2">
				<Button type="submit" variant="outline" disabled={busy}>Save</Button>
			</div>
		</form>
	</div>
{:else if tab === 'contracts'}
	<div id="panel-contracts" role="tabpanel" aria-labelledby="tab-contracts" class="panel space-y-5 p-5 md:p-6" aria-label="Contract templates">
		<div class="max-w-2xl">
			<h2 class="text-2xl font-light">Contract templates</h2>
			<p class="mt-1 text-sm text-ink-muted">
				The wording used when a contract is generated for each employment type. A change applies to contracts issued
				from now on; a contract already issued keeps the wording it was issued with. The default text is a starting
				point: have it reviewed by your lawyer before you use it.
			</p>
		</div>
		<div class="flex flex-wrap gap-2" role="group" aria-label="Employment type">
			{#each data.contractKinds as k (k.value)}
				<button
					type="button"
					aria-pressed={contractKind === k.value}
					class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors {contractKind === k.value
						? 'bg-ink text-white'
						: 'bg-ink/10 text-ink hover:bg-ink/15'}"
					onclick={() => (contractKind = k.value)}>{k.label}</button
				>
			{/each}
		</div>
		<form method="POST" action="?/saveContractTemplate" use:enhance={submit} class="space-y-3">
			<input type="hidden" name="kind" value={contractKind} />
			<Textarea
				name="text"
				rows={22}
				bind:value={contractDraft[contractKind]}
				aria-label="Contract wording"
				class="font-mono text-xs leading-relaxed"
			/>
			{#if contractUnknown.length > 0}
				<p class="text-sm text-danger">Unknown field: {contractUnknown.map((f) => `{{${f}}}`).join(', ')}</p>
			{/if}
			<div class="flex flex-wrap items-center gap-2">
				<Button type="submit" variant="gold" disabled={busy || contractUnknown.length > 0}>Save wording</Button>
				{#if contractCustomised}
					<Button
						type="button"
						variant="ghost"
						onclick={() => (contractDraft[contractKind] = data.contractDefaults[contractKind as keyof typeof data.contractDefaults])}
					>
						Restore default text
					</Button>
				{/if}
			</div>
		</form>
		<div>
			<p class="text-sm font-medium">Fields you can use</p>
			<ul class="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
				{#each data.contractFields as [k, label] (k)}
					<li><code class="rounded bg-ink/10 px-1 text-xs">{`{{${k}}}`}</code> <span class="text-ink-muted">{label}</span></li>
				{/each}
			</ul>
		</div>
	</div>
{:else if tab === 'costcenters'}
	<div id="panel-costcenters" role="tabpanel" aria-labelledby="tab-costcenters" class="panel space-y-5 p-5 md:p-6" aria-label="Cost centers">
		<div class="max-w-2xl">
			<h2 class="text-2xl font-light">Cost centers</h2>
			<p class="mt-1 text-sm text-ink-muted">
				What a person's pay is charged to, one per employee. Pick one on the employee's form; payroll reports cost by
				cost center as well as by establishment. A cost center in use is deactivated, not deleted. Renaming a
				code updates the people who hold it; payslips already built keep the code they had.
			</p>
		</div>
		<form method="POST" action="?/saveCostCenter" use:enhance={submit} class="flex flex-wrap items-end gap-3">
			<div class="space-y-1.5">
				<Label for="cc-code">Code</Label>
				<Input id="cc-code" name="code" maxlength={30} required placeholder="FO-01" class="w-36" />
			</div>
			<div class="min-w-48 flex-1 space-y-1.5">
				<Label for="cc-name">Name</Label>
				<Input id="cc-name" name="name" maxlength={80} required placeholder="Front office" />
			</div>
			<Button type="submit" variant="gold" disabled={busy}><PlusIcon /> Add</Button>
		</form>
		{#if data.costCenters.length === 0}
			<p class="rounded-lg border border-dashed border-ink/30 px-4 py-3 text-sm text-ink-muted">No cost centers yet.</p>
		{:else}
			<ul class="divide-y divide-dotted divide-ink/25">
				{#each data.costCenters as cc (cc.id)}
					<li class="flex flex-wrap items-end gap-3 py-3 {cc.active ? '' : 'opacity-60'}">
						<form method="POST" action="?/saveCostCenter" use:enhance={submit} class="flex flex-1 flex-wrap items-end gap-3">
							<input type="hidden" name="id" value={cc.id} />
							<Input name="code" value={cc.code} maxlength={30} required aria-label="Code" class="w-36" />
							<Input name="name" value={cc.name} maxlength={80} required aria-label="Name" class="min-w-48 flex-1" />
							<span class="w-24 text-sm text-ink-muted tabular-nums">{cc.people} {cc.people === 1 ? 'person' : 'people'}</span>
							<Button type="submit" variant="outline" size="sm" disabled={busy}>Save</Button>
						</form>
						<form method="POST" action="?/toggleCostCenter" use:enhance={submit}>
							<input type="hidden" name="id" value={cc.id} />
							<input type="hidden" name="active" value={cc.active ? 'false' : 'true'} />
							<Button type="submit" variant="ghost" size="sm" disabled={busy}>{cc.active ? 'Deactivate' : 'Activate'}</Button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{:else if tab === 'logo'}
	<div id="panel-logo" role="tabpanel" aria-labelledby="tab-logo" class="panel space-y-5 p-5 md:p-6" aria-label="Company logo">
		<div class="max-w-2xl">
			<h2 class="text-2xl font-light">Company logo</h2>
			<p class="mt-1 text-sm text-ink-muted">
				Shown in the sidebar, on the sign-in page and in the header of printed payslips, payroll registers, bonus
				slips, loan statements and final pay. PNG, JPEG or WebP, up to 2 MB. A transparent PNG prints best.
			</p>
		</div>
		{#if data.logoUrl}
			<div class="inline-flex rounded-2xl border border-dashed border-ink/30 bg-white p-4">
				<img src={data.logoUrl} alt="Current company logo" class="h-20 w-auto max-w-72 object-contain" />
			</div>
		{:else}
			<p class="rounded-lg border border-dashed border-ink/30 px-4 py-3 text-sm text-ink-muted">No logo yet. The sidebar shows "HR".</p>
		{/if}
		<form method="POST" action="?/uploadLogo" enctype="multipart/form-data" use:enhance={submit} class="flex flex-wrap items-end gap-3">
			<div class="space-y-1.5">
				<Label for="logo">{data.logoUrl ? 'Replace logo' : 'Upload logo'}</Label>
				<Input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" required />
			</div>
			<Button type="submit" variant="gold" disabled={busy}>Save logo</Button>
		</form>
		{#if data.logoUrl}
			<form method="POST" action="?/removeLogo" use:enhance={submit}>
				<Button type="submit" variant="ghost" disabled={busy}>Remove logo</Button>
			</form>
		{/if}
	</div>
{:else if tab === 'clearance'}
	<div id="panel-clearance" role="tabpanel" aria-labelledby="tab-clearance" class="panel space-y-5 p-5 md:p-6" aria-label="Clearance items">
		<div class="max-w-2xl">
			<h2 class="text-2xl font-light">Clearance items</h2>
			<p class="mt-1 text-sm text-ink-muted">
				The checklist every new separation starts with. A change applies to separations started after you save;
				ones already in process keep the list they have (you can still add an item to a single separation).
			</p>
		</div>
		<form method="POST" action="?/saveClearance" use:enhance={submit} class="space-y-3">
			{#if clearance.length === 0}
				<p class="rounded-lg border border-dashed border-ink/30 px-4 py-3 text-sm text-ink-muted">
					No items — a separation can be cleared as soon as the money and loans are settled.
				</p>
			{/if}
			<ol class="space-y-2">
				{#each clearance as _, i (i)}
					<li class="flex items-center gap-2">
						<span class="w-6 text-right text-sm text-ink-muted tabular-nums">{i + 1}</span>
						<Input name="item" maxlength={120} bind:value={clearance[i]} aria-label="Item {i + 1}" class="flex-1" />
						<Button type="button" variant="ghost" size="icon-sm" aria-label="Move up" disabled={i === 0} onclick={() => moveClearance(i, -1)}>
							<ArrowUpIcon />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Move down"
							disabled={i === clearance.length - 1}
							onclick={() => moveClearance(i, 1)}
						>
							<ArrowDownIcon />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Remove item {i + 1}"
							onclick={() => (clearance = clearance.filter((_, k) => k !== i))}
						>
							<Trash2Icon />
						</Button>
					</li>
				{/each}
			</ol>
			<div class="flex flex-wrap items-center gap-2 pt-2">
				<Button
					type="button"
					variant="outline"
					disabled={clearance.length >= data.maxClearanceItems}
					onclick={() => (clearance = [...clearance, ''])}
				>
					<PlusIcon /> Add item
				</Button>
				<Button type="button" variant="ghost" onclick={() => (clearance = [...data.clearanceDefaults])}>Restore defaults</Button>
				<Button type="submit" variant="gold" class="ml-auto" disabled={busy}>Save</Button>
			</div>
		</form>
	</div>
{:else if tab === 'payroll'}
	<div id="panel-payroll" role="tabpanel" aria-labelledby="tab-payroll" class="panel space-y-5 p-5 md:p-6" aria-label="Payroll">
		<div class="max-w-2xl">
			<h2 class="text-2xl font-light">Working-day factor</h2>
			<p class="mt-1 text-sm text-ink-muted">
				Turns a monthly rate into a daily one (rate × 12 ÷ factor), which sets what an absence costs and the hourly
				rate for overtime. It is a company policy, so there is no default —
				{#if data.dayFactor}currently <strong class="font-medium text-ink">{data.dayFactor}</strong>.{:else}choose one
					before creating a payroll run.{/if}
			</p>
		</div>
		<form method="POST" action="?/saveDayFactor" use:enhance={submit} class="flex flex-wrap items-end gap-2">
			<div class="min-w-64 flex-1">
				<Label for="dayFactor">Days a year</Label>
				<select id="dayFactor" name="dayFactor" class={selectClass + ' mt-1'} required>
					{#if !data.dayFactor}<option value="" disabled selected>Choose…</option>{/if}
					{#each data.factors as f (f.value)}
						<option value={f.value} selected={data.dayFactor === f.value}>{f.label}</option>
					{/each}
				</select>
			</div>
			<Button type="submit" variant="outline" disabled={busy}>Save</Button>
		</form>
	</div>
{:else}
<div id="panel-leave" role="tabpanel" aria-labelledby="tab-leave" class="panel space-y-5 p-5 md:p-6" aria-label="Leave types">
<div class="flex flex-wrap items-start justify-between gap-3">
<div class="max-w-2xl">
<h2 class="text-2xl font-light">Leave types</h2>
<p class="mt-1 text-sm text-ink-muted">
The leave rules for the whole company. Every establishment files leave under this list and can only
read it. A change applies to new requests; leave already approved keeps what it was filed with.
Statutory leaves follow Philippine law as commonly summarised — check them with DOLE or counsel.
</p>
</div>
<div class="flex gap-2">
<form method="POST" action="?/restoreLeaveDefaults" use:enhance={submit} class="contents">
<Button type="submit" variant="outline" disabled={busy}>Restore legal defaults</Button>
</form>
<Button variant="gold" onclick={() => (editingLeave = 'new')}><PlusIcon /> Add leave</Button>
</div>
</div>
<Table.Root>
<Table.Header>
<Table.Row class="hover:bg-transparent">
<Table.Head>Leave</Table.Head>
<Table.Head>Rule</Table.Head>
<Table.Head>Pay</Table.Head>
<Table.Head>Status</Table.Head>
<Table.Head class="w-24"><span class="sr-only">Actions</span></Table.Head>
</Table.Row>
</Table.Header>
<Table.Body>
{#each data.leaveTypes as t (t.id)}
<Table.Row class={t.active ? '' : 'text-ink-muted'}>
<Table.Cell>
<span class="font-mono text-xs">{t.code}</span>
<span class="ml-1 font-medium">{t.name}</span>
{#if t.statutory}<Badge variant="muted" class="ml-1">Statutory</Badge>{/if}
</Table.Cell>
<Table.Cell class="text-sm">{leaveRule(t)}</Table.Cell>
<Table.Cell>{t.paid ? 'Paid' : 'Unpaid'}</Table.Cell>
<Table.Cell>
<Badge variant={t.active ? 'ok' : 'muted'}>
<span class="size-1.5 rounded-full bg-current opacity-70"></span>
{t.active ? 'In use' : 'Off'}
</Badge>
</Table.Cell>
<Table.Cell class="text-right whitespace-nowrap">
<Button variant="ghost" size="icon-sm" aria-label="Edit {t.name}" onclick={() => (editingLeave = t)}>
<PencilIcon />
</Button>
{#if !t.statutory}
<Button variant="ghost" size="icon-sm" aria-label="Delete {t.name}" onclick={() => (deletingLeave = t)}>
<Trash2Icon />
</Button>
{/if}
</Table.Cell>
</Table.Row>
{/each}
</Table.Body>
</Table.Root>
</div>
{/if}
</div>

<Dialog.Root open={adding} onOpenChange={(o) => (adding = o)}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="font-display text-2xl font-light">Add loan type</Dialog.Title>
			<Dialog.Description>It appears in the New loan form straight away.</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/createType" use:enhance={submit} class="space-y-3">
			<div class="space-y-1.5">
				<Label for="newName">Name</Label>
				<Input id="newName" name="name" maxlength={80} required />
			</div>
			<div class="space-y-1.5">
				<Label for="newRemit">Remitted to</Label>
				<select id="newRemit" name="remitTo" class={selectClass}>
					{#each data.remitOptions as o (o.value)}<option value={o.value} selected={o.value === 'none'}>{o.label}</option>{/each}
				</select>
			</div>
			<Dialog.Footer class="gap-2 pt-1">
				<Button type="button" variant="outline" onclick={() => (adding = false)}>Cancel</Button>
				<Button type="submit" disabled={busy}>Add</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={editing !== null} onOpenChange={(o) => !o && (editingId = null)}>
	<Dialog.Content class="sm:max-w-md">
		{#if editing}
			<Dialog.Header>
				<Dialog.Title class="font-display text-2xl font-light">{editing.name}</Dialog.Title>
				<Dialog.Description>
					{editing.loanCount} {editing.loanCount === 1 ? 'loan uses' : 'loans use'} this type. Changing where it is
					remitted affects payslips generated from now on, not ones already locked.
				</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/updateType" use:enhance={submit} class="space-y-3">
				<input type="hidden" name="id" value={editing.id} />
				<div class="space-y-1.5">
					<Label for="editName">Name</Label>
					<Input id="editName" name="name" maxlength={80} value={editing.name} required />
				</div>
				<div class="space-y-1.5">
					<Label for="editRemit">Remitted to</Label>
					<select id="editRemit" name="remitTo" class={selectClass}>
						{#each data.remitOptions as o (o.value)}<option value={o.value} selected={o.value === editing.remitTo}>{o.label}</option>{/each}
					</select>
				</div>
				<div class="space-y-1.5">
					<Label for="editActive">Status</Label>
					<select id="editActive" name="active" class={selectClass}>
						<option value="true" selected={editing.active}>In use — can be chosen for new loans</option>
						<option value="false" selected={!editing.active}>Retired — kept on existing loans only</option>
					</select>
				</div>
				<Dialog.Footer class="gap-2 pt-1">
					<Button type="button" variant="outline" onclick={() => (editingId = null)}>Cancel</Button>
					<Button type="submit" disabled={busy}>Save</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={addingEst} onOpenChange={(o) => (addingEst = o)}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="font-display text-2xl font-light">Add establishment type</Dialog.Title>
			<Dialog.Description>It appears in the Add establishment form straight away.</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/createEstType" use:enhance={submit} class="space-y-3">
			<div class="space-y-1.5">
				<Label for="estTypeName">Name</Label>
				<Input id="estTypeName" name="name" maxlength={60} required />
			</div>
			<label class="flex items-start gap-2 text-sm">
				<input type="checkbox" name="linksToHotelApp" class="mt-0.5 size-4 accent-black" />
				<span>
					Links to the hotel app
					<span class="block text-xs text-ink-muted">
						For a hotel that is also set up in the hotel app. It cannot be changed later.
					</span>
				</span>
			</label>
			<Dialog.Footer class="gap-2 pt-1">
				<Button type="button" variant="outline" onclick={() => (addingEst = false)}>Cancel</Button>
				<Button type="submit" disabled={busy}>Add</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={editingEst !== null} onOpenChange={(o) => !o && (editingEstId = null)}>
	<Dialog.Content class="sm:max-w-md">
		{#if editingEst}
			<Dialog.Header>
				<Dialog.Title class="font-display text-2xl font-light">{editingEst.name}</Dialog.Title>
				<Dialog.Description>
					{editingEst.establishmentCount}
					{editingEst.establishmentCount === 1 ? 'establishment uses' : 'establishments use'} this type. Retiring it
					only hides it from the Add form.
				</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/updateEstType" use:enhance={submit} class="space-y-3">
				<input type="hidden" name="id" value={editingEst.id} />
				<div class="space-y-1.5">
					<Label for="estEditName">Name</Label>
					<Input id="estEditName" name="name" maxlength={60} value={editingEst.name} required />
				</div>
				<div class="space-y-1.5">
					<Label for="estEditActive">Status</Label>
					<select id="estEditActive" name="active" class={selectClass}>
						<option value="true" selected={editingEst.active}>In use — can be chosen for new establishments</option>
						<option value="false" selected={!editingEst.active}>Retired — kept on existing establishments only</option>
					</select>
				</div>
				<Dialog.Footer class="gap-2 pt-1">
					<Button type="button" variant="outline" onclick={() => (editingEstId = null)}>Cancel</Button>
					<Button type="submit" disabled={busy}>Save</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={editingLeave !== null} onOpenChange={(o) => !o && (editingLeave = null)}>
	<Dialog.Content class="flex max-h-[90vh] flex-col sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title class="font-display text-2xl font-light">
				{editingLeave === 'new' ? 'Add leave' : `Edit ${leaveDraft.name}`}
			</Dialog.Title>
			{#if leaveDraft.description}<Dialog.Description>{leaveDraft.description}</Dialog.Description>{/if}
		</Dialog.Header>
		{#key editingLeave === 'new' ? 'new' : leaveDraft.id}
			<form method="POST" action="?/saveLeaveType" use:enhance={submit} class="flex min-h-0 flex-1 flex-col gap-3">
				<input type="hidden" name="id" value={leaveDraft.id} />
				<div class="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
					<div class="grid gap-3 sm:grid-cols-[8rem_1fr]">
						<div class="space-y-1.5">
							<Label for="ltCode">Code</Label>
							<Input id="ltCode" name="code" value={leaveDraft.code} class="font-mono uppercase" required maxlength={8} />
						</div>
						<div class="space-y-1.5">
							<Label for="ltName">Name</Label>
							<Input id="ltName" name="name" value={leaveDraft.name} required />
						</div>
					</div>
					<div class="space-y-1.5">
						<Label for="ltDesc">Notes</Label>
						<Textarea id="ltDesc" name="description" value={leaveDraft.description} rows={2} />
					</div>
					<div class="grid gap-3 sm:grid-cols-3">
						<div class="space-y-1.5">
							<Label for="ltDays">Days per year</Label>
							<Input id="ltDays" name="daysPerYear" type="number" min="0" step="0.5" value={leaveDraft.daysPerYear} />
							<p class="text-xs text-ink-muted">0 = no fixed allowance</p>
						</div>
						<div class="space-y-1.5">
							<Label for="ltCount">Days counted as</Label>
							<select id="ltCount" name="dayCount" class={selectClass}>
								<option value="working" selected={leaveDraft.dayCount === 'working'}>Working days</option>
								<option value="calendar" selected={leaveDraft.dayCount === 'calendar'}>Calendar days</option>
							</select>
						</div>
						<div class="space-y-1.5">
							<Label for="ltTenure">Months of service</Label>
							<Input id="ltTenure" name="minServiceMonths" type="number" min="0" value={leaveDraft.minServiceMonths} />
						</div>
					</div>
					<div class="grid gap-3 sm:grid-cols-2">
						<div class="space-y-1.5">
							<Label for="ltSex">Open to</Label>
							<select id="ltSex" name="sexRestriction" class={selectClass}>
								<option value="" selected={!leaveDraft.sexRestriction}>Everyone</option>
								<option value="female" selected={leaveDraft.sexRestriction === 'female'}>Female employees</option>
								<option value="male" selected={leaveDraft.sexRestriction === 'male'}>Male employees</option>
							</select>
						</div>
						<div class="space-y-1.5">
							<Label for="ltCarry">Carry over to next year (days)</Label>
							<Input id="ltCarry" name="carryOverDays" type="number" min="0" step="0.5" value={leaveDraft.carryOverDays} />
						</div>
					</div>
					<fieldset>
						<legend class="text-sm font-medium">Employment types allowed</legend>
						<p class="text-xs text-ink-muted">Leave all unticked for everyone.</p>
						<div class="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
							{#each EMPLOYMENT_TYPES as e (e)}
								<label class="flex items-center gap-1.5 text-sm">
									<input type="checkbox" name="employmentTypes" value={e} checked={leaveDraft.employmentTypes.includes(e)} class="size-4 accent-black" />
									{EMPLOYMENT_TYPE_LABEL[e]}
								</label>
							{/each}
						</div>
					</fieldset>
					<div class="grid gap-2 sm:grid-cols-2">
						{#each [['paid', 'Paid leave', leaveDraft.paid], ['halfDayAllowed', 'Can be taken as a half day', leaveDraft.halfDayAllowed], ['cashConvertible', 'Unused days convertible to cash', leaveDraft.cashConvertible], ['requiresDocument', 'Needs a supporting document', leaveDraft.requiresDocument], ['active', 'In use (employees can file it)', leaveDraft.active]] as const as [name, label, on] (name)}
							<label class="flex items-center gap-2 text-sm">
								<input type="checkbox" {name} checked={on} class="size-4 accent-black" />
								{label}
							</label>
						{/each}
					</div>
				</div>
				<Dialog.Footer class="gap-2 pt-1">
					<Button type="button" variant="outline" onclick={() => (editingLeave = null)}>Cancel</Button>
					<Button type="submit" disabled={busy}>{editingLeave === 'new' ? 'Add leave' : 'Save changes'}</Button>
				</Dialog.Footer>
			</form>
		{/key}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={deletingLeave !== null} onOpenChange={(o) => !o && (deletingLeave = null)}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="font-display text-2xl font-light">Delete {deletingLeave?.name}?</Dialog.Title>
			<Dialog.Description>A leave with requests on file can't be deleted; switch it off instead.</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/deleteLeaveType" use:enhance={submit}>
			<input type="hidden" name="id" value={deletingLeave?.id ?? ''} />
			<Dialog.Footer class="gap-2">
				<Button type="button" variant="outline" onclick={() => (deletingLeave = null)}>Keep</Button>
				<Button type="submit" variant="destructive" disabled={busy}>Delete</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
