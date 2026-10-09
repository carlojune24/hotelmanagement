<script lang="ts">
	import { goto } from '$app/navigation';
	import DtrPrint from '$lib/components/print/dtr-print.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function href(over: { month?: string; employee?: string | null }): string {
		const q = new URLSearchParams();
		q.set('month', over.month ?? data.month);
		const employee = 'employee' in over ? over.employee : data.selectedEmployeeId;
		if (employee) q.set('employee', employee);
		return `?${q.toString()}`;
	}
	function stepMonth(delta: number): string {
		const [y = 0, m = 1] = data.month.split('-').map(Number);
		return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
	}
	const label = $derived(
		new Date(`${data.month}-01T00:00:00Z`).toLocaleDateString('en-US', {
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		})
	);
</script>

<svelte:head>
	<title>Daily Time Record — {label}</title>
	{@html `<style>@page { size: A4 portrait; margin: 10mm; }</style>`}
</svelte:head>

<div class="dp-controls">
	<div class="dp-step">
		<a href={href({ month: stepMonth(-1) })} aria-label="Previous month">‹</a>
		<span class="dp-range">{label}</span>
		<a href={href({ month: stepMonth(1) })} aria-label="Next month">›</a>
	</div>
	<select
		aria-label="Employee"
		value={data.selectedEmployeeId ?? ''}
		onchange={(e) => goto(href({ employee: e.currentTarget.value || null }))}
	>
		<option value="">Everyone with a saved record</option>
		{#each data.pickerEmployees as emp (emp.id)}
			<option value={emp.id}>{emp.name}</option>
		{/each}
	</select>
</div>

<DtrPrint sheets={data.sheets} month={data.month} hotelName={data.hotel.name} />

<style>
	.dp-controls {
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
	.dp-step {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	a {
		border: 1px solid #1a1a1a;
		background: #fff;
		color: #1a1a1a;
		padding: 8px 12px;
		text-decoration: none;
	}
	a:hover {
		background: #f0efec;
	}
	.dp-range {
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
		.dp-controls {
			display: none;
		}
	}
</style>
