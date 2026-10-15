<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import AvailabilityRangePicker from '$lib/components/storefront/availability-range-picker.svelte';
	import type { DayAvailability } from '$lib/day-availability';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import PlusIcon from '@lucide/svelte/icons/plus';

	/**
	 * The storefront's booking bar: dates + guests + "Check availability". It sits docked in the hero and,
	 * once the hero scrolls away, rides along as a slim strip under the nav (wide screens) or a bottom bar
	 * (phones), so searching is never more than a tap away. Submitting reloads the homepage with the stay in
	 * the URL, which is what turns the Rooms section into live availability and prices.
	 */
	let {
		hotelSlug,
		days,
		today,
		checkIn = $bindable(''),
		checkOut = $bindable(''),
		adults = $bindable(2),
		children = $bindable(0)
	}: {
		hotelSlug: string;
		days: DayAvailability[];
		today: string;
		checkIn?: string;
		checkOut?: string;
		adults?: number;
		children?: number;
	} = $props();

	let slotEl: HTMLDivElement | undefined = $state();
	let barEl: HTMLFormElement | undefined = $state();
	let stuck = $state(false);
	let slotHeight = $state<number | null>(null);
	let guestsOpen = $state(false);
	let guestsEl: HTMLDivElement | undefined = $state();

	const guests = $derived(adults + children);
	const guestsLabel = $derived(
		`${adults} adult${adults === 1 ? '' : 's'}${children > 0 ? ` · ${children} child${children === 1 ? '' : 'ren'}` : ''}`
	);
	const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
	const ready = $derived(Boolean(checkIn && checkOut));

	onMount(() => {
		if (!slotEl || !barEl) return;
		const root = slotEl.closest<HTMLElement>('.woven-ledger');
		const mq = window.matchMedia('(max-width: 899px)');

		// Keep floating bits (chat launcher, invoice pill, footer) clear of the phone bottom bar.
		const syncInset = () => {
			root?.style.setProperty('--sf-bottom-bar', stuck && mq.matches ? '4.5rem' : '0px');
		};

		const navH = parseFloat(getComputedStyle(root ?? document.documentElement).getPropertyValue('--sf-nav-h')) || 72;
		const rootFontPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
		const navPx = navH > 10 ? navH : navH * rootFontPx;

		const io = new IntersectionObserver(
			([e]) => {
				stuck = !e!.isIntersecting && e!.boundingClientRect.top < navPx;
				syncInset();
			},
			{ rootMargin: `-${Math.round(navPx)}px 0px 0px 0px` }
		);
		io.observe(slotEl);

		// The slot keeps the bar's docked height while the bar itself is fixed, so nothing jumps.
		const ro = new ResizeObserver(() => {
			if (!stuck && barEl) slotHeight = barEl.offsetHeight;
		});
		ro.observe(barEl);
		mq.addEventListener('change', syncInset);

		return () => {
			io.disconnect();
			ro.disconnect();
			mq.removeEventListener('change', syncInset);
			root?.style.setProperty('--sf-bottom-bar', '0px');
		};
	});

	function onDocClick(e: MouseEvent) {
		if (guestsOpen && guestsEl && !guestsEl.contains(e.target as Node)) guestsOpen = false;
	}
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') guestsOpen = false;
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!ready) return;
		guestsOpen = false;
		const q = new URLSearchParams({
			checkIn,
			checkOut,
			adults: String(adults),
			children: String(children)
		});
		await goto(`/${hotelSlug}?${q}`, { keepFocus: true, noScroll: true, invalidateAll: true });
		document.getElementById('rooms')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<svelte:window onclick={onDocClick} onkeydown={onKeydown} />

<div bind:this={slotEl} style:min-height={slotHeight ? `${slotHeight}px` : undefined}>
	<form
		bind:this={barEl}
		class="sf-bar"
		class:is-stuck={stuck}
		method="GET"
		action="/{hotelSlug}#rooms"
		onsubmit={submit}
		aria-label="Check availability"
	>
		<div class="sf-bar-inner">
			<div class="sf-bar-field">
				<AvailabilityRangePicker {days} {today} bind:checkIn bind:checkOut />
			</div>

			<div class="sf-bar-field sf-bar-field--guests" bind:this={guestsEl}>
				<button
					type="button"
					class="sf-guests-btn"
					aria-haspopup="dialog"
					aria-expanded={guestsOpen}
					onclick={() => (guestsOpen = !guestsOpen)}
				>
					<span class="sf-guests-col">
						<span class="sf-guests-label">Guests</span>
						<span class="sf-guests-value">{guestsLabel}</span>
					</span>
					<ChevronDownIcon class="size-4 shrink-0" aria-hidden="true" />
				</button>
				<input type="hidden" name="adults" value={adults} />
				<input type="hidden" name="children" value={children} />
				{#if guestsOpen}
					<div class="sf-guests-panel" role="dialog" aria-label="Guests">
						<div class="storefront-stepper-row">
							<span class="text-sm">Adults</span>
							<div class="storefront-stepper">
								<button type="button" aria-label="Fewer adults" disabled={adults <= 1} onclick={() => (adults = clamp(adults - 1, 1, 10))}><MinusIcon /></button>
								<span class="ledger-data">{adults}</span>
								<button type="button" aria-label="More adults" disabled={adults >= 10} onclick={() => (adults = clamp(adults + 1, 1, 10))}><PlusIcon /></button>
							</div>
						</div>
						<div class="storefront-stepper-row">
							<span class="text-sm">Children</span>
							<div class="storefront-stepper">
								<button type="button" aria-label="Fewer children" disabled={children <= 0} onclick={() => (children = clamp(children - 1, 0, 10))}><MinusIcon /></button>
								<span class="ledger-data">{children}</span>
								<button type="button" aria-label="More children" disabled={children >= 10} onclick={() => (children = clamp(children + 1, 0, 10))}><PlusIcon /></button>
							</div>
						</div>
						<p class="py-2 text-xs text-[var(--ledger-ink-muted)]">Per room · {guests} guest{guests === 1 ? '' : 's'} in total</p>
					</div>
				{/if}
			</div>

			<button type="submit" class="sf-btn sf-bar-submit" disabled={!ready}>
				{ready ? 'Check availability' : 'Pick your dates'}
			</button>
		</div>
	</form>
</div>
