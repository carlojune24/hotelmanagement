<script lang="ts">
	import { EMPLOYMENT_TYPE_LABEL } from '$lib/leave';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const c = $derived(data.contract);

	const day = (d: string) =>
		new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
	const STATUS = {
		issued: { label: 'Genuine · issued', note: 'Issued by the company; not yet recorded as signed.', tone: 'ok' },
		signed: { label: 'Genuine · signed', note: 'Issued by the company and a signed copy is on file.', tone: 'ok' },
		void: { label: 'VOID', note: 'This contract was withdrawn and is no longer valid. Do not rely on a printed copy.', tone: 'bad' }
	} as const;
</script>

<svelte:head>
	<title>Verify contract</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6">
	<h1 class="text-3xl font-light tracking-tight">Contract verification</h1>

	{#if !c}
		<section class="panel space-y-2 p-6" aria-live="polite">
			<p class="text-lg font-medium text-danger">Not found</p>
			<p class="text-sm text-ink-muted">
				No contract matches this code. The copy you hold may be altered or not issued by this company. Please ask the
				company directly.
			</p>
		</section>
	{:else}
		{@const s = STATUS[c.status]}
		<section class="panel space-y-4 p-6" aria-live="polite">
			<div>
				<p class="text-lg font-medium {s.tone === 'bad' ? 'text-danger' : ''}">{s.label}</p>
				<p class="text-sm text-ink-muted">{s.note}</p>
			</div>
			<dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
				<div><dt class="text-xs text-ink-muted">Issued by</dt><dd class="font-medium">{c.issuedBy}</dd></div>
				<div><dt class="text-xs text-ink-muted">Issued on</dt><dd class="font-medium">{day(c.issuedOn)}</dd></div>
				<div><dt class="text-xs text-ink-muted">Employee</dt><dd class="font-medium">{c.employee}</dd></div>
				<div><dt class="text-xs text-ink-muted">Position</dt><dd class="font-medium">{c.position}</dd></div>
				<div>
					<dt class="text-xs text-ink-muted">Type</dt>
					<dd class="font-medium">{EMPLOYMENT_TYPE_LABEL[c.kind as keyof typeof EMPLOYMENT_TYPE_LABEL] ?? c.kind}</dd>
				</div>
				<div>
					<dt class="text-xs text-ink-muted">Term</dt>
					<dd class="font-medium">{day(c.startDate)}{c.endDate ? ` to ${day(c.endDate)}` : ', no end date'}</dd>
				</div>
				{#if c.signedOn}
					<div><dt class="text-xs text-ink-muted">Signed</dt><dd class="font-medium">{day(c.signedOn)}</dd></div>
				{/if}
			</dl>
			<div class="rounded-xl bg-ink/5 px-4 py-3">
				<p class="text-xs text-ink-muted">Document fingerprint</p>
				<p class="font-mono text-sm font-medium tracking-wide">{c.fingerprint}</p>
				<p class="mt-1 text-xs text-ink-muted">It must match the fingerprint printed on your copy.</p>
			</div>
		</section>
	{/if}
	<p class="text-xs text-ink-muted">This page shows only what is needed to confirm a contract. It never shows pay or contact details.</p>
</main>
