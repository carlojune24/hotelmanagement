<script lang="ts">
	import {
		addDays,
		codeFor,
		datesBetween,
		formatHours,
		mondayOf,
		netShiftMinutes,
		sameShift,
		toHHMM,
		type CodedShift,
		type ShiftLegendEntry
	} from '$lib/roster';

	type Employee = {
		id: string;
		firstName: string;
		lastName: string;
		position: string;
		department: string | null;
		employeeNo: string;
	};
	type Entry = CodedShift & { employeeId: string; date: string };

	let {
		view,
		span,
		range,
		days,
		employees,
		entries,
		legend,
		hotel,
		printedAt
	}: {
		view: 'week' | 'month' | 'employee';
		span: 'week' | 'month';
		range: { start: string; end: string };
		days: string[];
		employees: Employee[];
		entries: Entry[];
		legend: ShiftLegendEntry[];
		hotel: { name: string; legalName: string | null; address: string | null };
		printedAt: string;
	} = $props();

	const shiftAt = $derived.by(() => {
		const m = new Map<string, Entry>();
		for (const e of entries) m.set(`${e.employeeId}|${e.date}`, e);
		return m;
	});
	const cell = (employeeId: string, date: string) => shiftAt.get(`${employeeId}|${date}`);

	const fullName = (e: Employee) => `${e.lastName}, ${e.firstName}`;
	const utc = (d: string) => new Date(`${d}T00:00:00Z`);
	const fmt = (d: string, o: Intl.DateTimeFormatOptions) =>
		utc(d).toLocaleDateString('en-US', { ...o, timeZone: 'UTC' });

	const periodLabel = $derived(
		span === 'week'
			? `${fmt(range.start, { month: 'short', day: 'numeric' })} – ${fmt(range.end, { month: 'short', day: 'numeric', year: 'numeric' })}`
			: fmt(range.start, { month: 'long', year: 'numeric' })
	);
	const titleWord = $derived(
		view === 'employee'
			? 'Work Schedule'
			: span === 'week'
				? 'Weekly Staff Schedule'
				: 'Monthly Staff Schedule'
	);

	function clock(t: string | null): string {
		const v = toHHMM(t);
		return v ?? '—';
	}
	const times = (s: CodedShift) => `${clock(s.startTime)}–${clock(s.endTime)}`;
	const label = (s: CodedShift) => legend.find((e) => sameShift(e.shift, s))?.label;

	function paid(employeeId: string, dates: string[]): number {
		let total = 0;
		for (const d of dates) {
			const e = cell(employeeId, d);
			if (e) total += netShiftMinutes(e);
		}
		return total;
	}
	function workedDays(employeeId: string, dates: string[]): number {
		return dates.filter((d) => {
			const e = cell(employeeId, d);
			return e && !e.isRestDay;
		}).length;
	}
	function restDays(employeeId: string, dates: string[]): number {
		return dates.filter((d) => cell(employeeId, d)?.isRestDay).length;
	}
	function onDuty(date: string): number {
		return employees.filter((emp) => {
			const e = cell(emp.id, date);
			return e && !e.isRestDay;
		}).length;
	}

	/** Mon-first calendar weeks covering a month, `null` for days outside it. */
	const calendarWeeks = $derived.by(() => {
		if (span !== 'month') return [];
		const first = mondayOf(range.start);
		const last = mondayOf(range.end);
		const weeks: (string | null)[][] = [];
		for (let w = first; w <= last; w = addDays(w, 7)) {
			weeks.push(
				datesBetween(w, addDays(w, 6)).map((d) => (d >= range.start && d <= range.end ? d : null))
			);
		}
		return weeks;
	});

	const weekdayLong = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const isMonday = (d: string) => utc(d).getUTCDay() === 1;
	const isWeekend = (d: string) => [0, 6].includes(utc(d).getUTCDay());
</script>

