<script lang="ts">
	type Clock = { t12: string; t24: string } | null;
	type Day = {
		date: string;
		weekday: string;
		timeIn: Clock;
		breakOut: Clock;
		breakIn: Clock;
		timeOut: Clock;
		workedMinutes: number;
		lateMinutes: number;
		undertimeMinutes: number;
		remarks: string;
		kind: 'work' | 'absent' | 'rest' | 'empty' | 'leave' | 'holiday';
	};
	type Sheet = {
		employee: { name: string; position: string };
		days: Day[];
		totals: {
			workedMinutes: number;
			lateMinutes: number;
			undertimeMinutes: number;
			absentDays: number;
			workedDays: number;
		};
	};

	let {
		sheets,
		month,
		hotelName
	}: { sheets: Sheet[]; month: string; hotelName: string } = $props();

	const monthLabel = $derived(
		new Date(`${month}-01T00:00:00Z`)
			.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
			.toUpperCase()
	);
	const dayNum = (d: string) => d.slice(8, 10);
	const hours = (minutes: number) => (minutes / 60).toFixed(3);
	const notes = (s: Sheet) => s.days.filter((d) => d.kind === 'work' && d.remarks);
	const hasHours = (k: Day['kind']) => k !== 'rest' && k !== 'empty';
</script>

{#each sheets as sheet (sheet.employee.name)}
	<section class="dp-page">
		{#each [0, 1] as copy (copy)}
			<div class="dp-copy">
				<div class="dp-hotel">{hotelName}</div>
				<div class="dp-title">DAILY TIME RECORD</div>
				<div class="dp-emp">{sheet.employee.name.toUpperCase()}</div>
				{#if sheet.employee.position}<div class="dp-pos">{sheet.employee.position}</div>{/if}
				<div class="dp-rule"></div>
				<div class="dp-month">For the month of: <strong>{monthLabel}</strong></div>

				<table>
					<thead>
						<tr>
							<th rowspan="2" class="dp-day">Day</th>
							<th rowspan="2">Arrival</th>
							<th rowspan="2">Departure</th>
							<th rowspan="2">Arrival</th>
							<th rowspan="2">Departure</th>
							<th colspan="3">Remarks</th>
						</tr>
						<tr>
							<th>TD</th>
							<th>UT</th>
							<th>Total</th>
						</tr>
					</thead>
					<tbody>
						{#each sheet.days as d (d.date)}
							<tr class:dp-off={d.kind === 'rest' || d.kind === 'absent'} class:dp-credit={d.kind === 'leave' || d.kind === 'holiday'}>
								<td class="dp-day">{dayNum(d.date)} {d.weekday.toUpperCase()}</td>
								{#if d.kind === 'work'}
									<td>{d.timeIn?.t24 ?? ''}</td>
									<td>{d.breakOut?.t24 ?? ''}</td>
									<td>{d.breakIn?.t24 ?? ''}</td>
									<td>{d.timeOut?.t24 ?? ''}</td>
								{:else}
									<td colspan="4" class="dp-span">
										{d.kind === 'rest'
											? 'DAY OFF'
											: d.kind === 'absent'
												? 'ABSENT'
												: d.kind === 'leave' || d.kind === 'holiday'
													? d.remarks.toUpperCase()
													: ''}
									</td>
								{/if}
								<td>{hasHours(d.kind) ? hours(d.lateMinutes) : ''}</td>
								<td>{hasHours(d.kind) ? hours(d.undertimeMinutes) : ''}</td>
								<td>{hasHours(d.kind) ? hours(d.workedMinutes) : ''}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr>
							<td colspan="5" class="dp-total">TOTAL</td>
							<td>{hours(sheet.totals.lateMinutes)}</td>
							<td>{hours(sheet.totals.undertimeMinutes)}</td>
							<td>{hours(sheet.totals.workedMinutes)}</td>
						</tr>
					</tfoot>
				</table>

				{#if notes(sheet).length > 0}
					<p class="dp-notes">
						<strong>Notes:</strong>
						{notes(sheet)
							.map((d) => `${dayNum(d.date)} ${d.remarks}`)
							.join(' · ')}
					</p>
				{/if}

				<p class="dp-cert">
					I hereby certify on my honor that the above is true and correct report of hours work performed,
					record of which was made at time of arrival and departure from office.
				</p>
				<div class="dp-sign">
					<span></span>
					Signature
				</div>
				<div class="dp-checked">Checked and verified against the logbook and punchcard</div>
			</div>
		{/each}
	</section>
{:else}
	<section class="dp-page"><p class="dp-empty">No saved DTR for this month. Save the record first.</p></section>
{/each}

<style>
	.dp-page {
		width: 210mm;
		min-height: 297mm;
		margin: 0 auto 8mm;
		padding: 8mm;
		box-sizing: border-box;
		display: flex;
		gap: 6mm;
		align-items: flex-start;
		background: #fff;
		color: #111;
		font:
			400 6.5pt/1.25 'Inter Variable',
			system-ui,
			sans-serif;
		break-after: page;
		print-color-adjust: exact;
	}
	.dp-copy {
		flex: 1;
		min-width: 0;
	}
	.dp-hotel,
	.dp-title,
	.dp-emp {
		text-align: center;
		font-weight: 700;
	}
	.dp-hotel {
		font-size: 7pt;
	}
	.dp-title {
		font-size: 8pt;
		letter-spacing: 0.06em;
	}
	.dp-emp {
		font-size: 9pt;
		margin-top: 1mm;
	}
	.dp-pos {
		text-align: center;
		font-size: 6.5pt;
		color: #444;
	}
	.dp-rule {
		height: 1.5px;
		background: #111;
		margin: 1.5mm 0;
	}
	.dp-month {
		margin-bottom: 1.5mm;
		font-size: 7pt;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}
	th,
	td {
		border: 0.75px solid #111;
		padding: 0.5mm 0.6mm;
		text-align: center;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		font-size: 6pt;
	}
	th {
		font-weight: 700;
		font-size: 5.5pt;
	}
	.dp-day {
		width: 13mm;
		text-align: left;
		font-weight: 700;
	}
	.dp-span {
		font-weight: 700;
		letter-spacing: 0.05em;
	}
	.dp-credit .dp-span {
		white-space: normal;
		font-size: 5.5pt;
		line-height: 1.1;
	}
	.dp-off td:not(.dp-day) {
		background: #f4f4f2;
	}
	tfoot td {
		font-weight: 700;
		border-top: 1.5px solid #111;
	}
	.dp-total {
		text-align: right;
	}
	.dp-notes {
		margin: 1.5mm 0 0;
		font-size: 5.5pt;
		color: #333;
	}
	.dp-cert {
		margin: 2.5mm 0 0;
		font-size: 6pt;
	}
	.dp-sign {
		margin: 9mm 8mm 0;
		text-align: center;
		font-size: 7pt;
		font-weight: 600;
	}
	.dp-sign span {
		display: block;
		border-top: 1px solid #111;
		margin-bottom: 0.5mm;
	}
	.dp-checked {
		text-align: center;
		font-size: 5.5pt;
		color: #444;
	}
	.dp-empty {
		width: 100%;
		padding: 20mm 0;
		text-align: center;
		color: #555;
	}
	@media print {
		.dp-page {
			margin: 0;
			padding: 0;
			width: auto;
			min-height: auto;
		}
	}
</style>
