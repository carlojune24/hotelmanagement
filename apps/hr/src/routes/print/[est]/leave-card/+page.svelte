<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const STATUS: Record<string, string> = { active: 'Active', on_leave: 'On leave', separated: 'Separated' };
	const day = (iso: string) =>
		new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' });
	const range = (s: string, e: string | null, half: 'am' | 'pm' | null) =>
		(e ? `${day(s)} – ${day(e)}` : day(s)) + (half ? ` (${half.toUpperCase()})` : '');
	const n = (v: number) => (Math.round(v * 100) / 100).toString();
</script>

<svelte:head>
	<title>Leave cards · {data.establishment} · {data.year}</title>
	<style>
		@page {
			size: A4 portrait;
			margin: 12mm;
		}
	</style>
</svelte:head>

<div class="mx-auto flex max-w-3xl justify-end p-4 print:hidden">
	<button class="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground" onclick={() => window.print()}>
		Print / save as PDF
	</button>
</div>

{#if data.cards.length === 0}
	<p class="mx-auto max-w-3xl p-8 text-sm text-ink-muted">No employees to print.</p>
{/if}

{#each data.cards as card (card.employee.id)}
	<article class="mx-auto my-4 max-w-3xl bg-white p-8 text-sm text-ink shadow-sm print:my-0 print:max-w-none print:break-after-page print:shadow-none">
		<header class="flex items-start justify-between border-b border-ink/30 pb-3">
			<div>
				<h1 class="text-xl font-semibold">{data.company}</h1>
				<p class="text-ink-muted">{data.establishment}</p>
			</div>
			<div class="text-right">
				<p class="text-lg font-semibold tracking-wide uppercase">Leave card</p>
				<p class="text-ink-muted tabular-nums">{card.year}</p>
			</div>
		</header>

		<dl class="mt-3 grid grid-cols-2 gap-x-8 gap-y-1">
			<div class="flex justify-between"><dt class="text-ink-muted">Employee</dt><dd class="font-medium">{card.employee.name}</dd></div>
			<div class="flex justify-between"><dt class="text-ink-muted">Employee no.</dt><dd class="tabular-nums">{card.employee.no}</dd></div>
			<div class="flex justify-between"><dt class="text-ink-muted">Position</dt><dd>{card.employee.position || '—'}</dd></div>
			<div class="flex justify-between"><dt class="text-ink-muted">Status</dt><dd>{STATUS[card.employee.status] ?? card.employee.status}</dd></div>
			<div class="flex justify-between"><dt class="text-ink-muted">Date hired</dt><dd class="tabular-nums">{card.employee.hiredOn}</dd></div>
		</dl>

		{#each card.blocks as b (b.type.id)}
			<section class="mt-5 break-inside-avoid">
				<div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink/30 pb-1">
					<h2 class="font-semibold">{b.type.name}</h2>
					<p class="text-xs text-ink-muted tabular-nums">
						Entitled {n(b.entitled)} · Carried over {n(b.carried)}{b.adjusted !== 0 ? ` · Adjusted ${b.adjusted > 0 ? '+' : ''}${n(b.adjusted)}` : ''}
						= <span class="font-medium text-ink">{n(b.entitled + b.carried + b.adjusted)}</span>
					</p>
				</div>
				{#if b.entries.length > 0}
					<table class="w-full border-collapse">
						<thead>
							<tr class="border-b border-ink/20 text-left text-xs text-ink-muted">
								<th class="py-1 font-normal">Date(s)</th>
								<th class="font-normal">Particulars</th>
								<th class="text-right font-normal">Days</th>
								<th class="pl-3 font-normal">Paid</th>
								<th class="font-normal">Approved by</th>
								<th class="text-right font-normal">Balance</th>
							</tr>
						</thead>
						<tbody>
							{#each b.entries as e, i (i)}
								<tr class="border-b border-ink/10 align-top">
									<td class="py-1 whitespace-nowrap tabular-nums">{range(e.date, e.endDate, e.halfDay)}</td>
									<td>{e.particulars}{e.status === 'submitted' ? ' (waiting for approval)' : ''}</td>
									<td class="text-right tabular-nums">{e.kind === 'adjustment' ? (e.days > 0 ? '+' : '') : '−'}{n(Math.abs(e.days))}</td>
									<td class="pl-3">{e.paid === null ? '' : e.paid ? 'Yes' : 'No'}</td>
									<td>{e.approvedBy ?? ''}</td>
									<td class="text-right tabular-nums">{n(e.balance)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{:else}
					<p class="py-1 text-xs text-ink-muted">No leave taken.</p>
				{/if}
				<p class="mt-1 text-right text-xs tabular-nums">
					Used <span class="font-medium">{n(b.used)}</span> · Remaining <span class="font-semibold">{n(b.remaining)}</span>
				</p>
			</section>
		{:else}
			<p class="mt-5 text-ink-muted">No leave types apply to this employee.</p>
		{/each}

		<footer class="mt-10 grid grid-cols-3 gap-8 text-xs text-ink-muted">
			{#each ['Employee', 'Manager', 'Main HR'] as who (who)}
				<div class="border-t border-ink/40 pt-1 text-center">{who}</div>
			{/each}
		</footer>
	</article>
{/each}
