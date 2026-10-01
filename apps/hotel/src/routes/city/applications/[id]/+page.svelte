<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import ApplicationStatusBadge from '$lib/components/city/application-status-badge.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const app = $derived(data.app);
	const dt = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
	const day = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'UTC' });

	const details = $derived([
		{ label: 'Hotel', value: app.hotelName },
		{ label: 'Address', value: [app.addressLine, app.city].filter(Boolean).join(', ') || null },
		{ label: 'Rooms declared', value: app.declaredRooms?.toString() ?? null, mono: true },
		{ label: 'Contact', value: app.contactName },
		{ label: 'Email', value: app.contactEmail },
		{ label: 'Phone', value: app.contactPhone },
		{ label: 'Permit number', value: app.permitNumber, mono: true },
		{
			label: 'Permit expires',
			value: app.permitExpiresOn ? day.format(new Date(`${app.permitExpiresOn}T00:00:00Z`)) : null
		},
		{ label: 'Received', value: dt.format(app.createdAt) }
	]);

	let rejecting = $state(false);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		else if (form && 'ok' in form && form.ok) rejecting = false;
	});
</script>

<svelte:head><title>{app.ref} — City management</title></svelte:head>

<div class="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
	<Button variant="outline" href="/city/applications">← Applications</Button>

	<div class="mt-5 flex flex-wrap items-center gap-3">
		<h1 class="text-xl font-semibold tracking-tight text-ink">{app.hotelName}</h1>
		<ApplicationStatusBadge status={app.status} />
	</div>
	<p class="mt-1 font-mono text-xs text-ink-muted">{app.ref}</p>

	<dl class="mt-6 divide-y divide-border border-y border-border">
		{#each details as d (d.label)}
			<div class="grid grid-cols-[10rem_1fr] gap-4 py-2.5 text-sm">
				<dt class="text-ink-muted">{d.label}</dt>
				<dd class="text-ink {d.mono ? 'font-mono tabular-nums' : ''}">{d.value ?? '—'}</dd>
			</div>
		{/each}
	</dl>

	{#if app.notes}
		<section class="mt-6">
			<h2 class="text-sm font-semibold text-ink">Notes from the applicant</h2>
			<p class="mt-1 max-w-[68ch] whitespace-pre-line text-sm text-ink-muted">{app.notes}</p>
		</section>
	{/if}

	{#if app.decisionNote}
		<section class="mt-6">
			<h2 class="text-sm font-semibold text-ink">Decision note</h2>
			<p class="mt-1 max-w-[68ch] whitespace-pre-line text-sm text-ink-muted">{app.decisionNote}</p>
			{#if app.decidedAt}
				<p class="mt-1 text-xs text-ink-muted">{dt.format(app.decidedAt)}</p>
			{/if}
		</section>
	{/if}

	<section class="mt-8 border-t border-border pt-6">
		{#if app.status === 'pending'}
			<h2 class="text-sm font-semibold text-ink">Review</h2>
			<div class="mt-3 flex flex-wrap items-start gap-3">
				<form method="POST" action="?/approve" use:enhance>
					<Button type="submit">Approve</Button>
				</form>
				<Button variant="outline" onclick={() => (rejecting = !rejecting)}>Reject…</Button>
			</div>
		{:else if app.status === 'approved'}
			<h2 class="text-sm font-semibold text-ink">Finalize</h2>
			<p class="mt-1 max-w-[68ch] text-sm text-ink-muted">
				Finalizing creates this hotel as a draft with its standard amenities, finance setup and
				roles, and links it to this application. The slug becomes its web address and can't be
				reused.
			</p>
			<form method="POST" action="?/finalize" use:enhance class="mt-3 flex flex-wrap items-end gap-3">
				<div class="min-w-[14rem] flex-1">
					<Label for="slug">URL slug</Label>
					<Input
						id="slug"
						name="slug"
						required
						value={data.suggestedSlug}
						pattern="[a-z0-9][a-z0-9-]&#123;1,38&#125;[a-z0-9]"
						class="mt-1 font-mono"
					/>
				</div>
				<Button type="submit">Finalize and create hotel</Button>
			</form>
			<div class="mt-3">
				<Button variant="outline" onclick={() => (rejecting = !rejecting)}>Reject…</Button>
			</div>
		{:else if app.status === 'finalized'}
			<h2 class="text-sm font-semibold text-ink">Hotel created</h2>
			{#if data.hotel}
				<p class="mt-1 text-sm text-ink-muted">
					<a class="text-brand hover:underline" href="/city/hotels/{data.hotel.id}"
						>{data.hotel.name}</a
					>
					<span class="font-mono text-xs">· /{data.hotel.slug}</span>
				</p>
			{:else}
				<p class="mt-1 text-sm text-ink-muted">The linked hotel no longer exists.</p>
			{/if}
		{:else}
			<h2 class="text-sm font-semibold text-ink">Rejected</h2>
			<form method="POST" action="?/reopen" use:enhance class="mt-3">
				<Button type="submit" variant="outline">Reopen for review</Button>
			</form>
		{/if}

		{#if rejecting && (app.status === 'pending' || app.status === 'approved')}
			<form method="POST" action="?/reject" use:enhance class="mt-4 max-w-xl space-y-3">
				<Label for="note">Reason (shown in the record)</Label>
				<textarea
					id="note"
					name="note"
					rows="3"
					required
					maxlength="1000"
					class="w-full rounded-md border border-input bg-transparent px-2.5 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
				></textarea>
				<div class="flex gap-3">
					<Button type="submit" variant="destructive">Reject application</Button>
					<Button type="button" variant="outline" onclick={() => (rejecting = false)}>Cancel</Button>
				</div>
			</form>
		{/if}
	</section>
</div>
