<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const s = $derived(data.settings);

	$effect(() => {
		if (form && 'ok' in form && form.ok) toast.success(form.ok);
		if (form && 'error' in form && form.error) toast.error(form.error);
	});
</script>

<div class="mb-4 flex items-center gap-2">
	{#if data.configured}
		<Badge variant="secondary">Compliant footer active</Badge>
	{:else}
		<Badge variant="outline">Disclaimer mode — set TIN, permit no. &amp; printer to enable the statutory footer</Badge>
	{/if}
</div>

<form method="POST" action="?/save" use:enhance class="space-y-6">
	<section class="rounded-xl border border-border p-5">
		<h2 class="mb-3 text-sm font-semibold text-ink">Tax identity</h2>
		<div class="grid gap-3 sm:grid-cols-2">
			<div>
				<Label class="text-xs" for="tin">TIN</Label>
				<Input id="tin" name="tin" value={s?.tin ?? ''} placeholder="000-000-000-00000" />
			</div>
			<div class="flex items-end">
				<label class="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						name="isVatRegistered"
						class="size-4"
						checked={s ? s.isVatRegistered : true}
					/>
					VAT-registered
				</label>
			</div>
			<div class="sm:col-span-2">
				<Label class="text-xs" for="registeredAddress">Registered address (optional — falls back to the hotel's)</Label>
				<Input id="registeredAddress" name="registeredAddress" value={s?.registeredAddress ?? ''} />
			</div>
		</div>
	</section>

	<section class="rounded-xl border border-border p-5">
		<h2 class="mb-3 text-sm font-semibold text-ink">Permit &amp; accredited printer</h2>
		<div class="grid gap-3 sm:grid-cols-2">
			<div>
				<Label class="text-xs" for="birPermitNo">BIR permit / ATP no.</Label>
				<Input id="birPermitNo" name="birPermitNo" value={s?.birPermitNo ?? ''} />
			</div>
			<div>
				<Label class="text-xs" for="permitDateIssued">Permit date issued</Label>
				<Input id="permitDateIssued" name="permitDateIssued" type="date" value={s?.permitDateIssued ?? ''} />
			</div>
			<div>
				<Label class="text-xs" for="accreditedPrinterName">Accredited printer</Label>
				<Input id="accreditedPrinterName" name="accreditedPrinterName" value={s?.accreditedPrinterName ?? ''} />
			</div>
			<div>
				<Label class="text-xs" for="accreditedPrinterTin">Printer TIN</Label>
				<Input id="accreditedPrinterTin" name="accreditedPrinterTin" value={s?.accreditedPrinterTin ?? ''} />
			</div>
			<div>
				<Label class="text-xs" for="accreditedPrinterAccreditationNo">Printer accreditation no.</Label>
				<Input
					id="accreditedPrinterAccreditationNo"
					name="accreditedPrinterAccreditationNo"
					value={s?.accreditedPrinterAccreditationNo ?? ''}
				/>
			</div>
			<div>
				<Label class="text-xs" for="printerAccreditationDate">Printer accreditation date</Label>
				<Input
					id="printerAccreditationDate"
					name="printerAccreditationDate"
					type="date"
					value={s?.printerAccreditationDate ?? ''}
				/>
			</div>
		</div>
	</section>

	<section class="rounded-xl border border-border p-5">
		<h2 class="mb-3 text-sm font-semibold text-ink">Numbering &amp; issuance</h2>
		<div class="grid gap-3 sm:grid-cols-3">
			<div>
				<Label class="text-xs" for="invoicePrefix">Invoice prefix</Label>
				<Input id="invoicePrefix" name="invoicePrefix" value={s?.invoicePrefix ?? 'INV'} />
			</div>
			<div>
				<Label class="text-xs" for="orPrefix">Official Receipt prefix</Label>
				<Input id="orPrefix" name="orPrefix" value={s?.orPrefix ?? 'OR'} />
			</div>
			<div>
				<Label class="text-xs" for="serialPadWidth">Serial digits</Label>
				<Input
					id="serialPadWidth"
					name="serialPadWidth"
					type="number"
					min="1"
					max="12"
					value={s?.serialPadWidth ?? 6}
				/>
			</div>
		</div>
		<p class="mt-2 text-xs text-ink-muted">
			e.g. prefix <code>OR</code> + 6 digits → <code>OR-000042</code>. The numeric part is drawn from
			the active series (BIR → Series).
		</p>
		<div class="mt-3 space-y-2">
			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					name="autoIssueInvoiceOnCheckout"
					class="size-4"
					checked={s ? s.autoIssueInvoiceOnCheckout : true}
				/>
				Assign an Invoice number automatically when a booking checks out
			</label>
			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					name="autoIssueReceiptOnPayment"
					class="size-4"
					checked={s ? s.autoIssueReceiptOnPayment : true}
				/>
				Assign an Official Receipt number automatically when a payment is recorded
			</label>
		</div>
		<div class="mt-3">
			<Label class="text-xs" for="footerNote">Extra footer line (optional)</Label>
			<Input id="footerNote" name="footerNote" value={s?.footerNote ?? ''} />
		</div>
	</section>

	<Button type="submit">Save BIR setup</Button>
</form>
