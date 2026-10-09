<script lang="ts">
	import { invalidate } from '$app/navigation';
	import FlameIcon from '@lucide/svelte/icons/flame';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import { formatWait } from '$lib/dining-orders';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let nowMs = $state(Date.now());
	let updatedAt = $state(Date.now());
	// Server time minus this device's clock at the last load, so ages stay right on a drifted screen.
	let skewMs = $state(0);

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 1000);
		const refresh = setInterval(() => {
			if (!document.hidden) invalidate('app:kitchen-prep');
		}, 10_000);
		return () => {
			clearInterval(clock);
			clearInterval(refresh);
		};
	});
	$effect(() => {
		skewMs = data.serverNow - Date.now();
		updatedAt = Date.now();
	});

	const ago = $derived(Math.max(0, Math.round((nowMs - updatedAt) / 1000)));
	const minutesSince = (d: Date | string) => Math.max(0, Math.floor((nowMs + skewMs - new Date(d).getTime()) / 60_000));
	const clockOf = (d: Date | string) =>
		new Date(d).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
	const total = $derived(data.prep.reduce((n, s) => n + s.portions, 0));
</script>

<svelte:head><title>Kitchen prep</title></svelte:head>

<!-- Same dark, high-contrast treatment as the board, so it can share a counter screen. -->
<div class="dark min-h-[calc(100vh-9rem)] bg-background text-ink">
	<div class="mx-auto flex w-full max-w-[1800px] flex-col gap-4 px-4 py-4 sm:px-6">
		<header class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
			<h2 class="text-lg font-semibold tracking-tight">To make now</h2>
			<p class="text-base tabular-nums text-ink-muted">
				{total} {total === 1 ? 'portion' : 'portions'} across open tickets
			</p>
			<p class="ml-auto text-xs tabular-nums text-ink-muted">Updated {ago < 3 ? 'just now' : `${ago}s ago`}</p>
		</header>

		{#if data.prep.length === 0}
			<p class="rounded-xl border border-dashed border-border px-4 py-16 text-center text-base text-ink-muted">
				Nothing to make. New tickets show up here as they come in.
			</p>
		{:else}
			<div class="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
				{#each data.prep as station (station.key)}
					<section aria-labelledby="prep-{station.key || 'none'}" class="min-w-0 rounded-xl border-2 border-border bg-surface p-4">
						<div class="flex items-baseline gap-3 border-b-2 border-border pb-2">
							<h3 id="prep-{station.key || 'none'}" class="text-xl font-semibold tracking-tight">{station.label}</h3>
							<p class="ml-auto text-sm tabular-nums text-ink-muted">
								{station.portions} {station.portions === 1 ? 'portion' : 'portions'}
							</p>
						</div>

						<ul class="divide-y divide-border">
							{#each station.dishes as dish (dish.name)}
								{@const age = minutesSince(dish.oldestAt)}
								<li class="py-3">
									<div class="flex items-start gap-3">
										<p class="w-14 shrink-0 text-right font-mono text-4xl leading-none font-bold tabular-nums">{dish.quantity}</p>
										<div class="min-w-0 flex-1">
											<p class="text-[22px] leading-snug font-semibold">{dish.name}</p>
											<p class="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-ink-muted">
												{#if dish.cooking > 0}
													<span class="inline-flex items-center gap-1">
														<FlameIcon class="size-3.5" aria-hidden="true" />{dish.cooking} cooking
													</span>
												{/if}
												<span class="inline-flex items-center gap-1 tabular-nums">
													<ClockIcon class="size-3.5" aria-hidden="true" />oldest {formatWait(age)}
												</span>
											</p>
										</div>
									</div>
									<ul class="mt-2 space-y-1 pl-[4.25rem]">
										{#each dish.tickets as t (t.orderId + t.quantity + t.notes.join())}
											<li class="text-base">
												<span class="font-mono font-bold">{t.code}</span>
												<span class="text-ink-muted"> · {t.where} ·</span>
												<span class="font-bold tabular-nums"> {t.quantity}×</span>
												{#if t.pickupAt}
													<span class="text-ink-muted"> · pickup {clockOf(t.pickupAt)}</span>
												{/if}
												{#each t.notes as n (n)}
													<span class="block pl-4 text-lg {n.startsWith('+') ? 'text-ink-muted' : 'font-semibold'}">{n}</span>
												{/each}
											</li>
										{/each}
									</ul>
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			</div>
		{/if}
	</div>
</div>
