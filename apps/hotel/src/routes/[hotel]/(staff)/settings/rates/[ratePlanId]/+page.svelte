<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import CalendarRangeIcon from '@lucide/svelte/icons/calendar-range';
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}`);
	const p = $derived(data.ratePlan);

	let policyId = $state('');
	$effect(() => {
		policyId = p.cancellationPolicyId ?? '';
	});

	const WEEKDAYS = [
		{ n: 0, label: 'Sun' },
		{ n: 1, label: 'Mon' },
		{ n: 2, label: 'Tue' },
		{ n: 3, label: 'Wed' },
		{ n: 4, label: 'Thu' },
		{ n: 5, label: 'Fri' },
		{ n: 6, label: 'Sat' }
	];

	const peso = (centavos: number) => (centavos / 100).toFixed(2);

	function seasonValue(s: { priceCentavos: number | null; multiplierBps: number | null }) {
		if (s.priceCentavos != null) return `₱${peso(s.priceCentavos)}`;
		if (s.multiplierBps != null) return `×${(s.multiplierBps / 10000).toFixed(2)}`;
		return '—';
	}

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<h1 class="text-xl font-semibold tracking-tight text-ink">{p.name}</h1>
		<Button variant="outline" href="{base}/settings/rates">← Rates & policies</Button>
	</div>

	<div class="grid gap-6 lg:grid-cols-2">
		<section class="rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
			<h2 class="flex items-center gap-2 text-sm font-semibold text-ink">
				<WalletIcon class="size-4 text-brand" /> Details
			</h2>
			<form method="POST" action="?/update" use:enhance class="mt-3 space-y-3">
				<div>
					<Label for="name">Name</Label>
					<Input id="name" name="name" value={p.name} required class="mt-1" />
				</div>
				<div>
					<Label for="description">Description</Label>
					<Input id="description" name="description" value={p.description ?? ''} class="mt-1" />
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="basePricePhp">Price / night (₱)</Label>
						<Input
							id="basePricePhp"
							name="basePricePhp"
							type="number"
							min="0"
							step="0.01"
							value={peso(p.basePriceCentavos)}
							required
							class="mt-1"
						/>
					</div>
					<div>
						<Label for="promoCode">Promo code</Label>
						<Input id="promoCode" name="promoCode" value={p.promoCode ?? ''} class="mt-1" />
					</div>
				</div>
				<div>
					<Label for="inclusionsCsv">Inclusions (comma-separated)</Label>
					<Input
						id="inclusionsCsv"
						name="inclusionsCsv"
						value={(p.inclusions ?? []).join(', ')}
						placeholder="Breakfast, Parking"
						class="mt-1"
					/>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="weekendPricePhp">Weekend price / night (₱)</Label>
						<Input
							id="weekendPricePhp"
							name="weekendPricePhp"
							type="number"
							min="0"
							step="0.01"
							value={p.weekendPriceCentavos != null ? peso(p.weekendPriceCentavos) : ''}
							placeholder="Blank = same as base"
							class="mt-1"
						/>
					</div>
					<div>
						<span class="mb-1 block text-sm font-medium text-ink">Weekend nights</span>
						<div class="flex flex-wrap gap-1.5">
							{#each WEEKDAYS as d (d.n)}
								<label
									class="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-ink"
								>
									<input
										type="checkbox"
										name="weekendDay"
										value={d.n}
										checked={(p.weekendDays ?? []).includes(d.n)}
										class="size-3.5"
									/>
									{d.label}
								</label>
							{/each}
						</div>
					</div>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="extraPersonFeePhp">Extra adult fee (₱)</Label>
						<Input
							id="extraPersonFeePhp"
							name="extraPersonFeePhp"
							type="number"
							min="0"
							step="0.01"
							value={p.extraPersonFeeCentavos != null ? peso(p.extraPersonFeeCentavos) : ''}
							class="mt-1"
						/>
					</div>
					<div>
						<Label for="extraChildFeePhp">Extra child fee (₱)</Label>
						<Input
							id="extraChildFeePhp"
							name="extraChildFeePhp"
							type="number"
							min="0"
							step="0.01"
							value={p.extraChildFeeCentavos != null ? peso(p.extraChildFeeCentavos) : ''}
							class="mt-1"
						/>
					</div>
					<div>
						<Label for="childFreeMaxAge">Children free up to age</Label>
						<Input
							id="childFreeMaxAge"
							name="childFreeMaxAge"
							type="number"
							min="0"
							max="17"
							value={p.childFreeMaxAge ?? ''}
							placeholder="e.g. 5"
							class="mt-1"
						/>
					</div>
					<div>
						<Label for="extraBedFeePhp">Extra bed fee (₱)</Label>
						<Input
							id="extraBedFeePhp"
							name="extraBedFeePhp"
							type="number"
							min="0"
							step="0.01"
							value={p.extraBedFeeCentavos != null ? peso(p.extraBedFeeCentavos) : ''}
							class="mt-1"
						/>
					</div>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="depositPhp">Deposit (₱)</Label>
						<Input
							id="depositPhp"
							name="depositPhp"
							type="number"
							min="0"
							step="0.01"
							value={p.depositCentavos != null ? peso(p.depositCentavos) : ''}
							class="mt-1"
						/>
					</div>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="minStayNights">Min stay (nights)</Label>
						<Input
							id="minStayNights"
							name="minStayNights"
							type="number"
							min="1"
							value={p.minStayNights ?? ''}
							class="mt-1"
						/>
						<p class="mt-1 text-xs text-ink-muted">
							Fewest nights a guest must book on this rate. Stays shorter than this are rejected.
							Leave blank for no minimum.
						</p>
					</div>
					<div>
						<Label for="maxStayNights">Max stay (nights)</Label>
						<Input
							id="maxStayNights"
							name="maxStayNights"
							type="number"
							min="1"
							value={p.maxStayNights ?? ''}
							class="mt-1"
						/>
						<p class="mt-1 text-xs text-ink-muted">
							Most nights a guest can book in a single reservation on this rate. Leave blank for no
							maximum.
						</p>
					</div>
				</div>
				<div>
					<Label for="cancellationPolicyId">Cancellation policy</Label>
					<Select.Root type="single" name="cancellationPolicyId" bind:value={policyId}>
						<Select.Trigger id="cancellationPolicyId" class="mt-1 w-full">
							{data.cancellationPolicies.find((c) => c.id === policyId)?.name ?? 'None'}
						</Select.Trigger>
						<Select.Content>
							{#each data.cancellationPolicies as c (c.id)}
								<Select.Item value={c.id} label={c.name} />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<label class="flex items-center gap-2 text-sm text-ink">
					<input type="checkbox" name="isActive" checked={p.isActive} class="size-4" />
					Active (bookable)
				</label>
				<Button type="submit">Save changes</Button>
			</form>
		</section>

		<div class="space-y-6">
			<section class="rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
				<h2 class="flex items-center gap-2 text-sm font-semibold text-ink">
					<CalendarRangeIcon class="size-4 text-brand" /> Seasonal ranges
				</h2>
				<p class="mt-1 text-xs text-ink-muted">
					A date range that sets a fixed nightly price or multiplies the base/weekend rate. Exact
					date overrides below still win.
				</p>
				{#if data.seasons.length === 0}
					<p class="mt-2 text-sm text-ink-muted">No seasonal ranges yet.</p>
				{:else}
					<Table.Root class="mt-2">
						<Table.Header>
							<Table.Row>
								<Table.Head>Name</Table.Head>
								<Table.Head>Range</Table.Head>
								<Table.Head>Rate</Table.Head>
								<Table.Head></Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each data.seasons as s (s.id)}
								<Table.Row>
									<Table.Cell class="font-medium text-ink">{s.name}</Table.Cell>
									<Table.Cell class="text-ink-muted">{s.startDate} → {s.endDate}</Table.Cell>
									<Table.Cell class="text-ink-muted">{seasonValue(s)}</Table.Cell>
									<Table.Cell>
										<form method="POST" action="?/removeSeason" use:enhance>
											<input type="hidden" name="id" value={s.id} />
											<button class="text-xs text-danger hover:underline">Remove</button>
										</form>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				{/if}

				<Separator class="my-4" />
				<h3 class="text-sm font-medium text-ink">Add seasonal range</h3>
				<form method="POST" action="?/addSeason" use:enhance class="mt-2 space-y-3">
					<div>
						<Label for="seasonName">Name</Label>
						<Input id="seasonName" name="name" required placeholder="Holiday season" class="mt-1" />
					</div>
					<div class="grid grid-cols-2 gap-3">
						<div>
							<Label for="seasonStart">Start date</Label>
							<Input id="seasonStart" name="startDate" type="date" required class="mt-1" />
						</div>
						<div>
							<Label for="seasonEnd">End date</Label>
							<Input id="seasonEnd" name="endDate" type="date" required class="mt-1" />
						</div>
					</div>
					<div class="grid grid-cols-2 gap-3">
						<div>
							<Label for="seasonPricePhp">Fixed price (₱)</Label>
							<Input
								id="seasonPricePhp"
								name="pricePhp"
								type="number"
								min="0"
								step="0.01"
								class="mt-1"
							/>
						</div>
						<div>
							<Label for="seasonMultiplierPct">…or multiplier (%)</Label>
							<Input
								id="seasonMultiplierPct"
								name="multiplierPct"
								type="number"
								min="1"
								step="1"
								placeholder="130 = +30%"
								class="mt-1"
							/>
						</div>
					</div>
					<div>
						<Label for="seasonMinStay">Min stay (nights)</Label>
						<Input id="seasonMinStay" name="minStayNights" type="number" min="1" class="mt-1" />
					</div>
					<Button type="submit" class="w-full">Add range</Button>
				</form>
			</section>

			<section class="rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
				<h2 class="flex items-center gap-2 text-sm font-semibold text-ink">
					<CalendarDaysIcon class="size-4 text-brand" /> Exact date overrides
				</h2>
				<p class="mt-1 text-xs text-ink-muted">
					A price locked to one calendar date — the highest-priority rate for that night.
				</p>
				{#if data.overrides.length === 0}
					<p class="mt-2 text-sm text-ink-muted">No overrides yet.</p>
				{:else}
					<Table.Root class="mt-2">
						<Table.Header>
							<Table.Row>
								<Table.Head>Date</Table.Head>
								<Table.Head>Price</Table.Head>
								<Table.Head>Min stay</Table.Head>
								<Table.Head></Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each data.overrides as o (o.id)}
								<Table.Row>
									<Table.Cell>{o.date}</Table.Cell>
									<Table.Cell>₱{peso(o.priceCentavos)}</Table.Cell>
									<Table.Cell>{o.minStayNights ?? '—'}</Table.Cell>
									<Table.Cell>
										<form method="POST" action="?/removeOverride" use:enhance>
											<input type="hidden" name="id" value={o.id} />
											<button class="text-xs text-danger hover:underline">Remove</button>
										</form>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				{/if}

				<Separator class="my-4" />
				<h3 class="text-sm font-medium text-ink">Add / update override</h3>
				<form method="POST" action="?/addOverride" use:enhance class="mt-2 space-y-3">
					<div class="grid grid-cols-2 gap-3">
						<div>
							<Label for="overrideDate">Date</Label>
							<Input id="overrideDate" name="date" type="date" required class="mt-1" />
						</div>
						<div>
							<Label for="overridePricePhp">Price (₱)</Label>
							<Input
								id="overridePricePhp"
								name="pricePhp"
								type="number"
								min="0"
								step="0.01"
								required
								class="mt-1"
							/>
						</div>
					</div>
					<div>
						<Label for="overrideMinStay">Min stay (nights)</Label>
						<Input id="overrideMinStay" name="minStayNights" type="number" min="1" class="mt-1" />
					</div>
					<Button type="submit" class="w-full">Save override</Button>
				</form>
			</section>
		</div>
	</div>
</div>
