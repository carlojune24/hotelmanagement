<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { STATUS_LABEL, type ApplicationStatus } from '$lib/city/applications';

	let { status }: { status: ApplicationStatus } = $props();

	const cls: Record<ApplicationStatus, string> = {
		pending: 'border-transparent bg-warning/15 text-warning',
		approved: 'border-transparent bg-brand/15 text-brand',
		rejected: 'border-transparent bg-danger/10 text-danger',
		finalized: 'border-transparent bg-ok/15 text-ok'
	};
</script>

<Badge variant="outline" class={cls[status]}>{STATUS_LABEL[status]}</Badge>
