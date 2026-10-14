<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import UsersIcon from '@lucide/svelte/icons/users';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import UserIcon from '@lucide/svelte/icons/user';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import HashIcon from '@lucide/svelte/icons/hash';
	import BriefcaseIcon from '@lucide/svelte/icons/briefcase';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import CalendarCheckIcon from '@lucide/svelte/icons/calendar-check';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import TagIcon from '@lucide/svelte/icons/tag';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import IdCardIcon from '@lucide/svelte/icons/id-card';
	import LandmarkIcon from '@lucide/svelte/icons/landmark';
	import MailIcon from '@lucide/svelte/icons/mail';
	import FingerprintIcon from '@lucide/svelte/icons/fingerprint';
	import type { ActionData, PageData } from './$types';
	import type { StaffMember } from '$lib/server/hr/assigned';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type EmployeeRow = StaffMember;

	const peso = (centavos: number) => `₱${(centavos / 100).toFixed(2)}`;

	const EMPLOYMENT_TYPES = [
		'regular',
		'probationary',
		'project',
		'seasonal',
		'fixed_term',
		'casual',
		'part_time'
	];
	const STATUSES = ['active', 'on_leave', 'suspended', 'separated'];
	const PAY_BASES = ['monthly', 'daily', 'hourly'];
	const SEXES = ['male', 'female'];
	const DISBURSEMENT_METHODS = ['cash', 'bank', 'ewallet'];

	let createOpen = $state(false);
	let editingEmployee = $state<EmployeeRow | null>(null);
	let adjusting = $state<EmployeeRow | null>(null);
	let adjRate = $state('');
	let adjBasis = $state('monthly');
	let adjDate = $state('');
	let adjBusy = $state(false);

	$effect(() => {
		if (adjusting) {
			adjRate = '';
			adjBasis = adjusting.payBasis;
			adjDate = data.today;
		}
	});

	const adjOld = $derived(adjusting?.baseRateCentavos ?? 0);
	const adjNew = $derived(Math.round((Number(adjRate) || 0) * 100));
	const adjDiff = $derived(adjNew - adjOld);
	const adjHistory = $derived(adjusting ? (data.history[adjusting.id] ?? []) : []);
	const dayLabel = (d: string | Date) =>
		new Date(d).toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' });

	// Independent photo state per dialog — each has its own file input, so a preview
	// picked in one never leaks into the other.
	let createPhotoPreview = $state<string | null>(null);
	let editPhotoPreview = $state<string | null>(null);
	let editPhotoRemoved = $state(false);

	$effect(() => {
		// Re-syncs whenever a different employee is opened for editing (or the dialog
		// closes) — otherwise the previous employee's picked/removed photo state would
		// leak into the next one.
		editPhotoPreview = editingEmployee?.photoUrl ?? null;
		editPhotoRemoved = false;
	});

	function pickPhoto(e: Event, setPreview: (url: string) => void) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (file) setPreview(URL.createObjectURL(file));
	}

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) {
			toast.success(form.ok);
			createOpen = false;
			editingEmployee = null;
		}
	});

	function statusLabel(status: string) {
		return status.replace('_', ' ');
	}
</script>

