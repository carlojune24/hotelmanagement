<script lang="ts">
	import { toast } from 'svelte-sonner';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import TicketIcon from '@lucide/svelte/icons/ticket';

	/**
	 * The guest's confirmation code (first 8 characters of the order id, uppercased — the same code their
	 * confirmation page and email show), large enough for the front desk to read it against what the guest
	 * holds up, with a copy button.
	 */
	let { orderId }: { orderId: string } = $props();
	const code = $derived(orderId.slice(0, 8).toUpperCase());

	async function copy() {
		try {
			await navigator.clipboard.writeText(code);
			toast.success(`Copied ${code}`);
		} catch {
			toast.error("Couldn't copy. Select the code instead.");
		}
	}
</script>

<span class="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 py-1 pr-1 pl-2.5">
	<TicketIcon class="size-3.5 text-ink-muted" aria-hidden="true" />
	<span class="text-[11px] font-medium tracking-wide text-ink-muted uppercase">Confirmation code</span>
	<span class="font-mono text-base font-semibold tracking-widest text-ink select-all">{code}</span>
	<button
		type="button"
		class="inline-flex size-7 items-center justify-center rounded text-ink-muted hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
		aria-label="Copy confirmation code {code}"
		onclick={copy}
	>
		<CopyIcon class="size-3.5" aria-hidden="true" />
	</button>
</span>
