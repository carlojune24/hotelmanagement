<script lang="ts">
	import '@fontsource-variable/inter';
	import '@fontsource-variable/jetbrains-mono';

	let { children } = $props();
</script>

<div class="print-shell">
	<div class="print-toolbar">
		<button type="button" onclick={() => window.print()}>Print / Save as PDF</button>
	</div>
	{@render children()}
</div>

<style>
	:global(html) {
		color-scheme: light;
	}
	.print-shell {
		min-height: 100vh;
		background: #6b6b6b;
		padding-bottom: 40px;
	}
	.print-toolbar {
		display: flex;
		justify-content: center;
		padding: 16px;
	}
	.print-toolbar button {
		border: 1px solid #1a1a1a;
		background: #fff;
		color: #1a1a1a;
		font: 500 13px/1 'Inter Variable', system-ui, sans-serif;
		padding: 9px 18px;
		cursor: pointer;
	}
	.print-toolbar button:hover {
		background: #f0efec;
	}
	@media print {
		.print-shell {
			background: #fff;
			padding: 0;
		}
		.print-toolbar {
			display: none;
		}
	}
</style>
