<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import SearchIcon from '@lucide/svelte/icons/search';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	type Person = PageData['people'][number];

	let query = $state('');
	let selectedId = $state<string | null>(null);
	let busy = $state(false);

	const selected = $derived(data.people.find((p) => p.id === selectedId) ?? null);
	const rows = $derived(
		data.people.filter((p) => {
			const q = query.trim().toLowerCase();
			return (
				!q ||
				p.name.toLowerCase().includes(q) ||
				p.employeeNo.toLowerCase().includes(q) ||
				p.assignments.some((a) => a.establishmentName.toLowerCase().includes(q))
			);
		})
	);
	const fieldError = (name: string): string | undefined =>
		(form as { errors?: Record<string, string[] | undefined> } | null)?.errors?.[name]?.[0];
	const selectClass =
		'h-10 w-full rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

	function submit() {
		busy = true;
		return async ({
			result,
			update
		}: {
			result: { type: string; data?: unknown };
			update: (o?: { reset?: boolean }) => Promise<void>;
		}) => {
			await update({ reset: result.type === 'success' });
			busy = false;
			const d = result.data as { ok?: string; message?: string } | undefined;
			if (result.type === 'success') toast.success(d?.ok ?? 'Saved.');
			else if (result.type === 'failure' && d?.message) toast.error(d.message);
		};
	}
</script>

