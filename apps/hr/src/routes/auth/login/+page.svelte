<script lang="ts">
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const POINTS = [
		'Managers submit rosters, leave and overtime; Main HR approves.',
		'DTRs are built from the biometric data, then sent to Main HR to lock.',
		'Payslips are released after each payroll run.'
	];
</script>

<svelte:head><title>Sign in · HR</title></svelte:head>

<AuthShell
	brandName={data.orgName}
	logoUrl={data.logoUrl}
	headline="One cutoff, every business, one payroll."
	blurb="Rosters, leave, overtime and DTRs from every establishment come together here, so Main HR can run payroll without chasing anyone."
	points={POINTS}
	note="Staff access only. Ask Main HR if you need an account."
	next={data.next}
	error={form?.error ?? data.notice}
	backHref={null}
/>
