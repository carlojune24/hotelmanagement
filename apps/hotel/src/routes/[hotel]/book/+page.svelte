<script lang="ts">
	import { ui } from '$lib/components/ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<div class="mx-auto max-w-2xl px-4 py-16 text-center">
	<h1 class={ui.h1}>{data.hotel?.name ?? 'Booking'}</h1>
	<p class="mt-3 text-sm text-ink-muted">
		Online booking opens in Phase 1. Check back soon.
	</p>
</div>
