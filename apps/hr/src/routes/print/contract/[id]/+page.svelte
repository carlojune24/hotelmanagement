<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Contract · {data.employeeName}</title>
	<style>
		@page {
			size: A4 portrait;
			margin: 18mm;
		}
	</style>
</svelte:head>

<div class="mx-auto flex max-w-3xl justify-end p-4 print:hidden">
	<button class="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground" onclick={() => window.print()}>
		Print / save as PDF
	</button>
</div>

<article class="mx-auto my-4 max-w-3xl bg-white p-10 text-ink shadow-sm print:my-0 print:p-0 print:shadow-none">
	{#if data.status === 'void'}
		<p class="mb-4 rounded-lg border border-dashed border-danger/60 px-3 py-2 text-sm text-danger print:text-base">
			VOID. This contract has been voided and must not be signed.
		</p>
	{/if}
	{#if data.logoUrl}
		<img src={data.logoUrl} alt="" class="mb-6 h-14 w-auto max-w-56 object-contain" />
	{/if}
	<pre class="font-sans text-[13px] leading-relaxed whitespace-pre-wrap">{data.body}</pre>

	{#if data.signatures.length > 0}
		<div class="mt-16 grid gap-10 break-inside-avoid" style="grid-template-columns: repeat({data.signatures.length}, minmax(0, 1fr))">
			{#each data.signatures as s (s.role + s.name)}
				<div class="border-t border-ink/60 pt-1.5 text-center">
					<p class="text-[13px] font-medium">{s.name}</p>
					<p class="text-[11px] text-ink-muted">{s.role}</p>
					<p class="mt-5 text-[11px] text-ink-muted">Date signed: ____________________</p>
				</div>
			{/each}
		</div>
	{/if}

	<footer class="mt-10 flex items-end justify-between gap-6 border-t border-ink/25 pt-4 break-inside-avoid">
		<div class="text-[11px] leading-relaxed text-ink-muted">
			<p class="font-medium text-ink">Verify this contract</p>
			<p>Scan the code, or open the address below, to confirm that this copy is genuine and still in force.</p>
			<p class="break-all">{data.verifyUrl}</p>
			<p class="mt-1">Fingerprint <span class="font-mono text-ink">{data.fingerprint}</span></p>
		</div>
		<div class="size-24 shrink-0 [&_svg]:size-full" role="img" aria-label="QR code to verify this contract">
			{@html data.qr}
		</div>
	</footer>
</article>
