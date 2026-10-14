<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { GROUP_TITLES, SCENARIOS, SCHEDULES, evaluate, type Scenario } from '$lib/dtr-scenarios';

	const hm = (m: number) => {
		if (m === 0) return '0';
		const h = Math.floor(m / 60);
		const r = m % 60;
		return h === 0 ? `${r}m` : r === 0 ? `${h}h` : `${h}h ${r}m`;
	};
	/** `13:05` / `02:00+1` → `1:05 PM` / `2:00 AM (+1)` */
	const clock = (t: string) => {
		const next = t.endsWith('+1');
		const [h = 0, m = 0] = (next ? t.slice(0, -2) : t).split(':').map(Number);
		const hh = h % 12 === 0 ? 12 : h % 12;
		return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}${next ? ' (+1)' : ''}`;
	};
	const PAY: Record<string, string> = {
		full: 'Paid in full',
		late_undertime: 'Late / undertime deducted',
		absent: 'Day deducted',
		covered: 'Covered by leave / holiday',
		none: 'Nothing to pay or deduct'
	};

	const groups = (Object.keys(GROUP_TITLES) as Scenario['group'][]).map((g) => ({
		key: g,
		...GROUP_TITLES[g],
		items: SCENARIOS.filter((s) => s.group === g).map((sc) => ({ sc, r: evaluate(sc) }))
	}));

	const RULES: Array<[string, string]> = [
		['The punches', 'The first punch of the day is "in" and the last is "out". On a split shift the punches in between are read by where they fall: before the middle of the break is a break-out, then a break-in; one an hour or more after coming back is the clock-out. Two taps within 2 minutes are one punch. A long day with only in and out taps (up to 16h) stays one shift; a silence that ends at the next rostered start begins a new one, so overtime until 9 PM and an 8 AM clock-in are two days.'],
		['The break', 'The unpaid break is only taken off time that actually spans it. Arriving after lunch, or leaving before it, costs no break. A missing break punch is assumed to be as scheduled when a clock-out proves they came back.'],
		['Late and undertime', 'Late = minutes after the scheduled start (and after returning late from lunch). Undertime = minutes before the scheduled end. Neither includes the unpaid break, so worked + late + undertime always equals the paid day.'],
		['Missing punches', 'One lone punch is never "late": worked is 0 and the rostered day is treated as absent until HR adds the missing punch. After lunch with no clock-out, only the morning is paid and the afternoon is undertime. Every case is flagged so it shows in the remarks.'],
		['Overtime', 'Only time punched after the scheduled end, and only the part an approved application covers, is paid. The rest is flagged as unapproved and not paid. Time before the shift is not overtime.'],
		['Leave, holiday, memo', 'Approved leave and holiday/memo days cover the schedule and win over "absent". A half-day leave excuses late and undertime up to half the shift. A memo credits the day (or set hours) and can waive late and undertime.'],
		['What it means for pay', 'A monthly-paid person is deducted for absent days and for late and undertime minutes. A day with worked 0 on a rostered day is an absence. Everything flagged can be fixed by adding the missing punch under Biometric data; the DTR then recalculates.']
	];
	const LIMITS = [
		'Overtime approved before the shift (e.g. 7:00–8:00 AM) is not credited: overtime only counts after the scheduled end.',
		'A memo that waives lateness waives late and undertime together; there is no setting for "early dismissal only" or an excused-from time yet.',
		'On a straight shift (no break window) the break is assumed to sit in the middle of the shift.',
		'A lone punch is always treated as an incomplete day. Whether it was an in or an out is shown in the remarks, but it is not paid until HR adds the other punch.'
	];
</script>

<svelte:head><title>DTR guide · HR</title></svelte:head>

<div class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
	<aside class="lg:sticky lg:top-4 lg:self-start">
		<p class="text-xs font-medium tracking-wide text-ink-muted uppercase">On this page</p>
		<nav class="mt-2 flex flex-wrap gap-2 lg:flex-col lg:gap-0.5" aria-label="Guide sections">
			<a href="#rules" class="rounded-full bg-ink/10 px-3 py-1 text-sm hover:bg-ink/15 lg:rounded-lg lg:bg-transparent lg:px-2 lg:hover:bg-ink/10">How a day is worked out</a>
			{#each groups as g (g.key)}
				<a href="#g-{g.key}" class="rounded-full bg-ink/10 px-3 py-1 text-sm hover:bg-ink/15 lg:rounded-lg lg:bg-transparent lg:px-2 lg:hover:bg-ink/10">
					{g.title}
					<span class="text-xs text-ink-muted tabular-nums">{g.items.length}</span>
				</a>
			{/each}
			<a href="#limits" class="rounded-full bg-ink/10 px-3 py-1 text-sm hover:bg-ink/15 lg:rounded-lg lg:bg-transparent lg:px-2 lg:hover:bg-ink/10">Known limits</a>
		</nav>
	</aside>

	<!-- The guide is long, so it scrolls inside its own panel and the index stays in view. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div class="panel max-h-[calc(100vh-9rem)] min-w-0 space-y-8 overflow-y-auto p-5 md:p-6" tabindex="0" aria-label="DTR scenario guide">
		<header>
			<h1 class="text-3xl font-light tracking-tight">DTR guide</h1>
			<p class="mt-1 max-w-2xl text-sm text-ink-muted">
				Every punch situation the DTR handles, with the minutes it produces. These figures are produced by the same
				code that builds the DTR, and a test checks each row, so this page matches how it really works.
			</p>
		</header>

		<section id="rules" class="space-y-3">
			<h2 class="text-xl font-light">How a day is worked out</h2>
			<dl class="space-y-3">
				{#each RULES as [term, text] (term)}
					<div>
						<dt class="text-sm font-medium">{term}</dt>
						<dd class="text-sm text-ink-muted">{text}</dd>
					</div>
				{/each}
			</dl>
		</section>

		{#each groups as g (g.key)}
			<section id="g-{g.key}" class="space-y-3">
				<div>
					<h2 class="text-xl font-light">{g.title}</h2>
					<p class="text-sm text-ink-muted">{g.blurb}</p>
				</div>
				<ol class="divide-y divide-dotted divide-ink/25 rounded-2xl bg-white/60">
					{#each g.items as { sc, r } (sc.id)}
						<li class="space-y-2 px-4 py-3">
							<div class="flex flex-wrap items-start gap-x-3 gap-y-1">
								<span class="rounded-md bg-ink px-1.5 py-0.5 font-mono text-xs text-white">{sc.id}</span>
								<h3 class="min-w-0 flex-1 text-sm font-medium">{sc.title}</h3>
								<span class="text-xs text-ink-muted">{SCHEDULES[sc.schedule].short}</span>
							</div>

							<p class="flex flex-wrap items-center gap-1.5 text-xs">
								<span class="text-ink-muted">Punches</span>
								{#each sc.punches as t, i (i)}
									<span class="rounded bg-ink/10 px-1.5 py-0.5 tabular-nums">{clock(t)}</span>
								{:else}
									<span class="text-ink-muted">none</span>
								{/each}
								{#if sc.approvedOt?.length}
									<span class="text-ink-muted">· OT approved</span>
									{#each sc.approvedOt as o (o)}
										<span class="rounded bg-gold-soft px-1.5 py-0.5 tabular-nums">{o.split('-').map(clock).join(' – ')}</span>
									{/each}
								{/if}
								{#if sc.leave}
									<Badge variant="muted">
										{sc.leave.paid ? 'Paid' : 'Unpaid'} leave{sc.leave.halfDay ? ` · half day ${sc.leave.halfDay.toUpperCase()}` : ' · whole day'}
									</Badge>
								{/if}
								{#if sc.memo}
									<Badge variant="muted">
										Holiday / memo · {sc.memo.creditHours === null ? 'full day credit' : `${sc.memo.creditHours}h credit`}{sc.memo.waiveLateness ? ' · waives late/undertime' : ''}
									</Badge>
								{/if}
							</p>

							<p class="flex flex-wrap items-center gap-1.5 text-xs tabular-nums">
								<span class="rounded-full bg-ink px-2 py-0.5 font-medium text-white">Worked {hm(r.worked)}</span>
								{#if r.late > 0}<span class="rounded-full bg-gold px-2 py-0.5 font-medium text-ink">Late {hm(r.late)}</span>{/if}
								{#if r.under > 0}<span class="rounded-full bg-gold px-2 py-0.5 font-medium text-ink">Undertime {hm(r.under)}</span>{/if}
								{#if r.ot > 0}<span class="rounded-full bg-ok/20 px-2 py-0.5 font-medium">Overtime {hm(r.ot)}</span>{/if}
								{#if r.unapprovedOt > 0}<span class="rounded-full bg-danger/15 px-2 py-0.5 font-medium text-danger">Unapproved OT {hm(r.unapprovedOt)}</span>{/if}
								{#if r.night > 0}<span class="rounded-full bg-ink/10 px-2 py-0.5">Night diff {hm(r.night)}</span>{/if}
								{#if r.leaveCredit > 0}<span class="rounded-full bg-ink/10 px-2 py-0.5">Leave credit {hm(r.leaveCredit)}</span>{/if}
								{#if r.absent}<span class="rounded-full bg-danger/15 px-2 py-0.5 font-medium text-danger">Absent</span>{/if}
								<span class="text-ink-muted">· {PAY[r.pay]}</span>
							</p>

							{#if r.remarks}
								<p class="text-xs text-ink-muted">Remarks on the DTR: <span class="text-ink">{r.remarks}</span></p>
							{/if}
							<p class="text-sm text-ink-muted">{sc.note}</p>
						</li>
					{/each}
				</ol>
			</section>
		{/each}

		<section id="limits" class="space-y-2">
			<h2 class="text-xl font-light">Known limits</h2>
			<ul class="list-disc space-y-1 pl-5 text-sm text-ink-muted">
				{#each LIMITS as l (l)}<li>{l}</li>{/each}
			</ul>
		</section>
	</div>
</div>
