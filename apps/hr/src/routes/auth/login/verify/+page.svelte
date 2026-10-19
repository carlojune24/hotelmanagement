<script lang="ts">
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const POINTS = [
		'The code is only valid once.',
		'It stops working after 5 wrong tries or 10 minutes.',
		'Nobody from HR will ever ask you for it.'
	];
</script>

<svelte:head><title>Enter your code · HR</title></svelte:head>

<AuthShell
	brandName={data.orgName}
	logoUrl={data.logoUrl}
	headline="One more step to sign in."
	blurb="Your password was right. To keep payroll and personal records safe, we also check that this is really you."
	points={POINTS}
	note="Staff access only."
	step="code"
	codeEmail={data.email}
	codeMinutes={data.minutes}
	sendsLeft={data.sendsLeft}
	info={form && 'info' in form ? form.info : null}
	mailFailed={data.mailFailed}
	error={form && 'error' in form ? form.error : null}
	backHref={null}
/>
