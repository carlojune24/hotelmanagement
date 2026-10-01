<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { PERMIT_STATUS_LABEL, type PermitStatus } from '$lib/city/permits';

	let { status }: { status: PermitStatus } = $props();

	const cls: Record<PermitStatus, string> = {
		valid: 'border-transparent bg-ok/15 text-ok',
		expiring: 'border-transparent bg-warning/15 text-warning',
		expired: 'border-transparent bg-danger/10 text-danger',
		none: 'border-border bg-surface text-ink-muted'
	};
</script>

<Badge variant="outline" class={cls[status]}>{PERMIT_STATUS_LABEL[status]}</Badge>
