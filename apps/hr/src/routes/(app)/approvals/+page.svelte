<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let busy = $state(false);

	const total = $derived(
		data.pending.dtr.length +
			data.pending.weeks.length +
			data.pending.leave.length +
			data.pending.overtime.length
	);

	const range = (a: string, b: string) => (a === b ? a : `${a} → ${b}`);
	const hours = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
	const when = (d: Date | string | null) =>
		d ? new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '';

	function submit() {
		busy = true;
		return async ({
			result,
			update
		}: {
			result: { type: string; data?: unknown };
			update: (o?: { reset?: boolean }) => Promise<void>;
		}) => {
			await update({ reset: true });
			busy = false;
			const d = result.data as { ok?: string; message?: string } | undefined;
			if (result.type === 'success') toast.success(d?.ok ?? 'Done.');
			else if (result.type === 'failure') toast.error(d?.message ?? 'Could not save.');
		};
	}
</script>

<svelte:head><title>Approvals · HR</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
	<div>
		<h1 class="text-5xl font-light tracking-tight">Approvals</h1>
		<p class="mt-1 text-sm text-ink-muted">
			{total === 0 ? 'Nothing is waiting.' : `${total} waiting for a decision.`}
		</p>
	</div>

	{#snippet decide(action: string, fields: Record<string, string>, approveLabel: string, rejectLabel: string)}
		<form method="POST" action="?/{action}" use:enhance={submit} class="flex flex-wrap items-center gap-2">
			{#each Object.entries(fields) as [name, value] (name)}
				<input type="hidden" {name} {value} />
			{/each}
			<Input name="note" placeholder="Note (required to {rejectLabel.toLowerCase()})" maxlength={300} class="h-9 w-56" aria-label="Note" />
			<Button type="submit" name="decision" value="approved" size="sm" variant="gold" disabled={busy}>{approveLabel}</Button>
			<Button type="submit" name="decision" value="rejected" size="sm" variant="outline" disabled={busy}>{rejectLabel}</Button>
		</form>
	{/snippet}

	{#if data.pending.dtr.length}
		<section class="panel space-y-3 p-5" aria-label="DTRs">
			<h2 class="text-xl font-light">DTRs</h2>
			{#each data.pending.dtr as d (d.id)}
				<div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/70 p-3">
					<div>
						<p class="font-medium">{d.establishmentName}</p>
						<p class="text-sm text-ink-muted">
							{d.month} · sent by {d.submittedBy ?? 'unknown'} · {when(d.submittedAt)}
						</p>
						<a class="text-xs underline underline-offset-4" href="/{d.establishmentSlug}/dtr?month={d.month}"
							>Review the DTR</a
						>
					</div>
					{@render decide('decideDtr', { id: d.id }, 'Receive', 'Return')}
				</div>
			{/each}
		</section>
	{/if}

	{#if data.pending.weeks.length}
		<section class="panel space-y-3 p-5" aria-label="Rosters">
			<h2 class="text-xl font-light">Rosters</h2>
			{#each data.pending.weeks as w (w.establishmentId + w.weekStart)}
				<div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/70 p-3">
					<div>
						<p class="font-medium">{w.establishmentName}</p>
						<p class="text-sm text-ink-muted">
							Week {range(w.weekStart, w.weekEnd)} · sent by {w.submittedBy ?? 'unknown'} · {when(w.submittedAt)}
						</p>
						<a class="text-xs underline underline-offset-4" href="/{w.establishmentSlug}/schedule?week={w.weekStart}"
							>Review the roster</a
						>
					</div>
					{@render decide('decideWeek', { establishmentId: w.establishmentId, weekStart: w.weekStart }, 'Approve', 'Return')}
				</div>
			{/each}
		</section>
	{/if}

	{#if data.pending.leave.length}
		<section class="panel space-y-3 p-5" aria-label="Leave">
			<h2 class="text-xl font-light">Leave</h2>
			{#each data.pending.leave as l (l.id)}
				<div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/70 p-3">
					<div>
						<p class="font-medium">{l.person} · {l.typeName}</p>
						<p class="text-sm text-ink-muted">
							{l.establishmentName} · {range(l.startDate, l.endDate)}{l.halfDay ? ` (${l.halfDay.toUpperCase()})` : ''} ·
							{l.days} day{l.days === 1 ? '' : 's'}
						</p>
						<p class="text-xs text-ink-muted">
							Sent by {l.submittedBy ?? 'unknown'} · {when(l.submittedAt)}{l.reason ? ` · “${l.reason}”` : ''}
						</p>
					</div>
					{@render decide('decideLeave', { id: l.id }, 'Approve', 'Reject')}
				</div>
			{/each}
		</section>
	{/if}

	{#if data.pending.overtime.length}
		<section class="panel space-y-3 p-5" aria-label="Overtime">
			<h2 class="text-xl font-light">Overtime</h2>
			{#each data.pending.overtime as o (o.id)}
				<div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/70 p-3">
					<div>
						<p class="font-medium">{o.person}</p>
						<p class="text-sm text-ink-muted">
							{o.establishmentName} · {o.date} · {o.startTime}–{o.endTime} ({hours(o.minutes)})
						</p>
						<p class="text-xs text-ink-muted">
							Sent by {o.submittedBy ?? 'unknown'} · {when(o.submittedAt)}{o.reason ? ` · “${o.reason}”` : ''}
						</p>
					</div>
					{@render decide('decideOvertime', { id: o.id }, 'Approve', 'Reject')}
				</div>
			{/each}
		</section>
	{/if}

	<section class="panel space-y-3 p-5" aria-label="DTR hand-off by month">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h2 class="text-xl font-light">DTR hand-off</h2>
			<form method="GET" class="flex items-center gap-2">
				<Input type="month" name="month" value={data.month} aria-label="Month" class="h-9 w-44" />
				<Button type="submit" variant="outline" size="sm">Show</Button>
			</form>
		</div>
		{#if data.board.length === 0}
			<p class="text-sm text-ink-muted">No establishments yet.</p>
		{:else}
			<ul class="divide-y divide-dotted divide-foreground/20">
				{#each data.board as b (b.establishmentId)}
					<li class="flex flex-wrap items-center justify-between gap-2 py-2.5">
						<a class="font-medium underline-offset-4 hover:underline" href="/{b.establishmentSlug}/dtr?month={data.month}"
							>{b.establishmentName}</a
						>
						<span
							class="inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium {b.status === 'received'
								? 'bg-ok/15'
								: b.status === 'submitted'
									? 'bg-gold'
									: b.status === 'returned'
										? 'bg-destructive/15'
										: 'bg-ink/10'}"
						>
							<span class="size-1.5 rounded-full bg-current opacity-70"></span>
							{b.status === 'received'
								? 'Received'
								: b.status === 'submitted'
									? 'Waiting for you'
									: b.status === 'returned'
										? 'Returned'
										: 'Not sent'}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if total === 0}
		<div class="hatch rounded-3xl px-6 py-16 text-center">
			<p class="text-lg">All caught up</p>
			<p class="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
				Rosters, leave and overtime sent by managers will appear here.
			</p>
		</div>
	{/if}
</div>