{#snippet letterhead()}
	<header class="rp-head">
		<div>
			<div class="rp-name">{hotel.legalName || hotel.name}</div>
			{#if hotel.legalName && hotel.legalName !== hotel.name}
				<div class="rp-soft">operating as {hotel.name}</div>
			{/if}
			{#if hotel.address}<div class="rp-soft">{hotel.address}</div>{/if}
		</div>
		<div class="rp-title">
			<div class="rp-title-word">{titleWord}</div>
			<div class="rp-mono rp-period">{periodLabel}</div>
		</div>
	</header>
	<div class="rp-rule"></div>
{/snippet}

{#snippet footer(signatures: 'approval' | 'received')}
	{#if signatures === 'approval'}
		<div class="rp-sign">
			<div><span class="rp-line"></span><span class="rp-soft">Prepared by</span></div>
			<div><span class="rp-line"></span><span class="rp-soft">Approved by</span></div>
		</div>
	{:else}
		<div class="rp-sign">
			<div>
				<span class="rp-line"></span><span class="rp-soft">Received by (employee signature)</span>
			</div>
			<div class="rp-sign-date"><span class="rp-line"></span><span class="rp-soft">Date</span></div>
		</div>
	{/if}
	<p class="rp-foot rp-soft">
		Printed {printedAt}. Schedule is subject to change; the latest version on file governs.
	</p>
{/snippet}

{#if view === 'week'}
	<div class="rp-page rp-landscape">
		{@render letterhead()}
		{#if employees.length === 0}
			<p class="rp-empty">No employees to schedule.</p>
		{:else}
			<table class="rp-grid rp-week">
				<thead>
					<tr>
						<th class="rp-emp-col">Employee</th>
						{#each days as d (d)}
							<th>
								<span>{fmt(d, { weekday: 'short' })}</span>
								<span class="rp-mono rp-date">{fmt(d, { month: 'short', day: 'numeric' })}</span>
							</th>
						{/each}
						<th class="rp-total-col">Hours</th>
					</tr>
				</thead>
				<tbody>
					{#each employees as emp (emp.id)}
						<tr>
							<th scope="row" class="rp-emp-col">
								<span class="rp-emp-name">{fullName(emp)}</span>
								<span class="rp-soft">{emp.position}</span>
							</th>
							{#each days as d (d)}
								{@const e = cell(emp.id, d)}
								<td>
									{#if !e}
										<span class="rp-blank">—</span>
									{:else if e.isRestDay}
										<span class="rp-rest">Rest</span>
									{:else}
										<span class="rp-shift-name">{label(e) ?? 'Custom'}</span>
										<span class="rp-mono rp-times">{times(e)}</span>
									{/if}
								</td>
							{/each}
							<td class="rp-num rp-mono">{formatHours(paid(emp.id, days))}</td>
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr>
						<th scope="row" class="rp-emp-col">On duty</th>
						{#each days as d (d)}<td class="rp-num rp-mono">{onDuty(d)}</td>{/each}
						<td></td>
					</tr>
				</tfoot>
			</table>
		{/if}
		{@render footer('approval')}
	</div>
{:else if view === 'month'}
	<div class="rp-page rp-landscape">
		{@render letterhead()}
		{#if employees.length === 0}
			<p class="rp-empty">No employees to schedule.</p>
		{:else}
			<table class="rp-grid rp-month">
				<thead>
					<tr>
						<th class="rp-emp-col">Employee</th>
						{#each days as d (d)}
							<th class:rp-mon={isMonday(d)} class:rp-wknd={isWeekend(d)}>
								<span class="rp-dow">{fmt(d, { weekday: 'narrow' })}</span>
								<span class="rp-mono">{Number(d.slice(8))}</span>
							</th>
						{/each}
						<th class="rp-total-col">Hours</th>
					</tr>
				</thead>
				<tbody>
					{#each employees as emp (emp.id)}
						<tr>
							<th scope="row" class="rp-emp-col">
								<span class="rp-emp-name">{fullName(emp)}</span>
							</th>
							{#each days as d (d)}
								{@const e = cell(emp.id, d)}
								<td class="rp-code rp-mono" class:rp-mon={isMonday(d)} class:rp-wknd={isWeekend(d)}>
									{e ? codeFor(e, legend) : ''}
								</td>
							{/each}
							<td class="rp-num rp-mono">{formatHours(paid(emp.id, days))}</td>
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr>
						<th scope="row" class="rp-emp-col">On duty</th>
						{#each days as d (d)}
							<td class="rp-code rp-mono" class:rp-mon={isMonday(d)}>{onDuty(d) || ''}</td>
						{/each}
						<td></td>
					</tr>
				</tfoot>
			</table>
			<dl class="rp-legend">
				{#each legend as l (l.code)}
					<div>
						<dt class="rp-mono">{l.code}</dt>
						<dd>
							{l.label}
							{#if !l.shift.isRestDay}<span class="rp-mono rp-soft">{times(l.shift)}</span>{/if}
						</dd>
					</div>
				{/each}
				<div>
					<dt class="rp-mono">blank</dt>
					<dd>Not scheduled</dd>
				</div>
			</dl>
		{/if}
		{@render footer('approval')}
	</div>
{:else}
	{#each employees as emp (emp.id)}
		{@const hours = paid(emp.id, days)}
		<section class="rp-page rp-portrait rp-sheet">
			<div class="rp-frame">
				{@render letterhead()}
				<div class="rp-person">
					<div>
						<span class="rp-label">Employee</span>
						<div class="rp-person-name">{emp.firstName} {emp.lastName}</div>
						<div class="rp-soft">
							{emp.position}{emp.department ? ` · ${emp.department}` : ''}
						</div>
					</div>
					<dl class="rp-meta">
						<div>
							<dt>Employee no.</dt>
							<dd class="rp-mono">{emp.employeeNo}</dd>
						</div>
						<div>
							<dt>Days to work</dt>
							<dd class="rp-mono">{workedDays(emp.id, days)}</dd>
						</div>
						<div>
							<dt>Rest days</dt>
							<dd class="rp-mono">{restDays(emp.id, days)}</dd>
						</div>
						<div>
							<dt>Paid hours</dt>
							<dd class="rp-mono">{formatHours(hours)}</dd>
						</div>
					</dl>
				</div>

				{#if span === 'month'}
					<table class="rp-cal">
						<thead>
							<tr
								>{#each weekdayLong as w (w)}<th>{w}</th>{/each}</tr
							>
						</thead>
						<tbody>
							{#each calendarWeeks as week, wi (wi)}
								<tr>
									{#each week as d, di (di)}
										{@const e = d ? cell(emp.id, d) : undefined}
										<td class:rp-out={!d}>
											{#if d}
												<span class="rp-mono rp-daynum">{Number(d.slice(8))}</span>
												{#if e?.isRestDay}
													<span class="rp-rest">Rest</span>
												{:else if e}
													<span class="rp-shift-name">{label(e) ?? 'Custom'}</span>
													<span class="rp-mono rp-times">{times(e)}</span>
												{/if}
											{/if}
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				{:else}
					<table class="rp-list">
						<thead>
							<tr>
								<th>Day</th>
								<th>Date</th>
								<th>Shift</th>
								<th>Time</th>
								<th class="rp-num">Break</th>
								<th class="rp-num">Paid hrs</th>
							</tr>
						</thead>
						<tbody>
							{#each days as d (d)}
								{@const e = cell(emp.id, d)}
								<tr>
									<td>{fmt(d, { weekday: 'long' })}</td>
									<td class="rp-mono">{fmt(d, { month: 'short', day: 'numeric' })}</td>
									{#if !e}
										<td colspan="4" class="rp-blank">Not scheduled</td>
									{:else if e.isRestDay}
										<td colspan="4" class="rp-rest">Rest day</td>
									{:else}
										<td>{label(e) ?? 'Custom hours'}</td>
										<td class="rp-mono">{times(e)}</td>
										<td class="rp-num rp-mono">{e.breakMinutes ? `${e.breakMinutes}m` : '—'}</td>
										<td class="rp-num rp-mono">{formatHours(netShiftMinutes(e))}</td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}

				<div class="rp-spacer"></div>
				{@render footer('received')}
			</div>
		</section>
	{/each}
	{#if employees.length === 0}
		<div class="rp-page rp-portrait"><p class="rp-empty">No employees to schedule.</p></div>
	{/if}
{/if}

<style>
	.rp-page {
		--rp-ink: #1a1a1a;
		--rp-soft: #55524c;
		--rp-rule: #b7b2a8;
		box-sizing: border-box;
		margin: 0 auto 16px;
		padding: 10mm;
		background: #fff;
		color: var(--rp-ink);
		font-family: 'Inter Variable', 'Inter', system-ui, sans-serif;
		font-size: 9pt;
		line-height: 1.35;
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}
	.rp-page :global(*) {
		box-sizing: border-box;
	}
	.rp-landscape {
		width: 297mm;
		min-height: 210mm;
	}
	.rp-portrait {
		width: 210mm;
		min-height: 297mm;
	}
	.rp-mono {
		font-family: 'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
	}
	.rp-soft {
		font-size: 8pt;
		color: var(--rp-soft);
	}
	.rp-head {
		display: flex;
		justify-content: space-between;
		gap: 10mm;
	}
	.rp-name {
		font-size: 14pt;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.01em;
	}
	.rp-title {
		text-align: right;
	}
	.rp-title-word {
		font-size: 12pt;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.rp-period {
		font-size: 9.5pt;
		margin-top: 1mm;
	}
	.rp-rule {
		height: 2px;
		background: var(--rp-ink);
		margin: 3.5mm 0 4mm;
	}
	.rp-empty {
		padding: 20mm 0;
		text-align: center;
		color: var(--rp-soft);
	}

	/* Grids (week + month) */
	.rp-grid {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}
	.rp-grid th,
	.rp-grid td {
		border: 1px solid var(--rp-rule);
		padding: 1.2mm 1.5mm;
		vertical-align: middle;
	}
	.rp-grid thead th {
		border-bottom: 2px solid var(--rp-ink);
		font-size: 7.5pt;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		text-align: center;
	}
	.rp-grid thead {
		display: table-header-group; /* repeat on every printed page */
	}
	.rp-grid tr {
		break-inside: avoid;
	}
	.rp-grid tfoot th,
	.rp-grid tfoot td {
		border-top: 2px solid var(--rp-ink);
		font-weight: 700;
	}
	.rp-emp-col {
		text-align: left !important;
	}
	.rp-grid tbody th.rp-emp-col {
		font-weight: 400;
	}
	.rp-emp-name {
		display: block;
		font-weight: 600;
	}
	.rp-week .rp-emp-col {
		width: 44mm;
	}
	.rp-week td {
		text-align: center;
		height: 11mm;
	}
	.rp-date {
		display: block;
		font-weight: 400;
		text-transform: none;
		letter-spacing: 0;
	}
	.rp-shift-name {
		display: block;
		font-size: 8pt;
		font-weight: 600;
	}
	.rp-times {
		display: block;
		font-size: 7.5pt;
		color: var(--rp-soft);
	}
	.rp-rest {
		font-size: 8pt;
		font-style: italic;
		color: var(--rp-soft);
	}
	.rp-blank {
		color: var(--rp-rule);
	}
	.rp-num {
		text-align: right;
	}
	.rp-total-col {
		width: 18mm;
	}
	.rp-month .rp-emp-col {
		width: 40mm;
	}
	.rp-month th,
	.rp-month td {
		padding: 0.8mm 0;
		font-size: 7.5pt;
	}
	.rp-month .rp-emp-col,
	.rp-month .rp-num {
		padding: 0.8mm 1.5mm;
	}
	.rp-month td.rp-code {
		text-align: center;
		font-weight: 700;
		height: 6.5mm;
	}
	.rp-dow {
		display: block;
		font-weight: 400;
		color: var(--rp-soft);
	}
	/* Week starts and weekends are marked with rules, never fills — photocopies cleanly. */
	.rp-month .rp-mon {
		border-left: 2px solid var(--rp-ink);
	}
	.rp-month th.rp-wknd .rp-dow {
		font-weight: 700;
		color: var(--rp-ink);
	}
	.rp-month td.rp-wknd {
		border-bottom-style: dashed;
	}
	.rp-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5mm 6mm;
		margin: 4mm 0 0;
		padding: 2.5mm 0 0;
		border-top: 1px solid var(--rp-rule);
		font-size: 8pt;
	}
	.rp-legend div {
		display: flex;
		align-items: baseline;
		gap: 1.5mm;
	}
	.rp-legend dt {
		font-weight: 700;
		min-width: 5mm;
	}
	.rp-legend dd {
		margin: 0;
	}

	/* Signatures + foot */
	.rp-sign {
		display: flex;
		gap: 14mm;
		margin-top: 12mm;
		break-inside: avoid;
	}
	.rp-sign > div {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 1mm;
	}
	.rp-sign-date {
		flex: 0 0 45mm !important;
	}
	.rp-line {
		display: block;
		border-bottom: 1px solid var(--rp-ink);
		height: 9mm;
	}
	.rp-foot {
		margin: 5mm 0 0;
	}

	/* Employee sheet */
	.rp-frame {
		display: flex;
		flex-direction: column;
		border: 3px double var(--rp-ink);
		padding: 6mm;
		min-height: calc(297mm - 20mm);
	}
	.rp-sheet {
		break-after: page;
		page-break-after: always;
	}
	.rp-sheet:last-of-type {
		break-after: auto;
		page-break-after: auto;
	}
	.rp-person {
		display: flex;
		justify-content: space-between;
		gap: 8mm;
		margin-bottom: 5mm;
	}
	.rp-label {
		font-size: 7pt;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--rp-soft);
	}
	.rp-person-name {
		font-size: 14pt;
		font-weight: 700;
	}
	.rp-meta {
		margin: 0;
		display: grid;
		grid-template-columns: auto auto;
		gap: 0.8mm 6mm;
		font-size: 8.5pt;
		align-content: start;
	}
	.rp-meta div {
		display: contents;
	}
	.rp-meta dt {
		color: var(--rp-soft);
	}
	.rp-meta dd {
		margin: 0;
		text-align: right;
		font-weight: 600;
	}
	.rp-cal {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}
	.rp-cal th {
		border-bottom: 2px solid var(--rp-ink);
		padding: 1.2mm;
		font-size: 7.5pt;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.rp-cal td {
		border: 1px solid var(--rp-rule);
		height: 26mm;
		padding: 1.2mm 1.5mm;
		vertical-align: top;
	}
	.rp-cal td.rp-out {
		border-style: dashed;
		border-color: #ddd9d0;
	}
	.rp-daynum {
		display: block;
		font-size: 7.5pt;
		color: var(--rp-soft);
		margin-bottom: 1mm;
	}
	.rp-list {
		width: 100%;
		border-collapse: collapse;
	}
	.rp-list th {
		border-bottom: 2px solid var(--rp-ink);
		padding: 1.5mm;
		font-size: 7.5pt;
		text-align: left;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.rp-list td {
		border-bottom: 1px solid var(--rp-rule);
		padding: 3mm 1.5mm;
	}
	.rp-list .rp-num {
		text-align: right;
	}
	.rp-list th.rp-num {
		text-align: right;
	}
	.rp-spacer {
		flex: 1;
	}

	@media print {
		.rp-page {
			margin: 0;
			padding: 0;
			width: auto;
			min-height: auto;
		}
		.rp-frame {
			min-height: calc(297mm - 20mm);
		}
	}
</style>
