<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}/management`);
	const vatPct = $derived((data.details.vatRateBps / 100).toString());

	let currency = $state(data.details.currency);
	$effect(() => {
		currency = data.details.currency;
	});

	$effect(() => {
		if (form && 'ok' in form && form.ok) toast.success(form.ok);
		if (form && 'error' in form && form.error) toast.error(form.error);
	});

	const legalLine = $derived(
		[data.details.legalName, data.details.addressLine, data.details.city].filter(Boolean).join(' · ')
	);
</script>

<svelte:head><title>General · Settings</title></svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
	<div class="mb-6">
		<h1 class="text-xl font-semibold tracking-tight text-ink">General</h1>
		<p class="text-sm text-ink-muted">
			The basics every other part of the system works from: currency, tax rate, timezone and discounts.
		</p>
	</div>

	<section class="mb-8 rounded-xl border border-border p-5">
		<h2 class="mb-3 text-sm font-semibold text-ink">Hotel details</h2>
		<form method="POST" action="?/updateHotelDetails" use:enhance class="space-y-3">
			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<Label class="text-xs" for="currency">Currency</Label>
					<Select.Root type="single" name="currency" bind:value={currency}>
						<Select.Trigger id="currency" class="mt-1 w-full">{currency}</Select.Trigger>
						<Select.Content>
							<Select.Item value="PHP" label="PHP" />
						</Select.Content>
					</Select.Root>
				</div>
				<div>
					<Label class="text-xs" for="vatRatePct">VAT %</Label>
					<Input id="vatRatePct" name="vatRatePct" type="number" step="0.01" value={vatPct} required />
				</div>
				<div>
					<Label class="text-xs" for="timezone">Timezone</Label>
					<Input id="timezone" name="timezone" value={data.details.timezone} required />
				</div>
				<div>
					<Label class="text-xs" for="scPwdDiscountPct">Senior Citizen / PWD discount (%)</Label>
					<Input
						id="scPwdDiscountPct"
						name="scPwdDiscountPct"
						type="number"
						min="0"
						max="100"
						step="0.01"
						value={data.scPwdDiscountBps / 100}
						required
					/>
				</div>
			</div>
			<p class="text-xs text-ink-muted">
				Timezone resolves this hotel's business date (day-close, reports) — changing it after you've
				started operating can shift how past dates are grouped. The Senior Citizen (RA 9994) / PWD
				(RA 10754) rate is applied when front desk flags a guest at check-in — computed on the
				VAT-exclusive room charge, which then becomes VAT-exempt. Defaults to the legally mandated 20%.
			</p>
			<Button type="submit" size="sm">Save hotel details</Button>
		</form>
	</section>

	<section class="rounded-xl border border-border p-5">
		<h2 class="mb-1 text-sm font-semibold text-ink">Where the rest of the hotel's identity lives</h2>
		<p class="mb-4 text-xs text-ink-muted">
			Names and addresses are kept in two places on purpose, because they are used for different
			things.
		</p>
		<dl class="divide-y divide-border text-sm">
			<div class="flex flex-wrap items-baseline justify-between gap-2 py-3">
				<div class="min-w-0">
					<dt class="font-medium text-ink">Public contact details</dt>
					<dd class="text-xs text-ink-muted">Phone, email and address guests see on the booking page.</dd>
				</div>
				<Button variant="outline" size="sm" href="{base}/settings/branding">Branding &amp; website</Button>
			</div>
			<div class="flex flex-wrap items-baseline justify-between gap-2 py-3">
				<div class="min-w-0">
					<dt class="font-medium text-ink">Registered (legal) identity</dt>
					<dd class="text-xs text-ink-muted">
						Printed on official receipts and invoices.{legalLine ? ` Now: ${legalLine}.` : ' Not set yet.'}
					</dd>
				</div>
				<Button variant="outline" size="sm" href="{base}/finance/bir/setup">BIR setup</Button>
			</div>
		</dl>
	</section>
</div>
