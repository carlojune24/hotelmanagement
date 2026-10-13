<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { BatchView } from '$lib/server/hr/payroll-view';
	import { money } from './money';

	let { b }: { b: BatchView } = $props();
</script>

<p class="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
	<Badge variant={b.dtrReceived ? 'ok' : 'muted'}>
		DTR {b.dtrReceived ? 'received' : 'not received'}
	</Badge>
	<Badge variant={b.status === 'released' ? 'ok' : b.status === 'locked' ? 'gold' : 'muted'}>
		{b.status === 'released' ? 'Released' : b.status === 'locked' ? 'Locked' : 'Draft'}
	</Badge>
	{#if b.count > 0}
		<span class="tabular-nums">{b.count} payslip{b.count === 1 ? '' : 's'} · net {money(b.net)}</span>
	{/if}
</p>
