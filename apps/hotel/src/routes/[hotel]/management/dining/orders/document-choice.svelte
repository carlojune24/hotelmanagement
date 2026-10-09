<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import { DOCUMENT_CHOICE_LABEL, type DocumentChoice } from '$lib/print-batch';

	let {
		value = $bindable<DocumentChoice>('or'),
		printAfter = $bindable(true),
		guestName = '',
		plural = false
	}: {
		value: DocumentChoice;
		/** Open the print window as soon as the payment is recorded. */
		printAfter: boolean;
		/** Pre-fills the invoice's "billed to". */
		guestName?: string;
		/** A table with several orders: one document per order. */
		plural?: boolean;
	} = $props();

	const CHOICES: DocumentChoice[] = ['or', 'invoice', 'bill'];
	const PREF_KEY = 'dining-print-after-pay';

	// Remembered per device, like the Quick Sale printing preference. Storage can be blocked, so it only ever improves the default.
	$effect(() => {
		try {
			const saved = localStorage.getItem(PREF_KEY);
			if (saved !== null) printAfter = saved === '1';
		} catch {
			/* keep the default */
		}
	});
	function setPrintAfter(next: boolean) {
		printAfter = next;
		try {
			localStorage.setItem(PREF_KEY, next ? '1' : '0');
		} catch {
			/* not remembered, still works */
		}
	}

	const each = $derived(plural ? ' for each order' : '');
	const HINT = $derived<Record<DocumentChoice, string>>({
		or: `Issues an official receipt${each} and prints it.`,
		invoice: `Issues an invoice${each} instead of a receipt and prints it.`,
		bill: 'No receipt or invoice is issued. Prints a plain bill with the items and total; you can issue either later from the order.'
	});
</script>

<div>
	<Label class="text-xs">Print</Label>
	<ToggleGroup.Root
		type="single"
		bind:value={() => value, (v) => { if (v) value = v as DocumentChoice; }}
		variant="outline"
		class="mt-1 w-full"
		aria-label="What to print"
	>
		{#each CHOICES as c (c)}
			<ToggleGroup.Item value={c} class="flex-1">{DOCUMENT_CHOICE_LABEL[c]}</ToggleGroup.Item>
		{/each}
	</ToggleGroup.Root>
	<input type="hidden" name="documents" {value} />
	<p class="mt-1.5 text-xs text-ink-muted" aria-live="polite">{HINT[value]}</p>

	{#if value === 'invoice'}
		<details class="mt-2 rounded-lg border border-border px-3 py-2 text-sm">
			<summary class="cursor-pointer font-medium text-ink">Bill to (optional)</summary>
			<div class="mt-2 space-y-2">
				<div>
					<Label for="billToName" class="text-xs">Name</Label>
					<Input id="billToName" name="billToName" maxlength={160} value={guestName} class="mt-1" />
				</div>
				<div>
					<Label for="billToTin" class="text-xs">TIN</Label>
					<Input id="billToTin" name="billToTin" maxlength={40} class="mt-1" />
				</div>
				<div>
					<Label for="billToAddress" class="text-xs">Address</Label>
					<Input id="billToAddress" name="billToAddress" maxlength={300} class="mt-1" />
				</div>
			</div>
		</details>
	{/if}

	<label class="mt-2 flex cursor-pointer items-center gap-2 text-sm text-ink">
		<input
			type="checkbox"
			class="size-4 rounded border-border accent-[var(--brand)]"
			checked={printAfter}
			onchange={(e) => setPrintAfter(e.currentTarget.checked)}
		/>
		<PrinterIcon class="size-3.5 text-ink-muted" aria-hidden="true" />
		Print right after paying
	</label>
</div>
