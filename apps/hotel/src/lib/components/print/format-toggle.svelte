<script lang="ts">
	import { page } from '$app/state';

	let { format }: { format: 'thermal' | 'a4' } = $props();

	const otherHref = $derived.by(() => {
		const url = new URL(page.url);
		if (format === 'thermal') url.searchParams.set('format', 'a4');
		else url.searchParams.delete('format');
		return `${url.pathname}${url.search}`;
	});
</script>

<div class="pf-toggle">
	<a href={otherHref}>{format === 'thermal' ? 'View full-page (A4)' : 'View thermal receipt'}</a>
</div>

<style>
	.pf-toggle {
		text-align: center;
		padding: 14px 0 0;
	}
	.pf-toggle a {
		font: 500 12px/1 'Inter Variable', system-ui, sans-serif;
		color: #55524c;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.pf-toggle a:hover {
		color: #1a1a1a;
	}
	@media print {
		.pf-toggle {
			display: none;
		}
	}
</style>
