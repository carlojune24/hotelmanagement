<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	const v = $derived((form?.values ?? {}) as Record<string, string>);

	$effect(() => {
		if (form?.error) toast.error(form.error);
	});
</script>

<svelte:head><title>New application — City management</title></svelte:head>

<div class="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
	<h1 class="text-xl font-semibold tracking-tight text-ink">New application</h1>
	<p class="mt-1 text-sm text-ink-muted">
		Enter a hotel's registration details as submitted to the city office. It joins the review queue as
		pending; the hotel is only created when you finalize an approved application.
	</p>

	<form method="POST" use:enhance class="mt-6 space-y-8">
		<fieldset class="space-y-4">
			<legend class="border-b border-border pb-2 text-sm font-semibold text-ink">Hotel</legend>
			<div>
				<Label for="hotelName">Hotel name</Label>
				<Input id="hotelName" name="hotelName" required value={v.hotelName ?? ''} class="mt-1" />
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<Label for="addressLine">Street address</Label>
					<Input id="addressLine" name="addressLine" value={v.addressLine ?? ''} class="mt-1" />
				</div>
				<div>
					<Label for="city">City / municipality</Label>
					<Input id="city" name="city" value={v.city ?? ''} class="mt-1" />
				</div>
			</div>
			<div class="max-w-[12rem]">
				<Label for="declaredRooms">Number of rooms</Label>
				<Input
					id="declaredRooms"
					name="declaredRooms"
					type="number"
					min="1"
					inputmode="numeric"
					value={v.declaredRooms ?? ''}
					class="mt-1 font-mono tabular-nums"
				/>
			</div>
		</fieldset>

		<fieldset class="space-y-4">
			<legend class="border-b border-border pb-2 text-sm font-semibold text-ink">Contact person</legend>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<Label for="contactName">Name</Label>
					<Input id="contactName" name="contactName" required value={v.contactName ?? ''} class="mt-1" />
				</div>
				<div>
					<Label for="contactPhone">Phone</Label>
					<Input id="contactPhone" name="contactPhone" type="tel" value={v.contactPhone ?? ''} class="mt-1" />
				</div>
			</div>
			<div>
				<Label for="contactEmail">Email</Label>
				<Input
					id="contactEmail"
					name="contactEmail"
					type="email"
					required
					value={v.contactEmail ?? ''}
					class="mt-1"
				/>
			</div>
		</fieldset>

		<fieldset class="space-y-4">
			<legend class="border-b border-border pb-2 text-sm font-semibold text-ink">Business permit</legend>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<Label for="permitNumber">Permit number</Label>
					<Input
						id="permitNumber"
						name="permitNumber"
						value={v.permitNumber ?? ''}
						class="mt-1 font-mono"
					/>
				</div>
				<div>
					<Label for="permitExpiresOn">Permit expires on</Label>
					<Input
						id="permitExpiresOn"
						name="permitExpiresOn"
						type="date"
						value={v.permitExpiresOn ?? ''}
						class="mt-1"
					/>
				</div>
			</div>
		</fieldset>

		<div>
			<Label for="notes">Notes for the reviewer</Label>
			<textarea
				id="notes"
				name="notes"
				rows="3"
				maxlength="2000"
				class="mt-1 w-full rounded-md border border-input bg-transparent px-2.5 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
				>{v.notes ?? ''}</textarea
			>
		</div>

		<div class="flex items-center gap-3">
			<Button type="submit">Submit application</Button>
			<Button variant="outline" href="/city/applications">Cancel</Button>
		</div>
	</form>
</div>
