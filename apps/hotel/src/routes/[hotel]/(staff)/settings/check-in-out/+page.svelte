<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}`);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});
</script>

<div class="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Check-in &amp; check-out</h1>
			<p class="text-sm text-ink-muted">Standard times and extension fees your front desk works from.</p>
		</div>
		<Button variant="outline" href="{base}/settings">← Settings</Button>
	</div>

	<form method="POST" action="?/update" use:enhance class="space-y-6 rounded-xl border border-border p-5">
		<div>
			<h2 class="mb-3 text-sm font-semibold text-ink">Standard times</h2>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="checkInTime">Check-in time</Label>
					<Input
						id="checkInTime"
						name="checkInTime"
						type="time"
						value={data.checkInTime.slice(0, 5)}
						required
						class="mt-1"
					/>
				</div>
				<div>
					<Label for="checkOutTime">Check-out time</Label>
					<Input
						id="checkOutTime"
						name="checkOutTime"
						type="time"
						value={data.checkOutTime.slice(0, 5)}
						required
						class="mt-1"
					/>
				</div>
			</div>
		</div>

		<div class="border-t border-border pt-5">
			<h2 class="mb-1 text-sm font-semibold text-ink">Extension fees</h2>
			<p class="mb-3 text-xs text-ink-muted">
				Per-hour reference rates for front desk to quote and collect in person when a guest
				wants to keep the room past checkout or move in before check-in time — front desk judges
				how many hours late/early and multiplies; shown as a rate on the room panel, not billed
				automatically.
			</p>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="lateCheckoutFeePerHour">Late checkout fee (₱/hour)</Label>
					<Input
						id="lateCheckoutFeePerHour"
						name="lateCheckoutFeePerHour"
						type="number"
						min="0"
						step="0.01"
						value={(data.lateCheckoutFeePerHourCentavos / 100).toFixed(2)}
						class="mt-1"
					/>
				</div>
				<div>
					<Label for="earlyCheckInFeePerHour">Early check-in fee (₱/hour)</Label>
					<Input
						id="earlyCheckInFeePerHour"
						name="earlyCheckInFeePerHour"
						type="number"
						min="0"
						step="0.01"
						value={(data.earlyCheckInFeePerHourCentavos / 100).toFixed(2)}
						class="mt-1"
					/>
				</div>
			</div>
		</div>

		<Button type="submit">Save</Button>
	</form>
</div>
