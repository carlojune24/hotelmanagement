<script lang="ts">
	import { ui } from '$lib/components/ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<div class={ui.page}>
	<h1 class="{ui.h1} mb-1">Dashboard</h1>
	<p class="mb-6 text-sm text-ink-muted">
		{data.hotel?.name} · {data.hotel?.timezone}
	</p>

	<div class="grid gap-4 sm:grid-cols-3">
		<div class={ui.card}>
			<div class={ui.h2}>Arrivals today</div>
			<div class="mt-2 text-3xl font-semibold text-ink">—</div>
		</div>
		<div class={ui.card}>
			<div class={ui.h2}>In house</div>
			<div class="mt-2 text-3xl font-semibold text-ink">—</div>
		</div>
		<div class={ui.card}>
			<div class={ui.h2}>Cash position</div>
			<div class="mt-2 text-3xl font-semibold text-ink">—</div>
		</div>
	</div>

	<p class="mt-6 text-sm text-ink-muted">
		Modules arrive by phase: front desk &amp; booking next, then housekeeping, finance, HR, and reports.
	</p>
</div>
