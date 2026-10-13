<script lang="ts">
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLTableRowElement>> = $props();
</script>

<tr bind:this={ref} data-slot="table-row" class={cn("border-b border-dotted border-foreground/20 transition-colors hover:bg-gold-soft data-[state=selected]:bg-gold", className)} {...restProps}>
	{@render children?.()}
</tr>
