<script lang="ts">
	import { page } from '$app/state';
	import { goto, invalidate } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import BellIcon from '@lucide/svelte/icons/bell';
	import BellOffIcon from '@lucide/svelte/icons/bell-off';
	import { describeAlert, newAlerts, seenFrom, type SeenAlerts } from '$lib/service-alerts';
	import { playTone, readSoundPref, soundReady, stopSound, unlockOnFirstTouch, writeSoundPref } from '$lib/staff-sound';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	const base = $derived(`/${page.params.hotel}/management/dining`);

	const tabs = $derived(
		[
			{ seg: 'floor', label: 'Floor', show: true, badge: data.badges.floor, hint: 'asking for the bill', ready: 0 },
			// QR orders waiting for a waiter plus online orders the kitchen has not picked up yet.
			{ seg: 'orders', label: 'Orders', show: true, badge: data.badges.orders, hint: 'waiting for you', ready: data.alerts.ready.length },
			{ seg: 'reservations', label: 'Reservations', show: true, badge: data.badges.reservations, hint: 'pending or arriving soon', ready: 0 },
			{ seg: 'menu', label: 'Menu', show: true, badge: 0, hint: '', ready: 0 },
			{ seg: 'addons', label: 'Add-ons', show: true, badge: 0, hint: '', ready: 0 },
			{ seg: 'sales', label: 'Sales', show: true, badge: 0, hint: '', ready: 0 },
			{ seg: 'settings', label: 'Venues & page', show: data.canEditSettings, badge: 0, hint: '', ready: 0 }
		].filter((t) => t.show)
	);

	const isActive = (seg: string) => {
		const path = page.url.pathname;
		return path === `${base}/${seg}` || path.startsWith(`${base}/${seg}/`);
	};

	// ---- alerts: food ready to serve, and table orders waiting for a waiter -----------------
	// This runs in the layout so it works on every Dining tab (Floor, Orders, Reservations…),
	// not just the one with the list. It polls a tiny query, not the whole board.
	let sound = $state(true);
	let blocked = $state(false);
	let seen: SeenAlerts | null = null;

	$effect(() => {
		sound = readSoundPref('dining-alert-sound');
		return unlockOnFirstTouch(() => (blocked = false));
	});

	$effect(() => {
		// Keep polling in a background tab too (browsers slow it down but don't stop it), so a
		// waiter on another window still hears the bell; catch up the moment the tab is shown.
		// The tab number bubbles ride the same beat (they live in the staff layout's load).
		const refresh = () => {
			invalidate('app:dining-alerts');
			invalidate('app:staff-badges');
		};
		const poll = setInterval(refresh, 12_000);
		const onShow = () => {
			if (!document.hidden) refresh();
		};
		document.addEventListener('visibilitychange', onShow);
		return () => {
			clearInterval(poll);
			document.removeEventListener('visibilitychange', onShow);
		};
	});

	$effect(() => {
		const fresh = newAlerts(seen, data.alerts);
		seen = seenFrom(data.alerts);
		if (fresh.ready.length === 0 && fresh.qrWaiting.length === 0) return;

		if (fresh.ready.length > 0) {
			toast.success(
				fresh.ready.length === 1
					? `Ready to serve: ${describeAlert(fresh.ready[0]!)}`
					: `${fresh.ready.length} orders ready to serve: ${fresh.ready.map(describeAlert).join(', ')}`,
				{ duration: 15_000, action: { label: 'Orders', onClick: () => goto(`${base}/orders`) } }
			);
		}
		if (fresh.qrWaiting.length > 0) {
			toast.info(
				fresh.qrWaiting.length === 1
					? `Table order waiting for you: ${describeAlert(fresh.qrWaiting[0]!)}`
					: `${fresh.qrWaiting.length} table orders waiting for you`,
				{ duration: 15_000, action: { label: 'Accept', onClick: () => goto(`${base}/orders`) } }
			);
		}

		if (sound) blocked = !playTone(fresh.ready.length > 0 ? 'ready' : 'ticket');

		// Bring whichever list this tab is showing up to date straight away.
		invalidate('app:dining-orders');
		invalidate('app:dining-floor');
	});

	function toggleSound() {
		sound = !sound;
		writeSoundPref('dining-alert-sound', sound);
		// The tap that turns it on is also what lets the browser play it: a short preview, not the full 5 seconds.
		if (sound) blocked = !playTone('ready', 1.2);
		else stopSound();
	}
</script>

<div class="border-b border-border bg-surface print:hidden">
	<div class="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6">
		<div class="flex items-center gap-3">
			<h1 class="text-xl font-semibold tracking-tight text-ink">Dining</h1>
			<Button
				variant="outline"
				size="sm"
				class="ml-auto h-9 gap-2"
				onclick={toggleSound}
				aria-pressed={sound}
				title={sound ? 'Alert sound is on' : 'Alert sound is off'}
			>
				{#if sound}<BellIcon class="size-4" aria-hidden="true" />{:else}<BellOffIcon class="size-4" aria-hidden="true" />{/if}
				{sound ? 'Sound on' : 'Sound off'}
			</Button>
		</div>
		{#if sound && blocked && !soundReady()}
			<p class="mt-2 text-xs text-warning" role="status">Tap anywhere on the page once to switch the alert sound on.</p>
		{/if}
		<nav class="-mb-px mt-4 flex gap-1 overflow-x-auto" aria-label="Dining sections">
			{#each tabs as tab (tab.seg)}
				<a
					href="{base}/{tab.seg}"
					aria-current={isActive(tab.seg) ? 'page' : undefined}
					class="shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors {isActive(tab.seg)
						? 'border-brand text-ink'
						: 'border-transparent text-ink-muted hover:text-ink'}"
				>
					{tab.label}
					{#if tab.ready}
						<span class="ml-1.5 rounded-full border border-brand/40 bg-brand/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-brand" aria-label="{tab.ready} ready to serve">{tab.ready} ready</span>
					{/if}
					{#if tab.badge}
						<span class="ml-1.5 rounded-full bg-brand px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-brand-ink" aria-label="{tab.badge} {tab.hint}">{tab.badge}</span>
					{/if}
				</a>
			{/each}
		</nav>
	</div>
</div>

{@render children()}