{#snippet fieldIcon(Icon: typeof UserIcon)}
	<Icon
		class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
	/>
{/snippet}

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
	<div class="flex items-center justify-between gap-4">
		<div>
			<h2 class="text-base font-semibold text-ink">Employees</h2>
			<p class="text-sm text-ink-muted">
				Employee records for scheduling, DTR, and payroll.
			</p>
		</div>
		{#if data.canWrite}
			<Button onclick={() => (createOpen = true)}>
				<PlusIcon class="size-4" /> New employee
			</Button>
		{/if}
	</div>

	<div class="mt-4 overflow-hidden rounded-xl border border-border">
		{#if data.employees.length === 0}
			<div class="flex flex-col items-center gap-2 p-10 text-center">
				<UsersIcon class="size-6 text-ink-muted" />
				<p class="text-sm text-ink-muted">No employees registered yet.</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Name</Table.Head>
						<Table.Head>Employee #</Table.Head>
						<Table.Head>Position</Table.Head>
						<Table.Head>Department</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="text-right">Rate</Table.Head>
						{#if data.canWrite}<Table.Head class="text-right">Edit</Table.Head>{/if}
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.employees as emp (emp.id)}
						<Table.Row>
							<Table.Cell>
								<div class="flex items-center gap-2.5 font-medium text-ink">
									<div
										class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand/10 text-brand"
									>
										{#if emp.photoUrl}
											<img src={emp.photoUrl} alt="" class="size-full object-cover" />
										{:else}
											<UserIcon class="size-4" />
										{/if}
									</div>
									{emp.firstName} {emp.lastName}
								</div>
							</Table.Cell>
							<Table.Cell class="text-ink-muted">{emp.employeeNo}</Table.Cell>
							<Table.Cell class="text-ink-muted">{emp.position}</Table.Cell>
							<Table.Cell class="text-ink-muted">{emp.department || '—'}</Table.Cell>
							<Table.Cell>
								<Badge variant={emp.status === 'active' ? 'default' : 'outline'}>
									{statusLabel(emp.status)}
								</Badge>
							</Table.Cell>
							<Table.Cell class="text-right text-ink">
								{peso(emp.baseRateCentavos)}/{emp.payBasis}
							</Table.Cell>
							{#if data.canWrite}
								<Table.Cell class="text-right">
									<Button
										variant="ghost"
										size="icon"
										aria-label="Edit {emp.firstName} {emp.lastName}"
										onclick={() => (editingEmployee = emp)}
									>
										<PencilIcon class="size-4" />
									</Button>
								</Table.Cell>
							{/if}
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>
</div>

{#snippet employeeFields(emp: StaffMember | null, idPrefix: string)}
	<section class="rounded-xl bg-brand/5 p-4">
		<div class="flex items-center gap-2.5">
			<div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
				<UserIcon class="size-4" />
			</div>
			<div>
				<p class="text-sm font-semibold text-ink">Basic Information</p>
				<p class="text-xs text-ink-muted">Enter the employee's personal details.</p>
			</div>
		</div>
		<div class="mt-4 space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="{idPrefix}employeeNo">Employee #</Label>
					<div class="relative mt-1">
						{@render fieldIcon(HashIcon)}
						<Input
							id="{idPrefix}employeeNo"
							name="employeeNo"
							required
							value={emp?.employeeNo ?? ''}
							class="pl-8"
						/>
					</div>
				</div>
				<div>
					<Label for="{idPrefix}position">Position</Label>
					<div class="relative mt-1">
						{@render fieldIcon(BriefcaseIcon)}
						<Input
							id="{idPrefix}position"
							name="position"
							required
							value={emp?.position ?? ''}
							class="pl-8"
						/>
					</div>
				</div>
			</div>
			<div class="grid grid-cols-3 gap-3">
				<div>
					<Label for="{idPrefix}firstName">First name</Label>
					<div class="relative mt-1">
						{@render fieldIcon(UserIcon)}
						<Input
							id="{idPrefix}firstName"
							name="firstName"
							required
							value={emp?.firstName ?? ''}
							class="pl-8"
						/>
					</div>
				</div>
				<div>
					<Label for="{idPrefix}middleName">Middle name</Label>
					<div class="relative mt-1">
						{@render fieldIcon(UserIcon)}
						<Input
							id="{idPrefix}middleName"
							name="middleName"
							value={emp?.middleName ?? ''}
							class="pl-8"
						/>
					</div>
				</div>
				<div>
					<Label for="{idPrefix}lastName">Last name</Label>
					<div class="relative mt-1">
						{@render fieldIcon(UserIcon)}
						<Input
							id="{idPrefix}lastName"
							name="lastName"
							required
							value={emp?.lastName ?? ''}
							class="pl-8"
						/>
					</div>
				</div>
			</div>
			<div>
				<Label for="{idPrefix}email">Email</Label>
				<div class="relative mt-1">
					{@render fieldIcon(MailIcon)}
					<Input
						id="{idPrefix}email"
						name="email"
						type="email"
						placeholder="For sending payslips"
						value={emp?.email ?? ''}
						class="pl-8"
					/>
				</div>
			</div>
			<div>
				<Label for="{idPrefix}biometricEnrollId">Biometric ID</Label>
				<div class="relative mt-1">
					{@render fieldIcon(FingerprintIcon)}
					<Input
						id="{idPrefix}biometricEnrollId"
						name="biometricEnrollId"
						placeholder="The ID this person has on the time clock"
						value={emp?.biometricEnrollId ?? ''}
						class="pl-8"
					/>
				</div>
				<p class="mt-1 text-xs text-ink-muted">Used to match punches when importing DTR.</p>
			</div>
			<div class="grid grid-cols-3 gap-3">
				<div>
					<Label for="{idPrefix}birthdate">Birthdate</Label>
					<div class="relative mt-1">
						{@render fieldIcon(CalendarIcon)}
						<Input
							id="{idPrefix}birthdate"
							name="birthdate"
							type="date"
							required
							value={emp?.birthdate ?? ''}
							class="pl-8"
						/>
					</div>
				</div>
				<div>
					<Label for="{idPrefix}sex">Sex</Label>
					<Select.Root type="single" name="sex" value={emp?.sex ?? 'male'}>
						<Select.Trigger id="{idPrefix}sex" class="mt-1 w-full capitalize">
							{emp?.sex ?? 'male'}
						</Select.Trigger>
						<Select.Content>
							{#each SEXES as s (s)}
								<Select.Item value={s} label={s} class="capitalize" />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div>
					<Label for="{idPrefix}hiredOn">Hired on</Label>
					<div class="relative mt-1">
						{@render fieldIcon(CalendarCheckIcon)}
						<Input
							id="{idPrefix}hiredOn"
							name="hiredOn"
							type="date"
							required
							value={emp?.hiredOn ?? ''}
							class="pl-8"
						/>
					</div>
				</div>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="{idPrefix}employmentType">Employment type</Label>
					<Select.Root type="single" name="employmentType" value={emp?.employmentType ?? 'regular'}>
						<Select.Trigger id="{idPrefix}employmentType" class="mt-1 w-full capitalize">
							{(emp?.employmentType ?? 'regular').replace('_', ' ')}
						</Select.Trigger>
						<Select.Content>
							{#each EMPLOYMENT_TYPES as t (t)}
								<Select.Item value={t} label={t.replace('_', ' ')} class="capitalize" />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div>
					<Label for="{idPrefix}status">Status</Label>
					<Select.Root type="single" name="status" value={emp?.status ?? 'active'}>
						<Select.Trigger id="{idPrefix}status" class="mt-1 w-full capitalize">
							{(emp?.status ?? 'active').replace('_', ' ')}
						</Select.Trigger>
						<Select.Content>
							{#each STATUSES as s (s)}
								<Select.Item value={s} label={s.replace('_', ' ')} class="capitalize" />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="{idPrefix}department">Department</Label>
					<div class="relative mt-1">
						{@render fieldIcon(Building2Icon)}
						<Input
							id="{idPrefix}department"
							name="department"
							value={emp?.department ?? ''}
							class="pl-8"
						/>
					</div>
				</div>
				<div>
					<Label for="{idPrefix}costCenter">Cost center</Label>
					<div class="relative mt-1">
						{@render fieldIcon(TagIcon)}
						<Input
							id="{idPrefix}costCenter"
							name="costCenter"
							value={emp?.costCenter ?? ''}
							class="pl-8"
						/>
					</div>
				</div>
			</div>
		</div>
	</section>

	<section class="rounded-xl bg-brand/5 p-4">
		<div class="flex items-center gap-2.5">
			<div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
				<WalletIcon class="size-4" />
			</div>
			<div>
				<p class="text-sm font-semibold text-ink">Pay &amp; Disbursement</p>
				<p class="text-xs text-ink-muted">Set the employee's compensation and disbursement method.</p>
			</div>
		</div>
		<div class="mt-4 space-y-3">
			{#if emp}
				<input type="hidden" name="payBasis" value={emp.payBasis} />
				<input type="hidden" name="baseRatePesos" value={(emp.baseRateCentavos / 100).toFixed(2)} />
				<div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/70 px-4 py-3">
					<div>
						<p class="text-xs text-ink-muted">Current salary</p>
						<p class="text-lg font-medium tabular-nums">
							{peso(emp.baseRateCentavos)}
							<span class="text-sm font-normal text-ink-muted">per {emp.payBasis === 'monthly' ? 'month' : emp.payBasis === 'daily' ? 'day' : 'hour'}</span>
						</p>
						{#each (data.history[emp.id] ?? []).slice(0, 1) as last (last.id)}
							<p class="text-xs text-ink-muted">Since {dayLabel(last.effectiveFrom)} · {last.remarks}</p>
						{/each}
					</div>
					{#if data.canWrite}
						<Button
							type="button"
							variant="gold"
							onclick={() => {
								adjusting = emp;
								editingEmployee = null;
							}}>Adjust salary</Button
						>
					{/if}
				</div>
				<p class="text-xs text-ink-muted">
					The salary changes only through Adjust salary, so every movement is kept with its date and remarks.
				</p>
			{:else}
				<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="{idPrefix}payBasis">Pay basis</Label>
					<Select.Root type="single" name="payBasis" value="monthly">
						<Select.Trigger id="{idPrefix}payBasis" class="mt-1 w-full capitalize">
							monthly
						</Select.Trigger>
						<Select.Content>
							{#each PAY_BASES as p (p)}
								<Select.Item value={p} label={p} class="capitalize" />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div>
					<Label for="{idPrefix}baseRatePesos">Base rate (₱)</Label>
					<div class="relative mt-1">
						{@render fieldIcon(WalletIcon)}
						<Input
							id="{idPrefix}baseRatePesos"
							name="baseRatePesos"
							type="number"
							min="0"
							step="0.01"
							required
							value=""
							class="pl-8"
						/>
					</div>
				</div>
			</div>
			{/if}
			<div>
				<Label for="{idPrefix}disbursementMethod">Disbursement method</Label>
				<div class="relative mt-1">
					<Select.Root
						type="single"
						name="disbursementMethod"
						value={(emp?.disbursement as { method?: string } | null)?.method ?? 'cash'}
					>
						<Select.Trigger id="{idPrefix}disbursementMethod" class="w-full pl-8 capitalize">
							{(emp?.disbursement as { method?: string } | null)?.method ?? 'cash'}
						</Select.Trigger>
						<Select.Content>
							{#each DISBURSEMENT_METHODS as m (m)}
								<Select.Item value={m} label={m} class="capitalize" />
							{/each}
						</Select.Content>
					</Select.Root>
					<CreditCardIcon
						class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
					/>
				</div>
			</div>
		</div>
	</section>

	<section class="rounded-xl bg-ok/5 p-4">
		<div class="flex items-center gap-2.5">
			<div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ok/10 text-ok">
				<LandmarkIcon class="size-4" />
			</div>
			<div>
				<p class="text-sm font-semibold text-ink">Government IDs</p>
				<p class="text-xs text-ink-muted">Enter the employee's government identification numbers.</p>
			</div>
		</div>
		<div class="mt-4 grid grid-cols-2 gap-3">
			<div>
				<Label for="{idPrefix}sss">SSS</Label>
				<div class="relative mt-1">
					{@render fieldIcon(IdCardIcon)}
					<Input
						id="{idPrefix}sss"
						name="sss"
						value={(emp?.govIds as { sss?: string } | null)?.sss ?? ''}
						class="pl-8"
					/>
				</div>
			</div>
			<div>
				<Label for="{idPrefix}philhealth">PhilHealth</Label>
				<div class="relative mt-1">
					{@render fieldIcon(IdCardIcon)}
					<Input
						id="{idPrefix}philhealth"
						name="philhealth"
						value={(emp?.govIds as { philhealth?: string } | null)?.philhealth ?? ''}
						class="pl-8"
					/>
				</div>
			</div>
			<div>
				<Label for="{idPrefix}pagibig">Pag-IBIG</Label>
				<div class="relative mt-1">
					{@render fieldIcon(IdCardIcon)}
					<Input
						id="{idPrefix}pagibig"
						name="pagibig"
						value={(emp?.govIds as { pagibig?: string } | null)?.pagibig ?? ''}
						class="pl-8"
					/>
				</div>
			</div>
			<div>
				<Label for="{idPrefix}tin">TIN</Label>
				<div class="relative mt-1">
					{@render fieldIcon(IdCardIcon)}
					<Input
						id="{idPrefix}tin"
						name="tin"
						value={(emp?.govIds as { tin?: string } | null)?.tin ?? ''}
						class="pl-8"
					/>
				</div>
			</div>
		</div>
	</section>

	<section class="rounded-xl bg-ok/5 p-4">
		<div>
			<p class="text-sm font-semibold text-ink">Government coverage</p>
			<p class="text-xs text-ink-muted">
				Everyone is charged all four by default. Untick only when the person is genuinely not covered
				or exempt, and say why.
			</p>
		</div>
		<input type="hidden" name="coverageSubmitted" value="1" />
		<div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
			<label class="flex items-center gap-2">
				<input type="checkbox" name="sssCovered" checked={emp?.sssCovered ?? true} class="size-4" />
				SSS covered
			</label>
			<label class="flex items-center gap-2">
				<input type="checkbox" name="philhealthCovered" checked={emp?.philhealthCovered ?? true} class="size-4" />
				PhilHealth covered
			</label>
			<label class="flex items-center gap-2">
				<input type="checkbox" name="pagibigCovered" checked={emp?.pagibigCovered ?? true} class="size-4" />
				Pag-IBIG covered
			</label>
			<label class="flex items-center gap-2">
				<input type="checkbox" name="withholdingExempt" checked={emp?.withholdingExempt ?? false} class="size-4" />
				Exempt from withholding tax
			</label>
		</div>
		<div class="mt-3 grid grid-cols-3 gap-3">
			{#each [['sssBasePesos', 'SSS base (₱/mo)', 'sss_msc'], ['philhealthBasePesos', 'PhilHealth base (₱/mo)', 'philhealth_base'], ['pagibigBasePesos', 'Pag-IBIG base (₱/mo)', 'pagibig_base']] as [name, label, key] (name)}
				{@const cents = (emp?.statutoryOverrides as Record<string, number> | null)?.[key as string]}
				<div>
					<Label for="{idPrefix}{name}">{label}</Label>
					<Input
						id="{idPrefix}{name}"
						name={name as string}
						type="number"
						step="0.01"
						min="0"
						placeholder="computed"
						value={cents ? (cents / 100).toString() : ''}
						class="mt-1"
					/>
				</div>
			{/each}
		</div>
		<p class="mt-1 text-xs text-ink-muted">
			A base replaces the monthly salary the contribution is computed on; the rate still applies.
		</p>
		<div class="mt-3">
			<Label for="{idPrefix}coverageNote">Reason</Label>
			<Input
				id="{idPrefix}coverageNote"
				name="coverageNote"
				value={emp?.coverageNote ?? ''}
				placeholder="e.g. minimum-wage earner; contributes through another employer"
				class="mt-1"
			/>
		</div>
	</section>
{/snippet}

<Dialog.Root bind:open={createOpen}>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-2xl!">
		<Dialog.Header>
			<div class="flex items-center gap-3">
				<div class="relative shrink-0">
					<div
						class="flex size-14 items-center justify-center overflow-hidden rounded-full bg-brand/10 text-brand"
					>
						{#if createPhotoPreview}
							<img src={createPhotoPreview} alt="" class="size-full object-cover" />
						{:else}
							<UserIcon class="size-6" />
						{/if}
					</div>
					<label
						class="absolute -bottom-1 -right-1 flex size-6 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-ink-muted shadow-sm hover:text-ink"
					>
						<CameraIcon class="size-3.5" />
						<input
							type="file"
							name="photo"
							form="createEmployeeForm"
							accept="image/jpeg,image/png,image/webp,image/gif"
							class="hidden"
							onchange={(e) => pickPhoto(e, (url) => (createPhotoPreview = url))}
						/>
					</label>
				</div>
				<div>
					<Dialog.Title>New employee</Dialog.Title>
					<Dialog.Description>
						Register an employee record for scheduling, DTR, and payroll.
					</Dialog.Description>
				</div>
			</div>
		</Dialog.Header>
		<form
			id="createEmployeeForm"
			method="POST"
			action="?/create"
			enctype="multipart/form-data"
			use:enhance
			class="space-y-4"
		>
			{@render employeeFields(null, 'create')}
		</form>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (createOpen = false)}>Cancel</Button>
			<Button type="submit" form="createEmployeeForm">
				<PlusIcon class="size-4" /> Create
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root
	open={editingEmployee !== null}
	onOpenChange={(open) => {
		if (!open) editingEmployee = null;
	}}
>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-2xl!">
		{#if editingEmployee}
			{@const emp = editingEmployee}
			<Dialog.Header>
				<div class="flex items-center gap-3">
					<div class="relative shrink-0">
						<div
							class="flex size-14 items-center justify-center overflow-hidden rounded-full bg-brand/10 text-brand"
						>
							{#if editPhotoPreview && !editPhotoRemoved}
								<img src={editPhotoPreview} alt="" class="size-full object-cover" />
							{:else}
								<UserIcon class="size-6" />
							{/if}
						</div>
						<label
							class="absolute -bottom-1 -right-1 flex size-6 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-ink-muted shadow-sm hover:text-ink"
						>
							<CameraIcon class="size-3.5" />
							<input
								type="file"
								name="photo"
								form="editEmployeeForm"
								accept="image/jpeg,image/png,image/webp,image/gif"
								class="hidden"
								onchange={(e) => {
									editPhotoRemoved = false;
									pickPhoto(e, (url) => (editPhotoPreview = url));
								}}
							/>
						</label>
					</div>
					<div>
						<Dialog.Title>Edit {emp.firstName} {emp.lastName}</Dialog.Title>
						{#if (editPhotoPreview && !editPhotoRemoved) || emp.photoUrl}
							<button
								type="button"
								class="text-xs text-danger hover:underline"
								onclick={() => {
									editPhotoPreview = null;
									editPhotoRemoved = true;
								}}
							>
								Remove photo
							</button>
						{/if}
					</div>
				</div>
			</Dialog.Header>
			<form
				id="editEmployeeForm"
				method="POST"
				action="?/update"
				enctype="multipart/form-data"
				use:enhance
				class="space-y-4"
			>
				<input type="hidden" name="employeeId" value={emp.id} />
				<input type="hidden" name="removePhoto" value={editPhotoRemoved} />
				{@render employeeFields(emp, 'edit')}
			</form>
			<Dialog.Footer class="justify-between">
				<form method="POST" action="?/archive" use:enhance>
					<input type="hidden" name="employeeId" value={emp.id} />
					<Button variant="destructive" type="submit">Archive</Button>
				</form>
				<div class="flex gap-2">
					<Button variant="outline" onclick={() => (editingEmployee = null)}>Cancel</Button>
					<Button type="submit" form="editEmployeeForm">Save</Button>
				</div>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root
	open={adjusting !== null}
	onOpenChange={(o) => {
		if (!o) adjusting = null;
	}}
>
	<Dialog.Content class="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-xl!">
		{#if adjusting}
			{@const emp = adjusting}
			<Dialog.Header class="bg-gold px-7 py-5 pr-14 text-ink">
				<Dialog.Title class="font-display text-2xl font-light">Adjust salary</Dialog.Title>
				<Dialog.Description class="text-ink/70">
					{emp.firstName} {emp.lastName} · now {peso(emp.baseRateCentavos)} per {emp.payBasis === 'monthly' ? 'month' : emp.payBasis === 'daily' ? 'day' : 'hour'}
				</Dialog.Description>
			</Dialog.Header>

			<div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-7 py-6">
				<div class="space-y-1.5">
					<p class="text-sm font-medium">Salary history</p>
					<ul class="max-h-44 space-y-1 overflow-y-auto text-sm">
						{#each adjHistory as h (h.id)}
							<li class="rounded-xl px-3 py-2 tabular-nums {h.isCurrent ? 'bg-gold-soft' : 'bg-white/70'}">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<span class="flex flex-wrap items-center gap-2">
										<span class="font-medium">{dayLabel(h.effectiveFrom)}</span>
										{#if h.isCurrent}<Badge variant="gold">Current</Badge>{/if}
										{#if h.isFuture}<Badge variant="muted">Upcoming</Badge>{/if}
									</span>
									<span>
										{#if h.previousRateCentavos !== null}
											<span class="text-ink-muted">{peso(h.previousRateCentavos)} →</span>
										{/if}
										<span class="font-medium">{peso(h.baseRateCentavos)}</span>
										{#if h.change !== null && h.change !== 0}
											<span class="text-xs {h.change > 0 ? 'text-ink' : 'text-danger'}">
												{h.change > 0 ? '+' : '−'}{peso(Math.abs(h.change))}{h.percent !== null
													? ` (${h.percent > 0 ? '+' : ''}${h.percent.toFixed(1)}%)`
													: ''}
											</span>
										{/if}
									</span>
								</div>
								<p class="text-xs text-ink-muted">{h.remarks}{h.by ? ` · ${h.by}` : ''}</p>
							</li>
						{/each}
					</ul>
				</div>

				<form
					id="adjustSalaryForm"
					method="POST"
					action="?/adjustSalary"
					class="space-y-3 border-t border-dotted border-ink/20 pt-4"
					use:enhance={() => {
						adjBusy = true;
						return async ({ result, update }) => {
							await update({ reset: false });
							adjBusy = false;
							if (result.type === 'success') adjusting = null;
						};
					}}
				>
					<input type="hidden" name="employeeId" value={emp.id} />
					<div class="grid grid-cols-2 gap-3">
						<div class="space-y-1.5">
							<Label for="adjRate">New rate (₱)</Label>
							<Input id="adjRate" name="rate" type="number" min="0.01" step="0.01" bind:value={adjRate} required />
						</div>
						<div class="space-y-1.5">
							<Label for="adjBasis">Pay basis</Label>
							<select
								id="adjBasis"
								name="payBasis"
								bind:value={adjBasis}
								class="h-10 w-full rounded-full border border-transparent bg-white px-4 text-sm capitalize shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
							>
								{#each PAY_BASES as b (b)}<option value={b}>{b}</option>{/each}
							</select>
						</div>
						<div class="space-y-1.5">
							<Label for="adjDate">Effective date</Label>
							<Input id="adjDate" name="effectiveFrom" type="date" bind:value={adjDate} min={emp.hiredOn} required />
						</div>
						<div class="space-y-1.5">
							<Label for="adjRemarks">Remarks</Label>
							<Input id="adjRemarks" name="remarks" maxlength={500} placeholder="e.g. Annual merit increase" required />
						</div>
					</div>

					{#if adjNew > 0}
						<p class="rounded-xl bg-white/70 px-4 py-2 text-sm tabular-nums">
							{adjDiff === 0 && adjBasis === emp.payBasis ? 'No change.' : adjBasis !== emp.payBasis ? `Pay basis changes to ${adjBasis}.` : `${adjDiff > 0 ? '+' : '−'}${peso(Math.abs(adjDiff))} (${adjDiff > 0 ? '+' : ''}${((adjDiff / (adjOld || 1)) * 100).toFixed(1)}%)`}
						</p>
					{/if}
					<p class="text-xs text-ink-muted">
						A cutoff that contains the effective date is split by day, each day at its own rate. A change of pay basis
						starts with the next cutoff. Locked payslips are never changed.
					</p>
				</form>
			</div>

			<Dialog.Footer class="flex-row justify-end gap-2 border-t border-dotted border-ink/20 bg-white/70 px-7 py-4">
				<Button type="button" variant="outline" onclick={() => (adjusting = null)}>Cancel</Button>
				<Button type="submit" form="adjustSalaryForm" disabled={adjBusy}>Save adjustment</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
