<script lang="ts">
	import MessageSquareWarningIcon from '@lucide/svelte/icons/message-square-warning';
	import { Button } from '$lib/components/ui/button';

	/**
	 * A guest's special request, shown where staff cannot miss it: amber-tinted block, 16px text, never truncated.
	 * Amber carries the tint, border and icon only; the words stay `text-ink` so contrast holds in both themes.
	 * Pass `onedit` to show an Edit button (admins). Render it only when there is a request: an empty one should stay quiet.
	 */
	let { text, onedit }: { text: string; onedit?: () => void } = $props();
</script>

<div class="rounded-lg border border-warning/50 bg-warning/10 p-3" role="note" aria-label="Special request">
	<div class="flex items-center gap-2">
		<span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-warning/25 text-ink">
			<MessageSquareWarningIcon class="size-3.5" aria-hidden="true" />
		</span>
		<span class="text-sm font-semibold text-ink">Special request</span>
		{#if onedit}
			<Button variant="ghost" size="sm" class="ml-auto h-6 px-2 text-xs" onclick={onedit}>Edit</Button>
		{/if}
	</div>
	<p class="mt-2 text-base leading-snug font-medium break-words whitespace-pre-wrap text-ink">{text}</p>
</div>
