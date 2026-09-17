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
	import type { ActionData, PageData } from './$types';
	import type { Employee } from '$lib/server/db/schema/hr';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// `data.employees` rows also carry `teamRoleName` (view-only — see
	// `listEmployeesWithTeamRole`), which the plain `Employee` type doesn't know
	// about; widen it so the edit dialog can read that field back off the row.
	type EmployeeRow = Employee & { teamRoleName: string | null };

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
				Employee records for scheduling, DTR, and payroll — separate from staff app accounts.
			</p>
		</div>
		<Button onclick={() => (createOpen = true)}>
			<PlusIcon class="size-4" /> New employee
		</Button>
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
						<Table.Head>Team role</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="text-right">Rate</Table.Head>
						<Table.Head class="text-right">Edit</Table.Head>
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
							<Table.Cell class="text-ink-muted">{emp.teamRoleName ?? '—'}</Table.Cell>
							<Table.Cell>
								<Badge variant={emp.status === 'active' ? 'default' : 'outline'}>
									{statusLabel(emp.status)}
								</Badge>
							</Table.Cell>
							<Table.Cell class="text-right text-ink">
								{peso(emp.baseRateCentavos)}/{emp.payBasis}
							</Table.Cell>
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
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>
</div>

{#snippet employeeFields(emp: Employee | null, idPrefix: string)}
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
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="{idPrefix}payBasis">Pay basis</Label>
					<Select.Root type="single" name="payBasis" value={emp?.payBasis ?? 'monthly'}>
						<Select.Trigger id="{idPrefix}payBasis" class="mt-1 w-full capitalize">
							{emp?.payBasis ?? 'monthly'}
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
							value={emp ? (emp.baseRateCentavos / 100).toFixed(2) : ''}
							class="pl-8"
						/>
					</div>
				</div>
			</div>
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
						<p class="mt-0.5 text-xs text-ink-muted">
							Team role:
							{#if emp.teamRoleName}
								<Badge variant="outline" class="ml-1">{emp.teamRoleName}</Badge>
							{:else}
								not linked to a team account
							{/if}
							<span class="text-ink-muted/70">(set from Settings → Team)</span>
						</p>
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
