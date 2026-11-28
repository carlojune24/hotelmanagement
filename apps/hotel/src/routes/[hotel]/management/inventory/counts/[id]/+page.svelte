<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import { Input } from '$lib/components/ui/input/index.js';
	import { COUNT_UNIT, formatQty } from '$lib/stock-units';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const back = $derived(`/${page.params.hotel}/management/inventory/counts`);
	const DEPT: Record<string, string> = { dining: 'Dining', hotel: 'Hotel' };
	const isOpen = $derived(data.count.status === 'open');
	const canEdit = $derived(isOpen && data.inventory.canWrite);
	const when = $derived(new Intl.DateTimeFormat('en-PH', { timeZone: data.timezone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }));

	type Line = PageData['lines'][number];
	// What is typed on the sheet, per item, in the line's count unit. Seeded from the saved count.
	let typed = $state<Record<string, { counted: string; reason: string }>>(
		// svelte-ignore state_referenced_locally
		Object.fromEntries(
			data.lines.map((l) => [l.itemId, { counted: l.countedMilli == null ? '' : String(l.countedMilli / COUNT_UNIT[l.unit].milli), reason: l.reason ?? '' }])
		)
	);
	const countedMilli = (l: Line) => {
		// A number input bound with bind:value hands back a number (or null when cleared), not text.
		const v = String(typed[l.itemId]!.counted ?? '').trim();
		const n = Number(v);
		return v === '' || !Number.isFinite(n) || n < 0 ? null : Math.round(n * COUNT_UNIT[l.unit].milli);
	};
	/** Live difference against on hand now — what finishing would post. */
	const diffOf = (l: Line) => {
		const c = countedMilli(l);
		return c == null ? null : c - l.onHandMilli;
	};
	// Grouped by the departments the lines actually have, so no line can drop out of view.
	const deptLabel = (d: string | null) => (d ? (DEPT[d] ?? d) : 'Everything');
	const groups = $derived(
		[...new Set(data.lines.map((l) => l.department))].map((k) => ({ key: k, label: deptLabel(k), lines: data.lines.filter((l) => l.department === k) }))
	);
	const done = $derived(data.lines.filter((l) => countedMilli(l) != null).length);
	const differing = $derived(data.lines.filter((l) => (diffOf(l) ?? 0) !== 0));
	const needReason = $derived(differing.filter((l) => !typed[l.itemId]!.reason.trim()));
	let busy = $state(false);
	/** Finish was pressed with a remark missing: highlight the boxes that need one. */
	let tried = $state(false);
	let confirmDiscard = $state(false);

	const signed = (milli: number, unit: Line['unit']) => `${milli > 0 ? '+' : ''}${formatQty(milli, unit)}`;

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});
</script>

