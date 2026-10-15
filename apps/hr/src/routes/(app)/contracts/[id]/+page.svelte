<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { EMPLOYMENT_TYPE_LABEL } from '$lib/leave';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const c = $derived(data.contract);
	let busy = $state(false);

	const day = (d: string) =>
		new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
	const STATUS = {
		issued: { label: 'Issued, not yet signed', variant: 'gold' },
		signed: { label: 'Signed', variant: 'ok' },
		void: { label: 'Void', variant: 'muted' }
	} as const;
	const kb = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);

	$effect(() => {
		if (form && 'error' in form && form.error) toast.error(form.error);
		else if (form && 'ok' in form && form.ok) toast.success(form.ok);
	});
	function submit() {
		busy = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: true });
			busy = false;
		};
	}
</script>

<svelte:head><title>Contract · HR</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
	<div>
		<a href="/contracts" class="text-sm text-ink-muted underline-offset-4 hover:underline">← Contracts</a>
		<div class="mt-1 flex flex-wrap items-end justify-between gap-3">
			<div>
				<h1 class="text-4xl font-light tracking-tight">{c.employeeName}</h1>
				<p class="mt-1 text-sm text-ink-muted">
					{EMPLOYMENT_TYPE_LABEL[c.kind as keyof typeof EMPLOYMENT_TYPE_LABEL] ?? c.kind} · {c.position} · #{c.employeeNo}
				</p>
			</div>
			<div class="flex items-center gap-2">
				<Badge variant={STATUS[c.status].variant}>{STATUS[c.status].label}</Badge>
				<Button variant="outline" href="/print/contract/{c.id}" target="_blank" rel="noopener">Print</Button>
			</div>
		</div>
	</div>

	<div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
		<section class="panel p-5 md:p-6" aria-label="Contract">
			<p class="text-xs text-ink-muted">
				Issued {day(c.issuedOn)} · {day(c.startDate)} → {c.endDate ? day(c.endDate) : 'no end date'}. This is the wording as
				issued; it does not change if the template or the person's pay changes later.
			</p>
			<pre class="mt-4 font-sans text-sm leading-relaxed whitespace-pre-wrap">{c.body}</pre>
		</section>

		<div class="space-y-6">
			<section class="panel space-y-3 p-5" aria-label="Signed copy">
				<h2 class="text-xl font-light">Signed copy</h2>
				{#if c.status === 'void'}
					<p class="text-sm text-ink-muted">Voided{c.voidReason ? `: ${c.voidReason}` : ''}. Issue a new contract to change the terms.</p>
				{:else}
					{#if c.hasFile}
						<p class="text-sm">
							<a href="/contracts/{c.id}/file" target="_blank" rel="noopener" class="underline underline-offset-4">{c.fileName}</a>
							<span class="text-ink-muted">· {c.fileSize ? kb(c.fileSize) : ''}{c.signedOn ? ` · signed ${day(c.signedOn)}` : ''}</span>
						</p>
					{:else}
						<p class="text-sm text-ink-muted">Print it, have it signed, then upload the scan or photo here.</p>
					{/if}
					<form method="POST" action="?/sign" enctype="multipart/form-data" use:enhance={submit} class="space-y-2">
						<div class="space-y-1.5">
							<Label for="signedOn">Date signed</Label>
							<Input id="signedOn" name="signedOn" type="date" />
						</div>
						<div class="space-y-1.5">
							<Label for="file">{c.hasFile ? 'Replace the signed copy' : 'Signed copy'}</Label>
							<Input id="file" name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required />
						</div>
						<Button type="submit" variant="gold" disabled={busy}>Save signed copy</Button>
					</form>
				{/if}
			</section>

			{#if c.status !== 'void'}
				<section class="panel space-y-3 p-5" aria-label="Void">
					<h2 class="text-xl font-light">Void</h2>
					<p class="text-sm text-ink-muted">
						A contract is not edited. To change a term, void it and issue a new one.
					</p>
					<form method="POST" action="?/void" use:enhance={submit} class="space-y-2">
						<Input name="reason" placeholder="Why it is being voided" required minlength={3} maxlength={300} aria-label="Reason" />
						<Button type="submit" variant="outline" disabled={busy}>Void this contract</Button>
					</form>
				</section>
			{/if}
		</div>
	</div>
</div>
