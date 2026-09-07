<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const h = $derived(data.hotel);
	const vatPct = $derived((h.vatRateBps / 100).toString());

	let currency = $state('PHP');
	$effect(() => {
		currency = h.currency;
	});

	let roleForms: Record<string, HTMLFormElement> = {};
	let inviteRole = $state<string>('');

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">{h.name}</h1>
			<p class="text-sm text-ink-muted">
				<code>/{h.slug}</code> · {h.status} · org <code class="text-xs">{h.orgRef}</code>
			</p>
		</div>
		<Button variant="outline" href="/admin/hotels">← All hotels</Button>
	</div>

	{#if form?.inviteLink}
		<p class="mb-4 break-all rounded-xl border border-border bg-surface-2 p-5 text-sm shadow-sm">
			Send this link to the invitee:<br /><code>{form.inviteLink}</code>
		</p>
	{/if}

	<div class="grid gap-6 lg:grid-cols-2">
		<section class="rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
			<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">Configuration</h2>
			<form method="POST" action="?/updateConfig" use:enhance class="mt-3 space-y-3">
				<div>
					<Label for="name">Name</Label>
					<Input id="name" name="name" value={h.name} required class="mt-1" />
				</div>
				<div>
					<Label for="legalName">Legal name</Label>
					<Input id="legalName" name="legalName" value={h.legalName ?? ''} class="mt-1" />
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="city">City</Label>
						<Input id="city" name="city" value={h.city ?? ''} class="mt-1" />
					</div>
					<div>
						<Label for="timezone">Timezone</Label>
						<Input id="timezone" name="timezone" value={h.timezone} required class="mt-1" />
					</div>
				</div>
				<div>
					<Label for="addressLine">Address</Label>
					<Input id="addressLine" name="addressLine" value={h.addressLine ?? ''} class="mt-1" />
				</div>
				<div class="grid grid-cols-3 gap-3">
					<div>
						<Label for="currency">Currency</Label>
						<Select.Root type="single" name="currency" bind:value={currency}>
							<Select.Trigger id="currency" class="mt-1 w-full">{currency}</Select.Trigger>
							<Select.Content>
								<Select.Item value="PHP" label="PHP" />
							</Select.Content>
						</Select.Root>
					</div>
					<div>
						<Label for="vatRatePct">VAT %</Label>
						<Input
							id="vatRatePct"
							name="vatRatePct"
							type="number"
							step="0.01"
							value={vatPct}
							required
							class="mt-1"
						/>
					</div>
					<div>
						<Label for="orSeriesPrefix">OR prefix</Label>
						<Input
							id="orSeriesPrefix"
							name="orSeriesPrefix"
							value={h.orSeriesPrefix}
							required
							class="mt-1"
						/>
					</div>
				</div>
				<div>
					<Label for="customDomain">Custom domain (optional)</Label>
					<Input
						id="customDomain"
						name="customDomain"
						value={h.customDomain ?? ''}
						placeholder="mmhotel.com"
						class="mt-1"
					/>
					<p class="mt-1 text-xs text-ink-muted">
						Point this domain's DNS at this platform, then enter it here — bare hostname only, no
						<code>https://</code> or trailing path. DNS/hosting setup for the domain itself happens
						outside this app.
					</p>
				</div>
				<Button type="submit">Save configuration</Button>
			</form>

			<Separator class="my-4" />
			<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">Status</h2>
			<div class="mt-2 flex gap-2">
				<form method="POST" action="?/setStatus" use:enhance>
					<input type="hidden" name="status" value="published" />
					<Button type="submit" disabled={h.status === 'published'}>Publish</Button>
				</form>
				<form method="POST" action="?/setStatus" use:enhance>
					<input type="hidden" name="status" value="draft" />
					<Button variant="outline" type="submit" disabled={h.status === 'draft'}>Unpublish</Button>
				</form>
				<form method="POST" action="?/setStatus" use:enhance>
					<input type="hidden" name="status" value="archived" />
					<Button variant="destructive" type="submit" disabled={h.status === 'archived'}>
						Archive
					</Button>
				</form>
			</div>
		</section>

		<section class="rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
			<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">Members</h2>
			{#if data.members.length === 0}
				<p class="mt-2 text-sm text-ink-muted">No members yet.</p>
			{:else}
				<Table.Root class="mt-2">
					<Table.Body>
						{#each data.members as m (m.userId)}
							<Table.Row>
								<Table.Cell>
									<div class="font-medium">{m.name}</div>
									<div class="text-xs text-ink-muted">{m.email}</div>
								</Table.Cell>
								<Table.Cell>
									<form
										method="POST"
										action="?/changeRole"
										use:enhance
										bind:this={roleForms[m.userId]}
										class="flex items-center gap-2"
									>
										<input type="hidden" name="userId" value={m.userId} />
										<Select.Root
											type="single"
											name="role"
											value={m.role}
											onValueChange={() => roleForms[m.userId]?.requestSubmit()}
										>
											<Select.Trigger class="w-32">{m.role}</Select.Trigger>
											<Select.Content>
												{#each data.roles as r (r)}
													<Select.Item value={r} label={r} />
												{/each}
											</Select.Content>
										</Select.Root>
									</form>
								</Table.Cell>
								<Table.Cell>
									<form method="POST" action="?/removeMember" use:enhance>
										<input type="hidden" name="userId" value={m.userId} />
										<button class="text-xs text-danger hover:underline">Remove</button>
									</form>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{/if}

			{#if data.pendingInvites.length > 0}
				<h3 class="mt-4 text-xs font-semibold uppercase text-ink-muted">Pending invites</h3>
				<ul class="mt-1 text-sm">
					{#each data.pendingInvites as inv (inv.id)}
						<li class="py-1 text-ink-muted">{inv.email} — {inv.role}</li>
					{/each}
				</ul>
			{/if}

			<Separator class="my-4" />
			<h3 class="text-xs font-semibold uppercase text-ink-muted">Invite a member</h3>
			<form method="POST" action="?/inviteMember" use:enhance class="mt-2 space-y-3">
				<div>
					<Label for="inviteEmail">Email</Label>
					<Input id="inviteEmail" name="email" type="email" required class="mt-1" />
				</div>
				<div>
					<Label for="inviteRole">Role</Label>
					<Select.Root type="single" name="role" bind:value={inviteRole}>
						<Select.Trigger id="inviteRole" class="mt-1 w-full">
							{inviteRole || 'Select a role'}
						</Select.Trigger>
						<Select.Content>
							{#each data.roles as r (r)}
								<Select.Item value={r} label={r} />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<Button type="submit">Create invite</Button>
			</form>
		</section>
	</div>
</div>
