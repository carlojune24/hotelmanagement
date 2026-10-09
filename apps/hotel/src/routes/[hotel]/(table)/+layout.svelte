<script lang="ts">
	import '../(guest)/woven-ledger.css';
	import './table-ordering.css';
	import { themeStyle } from '$lib/table-theme';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	// The same hotel theme the booking site wears, so the guest sees one brand from the room page to the table.
	const rootStyle = $derived(themeStyle(data.theme, data.branding));
</script>

<div class="woven-ledger tq-root" style={rootStyle}>
	{@render children()}
</div>