<svelte:head><title>{isOpen ? 'Count in progress' : 'Count'} · Inventory</title></svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<div class="max-w-4xl">
		<div class="flex items-center justify-between gap-3 print:hidden">
			<a href={back} class="text-sm text-ink-muted hover:text-ink">← All counts</a>
			<Button variant="outline" size="sm" onclick={() => window.print()}><PrinterIcon class="size-4" />Print</Button>
		</div>
		<h2 class="mt-2 text-base font-semibold text-ink">
			{isOpen ? 'Count in progress' : 'Stock count'}: {deptLabel(data.count.department)}
		</h2>
		<p class="mt-1 text-sm text-ink-muted">
			{data.count.note ? `${data.count.note} · ` : ''}Started {when.format(new Date(data.count.startedAt))}{data.count.startedByName
				? ` by ${data.count.startedByName}`
				: ''}{data.count.finishedAt
				? ` · finished ${when.format(new Date(data.count.finishedAt))}${data.count.finishedByName ? ` by ${data.count.finishedByName}` : ''}`
				: ''}
		</p>

		{#if isOpen}
			<p class="mt-3 text-sm text-ink-muted">
				Type what is on the shelf; leave an item blank to skip it. Where it differs, say why. Finishing posts each difference against
				what the system shows at that moment, so orders and check-ins during the count are not counted twice.
			</p>
		{/if}

		<form
			method="POST"
			action="?/save"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					busy = false;
					await update({ reset: false });
				};
			}}
		>
			{#each groups as g (g.key)}
				<section class="mt-6" aria-labelledby="cg-{g.key}">
					<h3 id="cg-{g.key}" class="border-b border-border pb-2 text-sm font-semibold tracking-wide text-ink uppercase">
						{g.label}<span class="ml-1 font-normal tabular-nums text-ink-muted">{g.lines.length}</span>
					</h3>
					<ul class="divide-y divide-border">
						{#each g.lines as l (l.itemId)}
							{@const unit = COUNT_UNIT[l.unit]}
							<li class="py-2.5">
								{#if canEdit}
									{@const d = diffOf(l)}
									<input type="hidden" name="itemId" value={l.itemId} />
									<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
										<div class="min-w-40 flex-1">
											<p class="text-base text-ink">{l.name}</p>
											<p class="text-xs text-ink-muted">System shows <span class="tabular-nums">{formatQty(l.onHandMilli, l.unit)}</span></p>
										</div>
										<div class="flex items-center gap-1.5">
											<Input
												name="counted"
												bind:value={typed[l.itemId]!.counted}
												type="number"
												min="0"
												step="any"
												inputmode="decimal"
												class="w-24 tabular-nums"
												aria-label="{l.name} counted, in {unit.label}"
											/>
											<span class="w-8 text-sm text-ink-muted">{unit.label}</span>
										</div>
										<span class="w-24 text-right text-sm font-medium tabular-nums {d == null || d === 0 ?'text-ink-muted' : d < 0 ? 'text-danger' : 'text-brand'}">
											{d == null ? '—' : d === 0 ? 'Matches' : signed(d, l.unit)}
										</span>
									</div>
									{@const missing = d != null && d !== 0 && !typed[l.itemId]!.reason.trim()}
									<div class="mt-2">
										<Input
											id="remark-{l.itemId}"
											name="reason"
											bind:value={typed[l.itemId]!.reason}
											maxlength={300}
											placeholder={d != null && d !== 0 ? 'Required: why? Lost, damaged, taken by a guest, found in laundry…' : 'Remarks (optional)'}
											class={missing && tried ? 'border-danger' : ''}
											aria-label="Remarks for {l.name}"
											aria-invalid={missing && tried}
										/>
									</div>
								{:else}
									<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
										<p class="min-w-40 flex-1 text-base text-ink">{l.name}</p>
										{#if l.countedMilli == null}
											<span class="text-sm text-ink-muted">Not counted</span>
										{:else}
											<span class="text-sm tabular-nums text-ink-muted">
												{isOpen ? 'Counted' : `Expected ${formatQty(l.expectedMilli ?? 0, l.unit)} · counted`}
												{formatQty(l.countedMilli, l.unit)}
											</span>
											{#if !isOpen}
												<span class="w-24 text-right text-sm font-medium tabular-nums {l.varianceMilli ? (l.varianceMilli < 0 ?'text-danger' : 'text-brand') : 'text-ink-muted'}">
													{l.varianceMilli ? signed(l.varianceMilli, l.unit) : 'Matched'}
												</span>
											{/if}
										{/if}
									</div>
									{#if l.reason}<p class="mt-0.5 text-xs text-ink-muted">{l.reason}</p>{/if}
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/each}

			{#if canEdit}
				<div class="sticky bottom-0 mt-6 flex flex-wrap items-center gap-3 border-t border-border bg-surface py-3 print:hidden">
					<p class="flex-1 text-sm text-ink-muted" aria-live="polite">
						{done} of {data.lines.length} counted{differing.length ? ` · ${differing.length} differ` : ''}{needReason.length
							? ` · ${needReason.length} need a remark`
							: ''}
					</p>
					{#if tried && needReason.length}
						<p class="w-full text-sm text-danger" role="alert">
							Add a remark for {needReason.map((l) => l.name).join(', ')}: {needReason.length === 1 ? 'it differs' : 'they differ'} from what the system shows.
						</p>
					{/if}
					<Button type="submit" variant="outline" class="" disabled={busy}>Save progress</Button>
					<Button
						type="submit"
						formaction="?/finish"
						class=""
						disabled={busy || done === 0}
						onclick={(e) => {
							// Say what is missing instead of a silently disabled button.
							if (!needReason.length) return;
							e.preventDefault();
							tried = true;
							document.getElementById(`remark-${needReason[0]!.itemId}`)?.focus();
						}}>Finish count</Button
					>
				</div>
			{/if}
		</form>

		{#if canEdit}
			<div class="mt-6 border-t border-border pt-4 print:hidden">
				{#if confirmDiscard}
					<form method="POST" action="?/discard" use:enhance class="flex flex-wrap items-center gap-3">
						<p class="text-sm text-ink">Discard this count? Nothing has been posted, so stock is unchanged.</p>
						<Button type="submit" variant="destructive" class="">Discard count</Button>
						<Button type="button" variant="ghost" class="" onclick={() => (confirmDiscard = false)}>Keep it</Button>
					</form>
				{:else}
					<Button variant="ghost" class="text-danger hover:text-danger" onclick={() => (confirmDiscard = true)}>Discard count</Button>
				{/if}
			</div>
		{/if}
	</div>
</div>
