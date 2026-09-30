<script lang="ts">
	import { goto } from '$app/navigation';
	import RosterPrint from '$lib/components/print/roster-print.svelte';
	import { addDays, monthBounds } from '$lib/roster';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const utc = (d: string) => new Date(`${d}T00:00:00Z`);

	function href(over: Record<string, string | null>): string {
		const q = new URLSearchParams();
		const next = {
			view: data.view,
			date: data.date,
			period: data.period,
			employee: data.selectedEmployeeId,
			...over
		};
		for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
		// `period` and `employee` only mean something on the per-employee sheets.
		if (next.view !== 'employee') {
			q.delete('period');
			q.delete('employee');
		}
		return `?${q.toString()}`;
	}

	/** Previous/next = one week, or one month, depending on what the sheet covers. */
	function step(dir: -1 | 1): string {
		if (data.span === 'week') return addDays(data.date, dir * 7);
		const { start, end } = monthBounds(data.date);
		return dir < 0 ? addDays(start, -1) : addDays(end, 1);
	}

	const tabs = [
		{ view: 'week', label: 'Week' },
		{ view: 'month', label: 'Month' },
		{ view: 'employee', label: 'By employee' }
	] as const;

	const title = $derived(
		`${data.view === 'employee' ? 'Work schedule' : data.span === 'week' ? 'Weekly staff schedule' : 'Monthly staff schedule'} — ${data.range.start}${data.span === 'week' ? ` to ${data.range.end}` : ''}`
	);
	// Grids want landscape; per-employee sheets are portrait.
	const pageCss = $derived(
		`@page { size: A4 ${data.view === 'employee' ? 'portrait' : 'landscape'}; margin: 10mm; }`
	);
</script>

<svelte:head>
	<title>{title}</title>
	{@html `<style>${pageCss}</style>`}
</svelte:head>

<div class="rp-controls">
	<div class="rp-tabs" role="tablist" aria-label="Schedule layout">
		{#each tabs as t (t.view)}
			<a
				href={href({ view: t.view })}
				role="tab"
				aria-selected={data.view === t.view}
				class:on={data.view === t.view}>{t.label}</a
			>
		{/each}
	</div>
	<div class="rp-step">
		<a href={href({ date: step(-1) })} aria-label="Previous {data.span}">‹</a>
		<span class="rp-range">
			{#if data.span === 'week'}
				{utc(data.range.start).toLocaleDateString('en-US', {
					month: 'short',
					day: 'numeric',
					timeZone: 'UTC'
				})} –
				{utc(data.range.end).toLocaleDateString('en-US', {
					month: 'short',
					day: 'numeric',
					year: 'numeric',
					timeZone: 'UTC'
				})}
			{:else}
				{utc(data.range.start).toLocaleDateString('en-US', {
					month: 'long',
					year: 'numeric',
					timeZone: 'UTC'
				})}
			{/if}
		</span>
		<a href={href({ date: step(1) })} aria-label="Next {data.span}">›</a>
	</div>
	{#if data.view === 'employee'}
		<div class="rp-pick">
			<a href={href({ period: 'week' })} class:on={data.period === 'week'}>Week</a>
			<a href={href({ period: 'month' })} class:on={data.period === 'month'}>Month</a>
			<select
				aria-label="Employee"
				value={data.selectedEmployeeId ?? ''}
				onchange={(e) => goto(href({ employee: e.currentTarget.value || null }))}
			>
				<option value="">Everyone ({data.pickerEmployees.length})</option>
				{#each data.pickerEmployees as emp (emp.id)}
					<option value={emp.id}>{emp.name}</option>
				{/each}
			</select>
		</div>
	{/if}
</div>

<RosterPrint
	view={data.view}
	span={data.span}
	range={data.range}
	days={data.days}
	employees={data.employees}
	entries={data.entries}
	legend={data.legend}
	hotel={data.hotel}
	printedAt={data.printedAt}
/>

<style>
	.rp-controls {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: 10px 22px;
		padding: 0 16px 16px;
		font:
			500 13px/1 'Inter Variable',
			system-ui,
			sans-serif;
	}
	.rp-tabs,
	.rp-step,
	.rp-pick {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	a {
		border: 1px solid #1a1a1a;
		background: #fff;
		color: #1a1a1a;
		padding: 8px 14px;
		text-decoration: none;
	}
	a:hover {
		background: #f0efec;
	}
	a.on,
	a[aria-selected='true'] {
		background: #1a1a1a;
		color: #fff;
	}
	.rp-step a {
		padding: 8px 12px;
	}
	.rp-range {
		min-width: 150px;
		text-align: center;
		color: #fff;
	}
	select {
		border: 1px solid #1a1a1a;
		background: #fff;
		color: #1a1a1a;
		font: inherit;
		padding: 8px 10px;
	}
	@media print {
		.rp-controls {
			display: none;
		}
	}
</style>