<svelte:head><title>People · HR</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
	<h1 class="text-5xl font-light tracking-tight">People</h1>

	<section class="panel space-y-5 p-5 md:p-6" aria-label="People">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="relative min-w-52 flex-1">
				<SearchIcon class="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink-muted" />
				<Input
					type="search"
					placeholder="Search by name, number or establishment"
					aria-label="Search people"
					class="pl-10"
					bind:value={query}
				/>
			</div>
			<p class="text-sm text-ink-muted">
				Register a person from an establishment's Employees tab, then assign them anywhere here.
			</p>
		</div>

		{#if data.people.length === 0}
			<div class="hatch rounded-2xl px-6 py-14 text-center">
				<p class="text-lg">No one registered yet</p>
				<p class="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
					Open an establishment and add its first employee. They will appear here for the whole company.
				</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row class="hover:bg-transparent">
						<Table.Head>Person</Table.Head>
						<Table.Head>Works at</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="w-28"><span class="sr-only">Actions</span></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each rows as p (p.id)}
						<Table.Row>
							<Table.Cell>
								<p class="font-medium">{p.name}</p>
								<p class="text-xs text-ink-muted">#{p.employeeNo}</p>
							</Table.Cell>
							<Table.Cell>
								{#if p.assignments.length === 0}
									<span class="text-ink-muted">Not assigned</span>
								{:else}
									<div class="flex flex-wrap gap-1.5">
										{#each p.assignments as a (a.id)}
											<a
												href="/{a.establishmentSlug}/employees"
												class="rounded-full px-3 py-1 text-xs font-medium {a.isPrimary
													? 'bg-gold text-ink'
													: 'bg-ink/10 text-ink'}"
												title="{a.position}{a.isPrimary ? ' · home' : ''}"
											>
												{a.establishmentName}
											</a>
										{/each}
									</div>
								{/if}
							</Table.Cell>
							<Table.Cell>
								<Badge variant={p.status === 'active' ? 'ok' : 'muted'}>
									<span class="size-1.5 rounded-full bg-current opacity-70"></span>
									{p.status}
								</Badge>
							</Table.Cell>
							<Table.Cell class="text-right">
								<Button variant="outline" size="sm" onclick={() => (selectedId = p.id)}>
									{data.canWrite ? 'Manage' : 'View'}
								</Button>
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row class="hover:bg-transparent">
							<Table.Cell colspan={4} class="py-10 text-center text-ink-muted">
								No one matches your search.
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</section>
</div>

<Dialog.Root
	open={selected !== null}
	onOpenChange={(o) => {
		if (!o) selectedId = null;
	}}
>
	<Dialog.Content class="sm:max-w-xl">
		{#if selected}
			<Dialog.Header>
				<Dialog.Title class="font-display text-2xl font-light">{selected.name}</Dialog.Title>
				<Dialog.Description>
					#{selected.employeeNo} · {data.canWrite ? 'Where this person works, and from when.' : 'Where this person works.'}
				</Dialog.Description>
			</Dialog.Header>

			<div class="space-y-3">
				{#each selected.assignments as a (a.id)}
					<div class="rounded-2xl bg-white/70 p-3">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<div>
								<p class="font-medium">
									{a.establishmentName}
									{#if a.isPrimary}<Badge variant="gold" class="ml-1">Home</Badge>{/if}
								</p>
								<p class="text-xs text-ink-muted">
									{a.position}{a.department ? ` · ${a.department}` : ''} · since {a.startDate}{a.biometricEnrollId
										? ` · device ID ${a.biometricEnrollId}`
										: ''}
								</p>
							</div>
							{#if data.canWrite}
								<div class="flex flex-wrap items-center gap-2">
									{#if !a.isPrimary}
										<form method="POST" action="?/primary" use:enhance={submit}>
											<input type="hidden" name="assignmentId" value={a.id} />
											<Button type="submit" variant="outline" size="sm" disabled={busy}>Make home</Button>
										</form>
									{/if}
									<form method="POST" action="?/end" use:enhance={submit} class="flex items-center gap-2">
										<input type="hidden" name="assignmentId" value={a.id} />
										<Input
											type="date"
											name="endDate"
											value={data.today}
											min={a.startDate}
											required
											aria-label="Last day at {a.establishmentName}"
											class="h-9 w-40"
										/>
										<Button type="submit" variant="outline" size="sm" disabled={busy}>End</Button>
									</form>
								</div>
							{/if}
						</div>
					</div>
				{:else}
					<p class="text-sm text-ink-muted">Not assigned to any establishment.</p>
				{/each}
			</div>

			{#if data.canWrite}
				{@const options = data.assignable[selected.id] ?? []}
				{#if options.length > 0}
					<form method="POST" action="?/assign" use:enhance={submit} class="space-y-3 border-t border-dotted border-foreground/20 pt-4">
						<input type="hidden" name="employeeId" value={selected.id} />
						<p class="text-sm font-medium">Assign to another establishment</p>
						<div class="grid grid-cols-2 gap-3">
							<div class="space-y-1.5">
								<Label for="estId">Establishment</Label>
								<select id="estId" name="establishmentId" class={selectClass} required>
									{#each options as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
								</select>
								{#if fieldError('establishmentId')}<p class="text-sm text-destructive">{fieldError('establishmentId')}</p>{/if}
							</div>
							<div class="space-y-1.5">
								<Label for="startDate">Starts</Label>
								<Input id="startDate" name="startDate" type="date" value={data.today} required />
							</div>
							<div class="space-y-1.5">
								<Label for="aPosition">Post there</Label>
								<Input id="aPosition" name="position" required maxlength={120} />
								{#if fieldError('position')}<p class="text-sm text-destructive">{fieldError('position')}</p>{/if}
							</div>
							<div class="space-y-1.5">
								<Label for="aDept">Department</Label>
								<Input id="aDept" name="department" maxlength={120} />
							</div>
							<div class="space-y-1.5">
								<Label for="aEnroll">Biometric ID there</Label>
								<Input id="aEnroll" name="biometricEnrollId" maxlength={40} />
							</div>
							<label class="flex items-end gap-2 pb-2 text-sm">
								<input type="checkbox" name="makePrimary" class="size-4 accent-black" /> Make this their home
							</label>
						</div>
						<Dialog.Footer class="pt-1">
							<Button type="submit" variant="gold" disabled={busy}><PlusIcon /> Assign</Button>
						</Dialog.Footer>
					</form>
				{/if}
			{/if}
		{/if}
	</Dialog.Content>
</Dialog.Root>
