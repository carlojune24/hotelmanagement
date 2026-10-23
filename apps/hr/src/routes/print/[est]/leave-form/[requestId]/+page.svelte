<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const STATUS: Record<string, string> = {
		approved: 'Approved',
		submitted: 'Waiting for approval',
		rejected: 'Rejected',
		cancelled: 'Cancelled'
	};
	const r = $derived(data.request);
	const n = (v: number) => (Math.round(v * 100) / 100).toString();
	const when = $derived(r.start === r.end ? r.start : `${r.start} to ${r.end}`);
</script>

<svelte:head>
	<title>Leave form · {data.employee?.name ?? ''}</title>
	<style>
		@page {
			size: A4 portrait;
			margin: 14mm;
		}
	</style>
</svelte:head>

<div class="mx-auto flex max-w-3xl justify-end p-4 print:hidden">
	<button class="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground" onclick={() => window.print()}>
		Print / save as PDF
	</button>
</div>

<article class="mx-auto my-4 max-w-3xl bg-white p-8 text-sm text-ink shadow-sm print:my-0 print:shadow-none">
	<header class="flex items-start justify-between border-b border-ink/30 pb-3">
		<div>
			<h1 class="text-xl font-semibold">{data.company}</h1>
			<p class="text-ink-muted">{data.establishment}</p>
		</div>
		<p class="text-lg font-semibold tracking-wide uppercase">Leave application</p>
	</header>

	<dl class="mt-4 grid grid-cols-2 gap-x-8 gap-y-1.5">
		<div class="flex justify-between"><dt class="text-ink-muted">Employee</dt><dd class="font-medium">{data.employee?.name ?? '—'}</dd></div>
		<div class="flex justify-between"><dt class="text-ink-muted">Employee no.</dt><dd class="tabular-nums">{data.employee?.no ?? '—'}</dd></div>
		<div class="flex justify-between"><dt class="text-ink-muted">Position</dt><dd>{data.employee?.position || '—'}</dd></div>
		<div class="flex justify-between"><dt class="text-ink-muted">Date hired</dt><dd class="tabular-nums">{data.employee?.hiredOn ?? '—'}</dd></div>
	</dl>

	<dl class="mt-5 grid grid-cols-2 gap-x-8 gap-y-1.5 border-t border-ink/20 pt-4">
		<div class="flex justify-between"><dt class="text-ink-muted">Type of leave</dt><dd class="font-medium">{data.typeName}</dd></div>
		<div class="flex justify-between"><dt class="text-ink-muted">Paid</dt><dd>{r.paid ? 'Paid' : 'Unpaid'}</dd></div>
		<div class="flex justify-between"><dt class="text-ink-muted">Date(s)</dt><dd class="tabular-nums">{when}{r.halfDay ? ` (${r.halfDay === 'am' ? 'morning' : 'afternoon'} only)` : ''}</dd></div>
		<div class="flex justify-between"><dt class="text-ink-muted">Days</dt><dd class="tabular-nums">{n(r.days)}</dd></div>
		<div class="flex justify-between"><dt class="text-ink-muted">Filed</dt><dd class="tabular-nums">{r.filedAt}{data.filedBy ? ` by ${data.filedBy}` : ''}</dd></div>
		<div class="flex justify-between"><dt class="text-ink-muted">Status</dt><dd class="font-medium">{STATUS[r.status] ?? r.status}</dd></div>
	</dl>

	<div class="mt-5">
		<p class="text-ink-muted">Reason</p>
		<p class="min-h-10 border-b border-ink/30 pb-1">{r.reason || ' '}</p>
		{#if r.documentNote}
			<p class="mt-2 text-ink-muted">Supporting document</p>
			<p>{r.documentNote}</p>
		{/if}
	</div>

	{#if data.before !== null && data.after !== null}
		<table class="mt-5 w-full border-collapse">
			<caption class="pb-1 text-left text-ink-muted">{data.typeName} balance</caption>
			<tbody>
				<tr class="border-y border-ink/20">
					<td class="py-1.5">Before this leave</td>
					<td class="text-right tabular-nums">{n(data.before)}</td>
					<td class="pl-6">This leave</td>
					<td class="text-right tabular-nums">{r.status === 'approved' || r.status === 'submitted' ? `− ${n(r.days)}` : '—'}</td>
					<td class="pl-6">Balance after</td>
					<td class="text-right font-semibold tabular-nums">{n(data.after)}</td>
				</tr>
			</tbody>
		</table>
	{/if}

	{#if r.status !== 'submitted'}
		<p class="mt-5">
			<span class="text-ink-muted">Decision:</span>
			{STATUS[r.status] ?? r.status}{data.decidedBy ? ` by ${data.decidedBy}` : ''}{r.decidedAt ? ` on ${r.decidedAt}` : ''}
			{#if r.decisionNote}— {r.decisionNote}{/if}
			{#if r.cancelNote}— {r.cancelNote}{/if}
		</p>
	{/if}

	<footer class="mt-14 grid grid-cols-3 gap-8 text-xs text-ink-muted">
		{#each ['Employee', 'Manager', 'Main HR'] as who (who)}
			<div class="border-t border-ink/40 pt-1 text-center">{who}</div>
		{/each}
	</footer>
</article>
