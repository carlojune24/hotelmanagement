<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import { page } from '$app/state';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import MenuIcon from '@lucide/svelte/icons/menu';
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import { lighten } from '$lib/woven-pattern';
	import type { StorefrontTheme } from '$lib/storefront-mode.svelte';

	let {
		hotelSlug,
		hotelName,
		logoUrl,
		showAmenities,
		showFunctionHall,
		showDining,
		showReviews,
		transparentOverHero = false,
		accent,
		accentDeep,
		paper,
		paperDeep
	}: {
		hotelSlug: string;
		hotelName: string;
		logoUrl: string | null | undefined;
		showAmenities: boolean;
		showFunctionHall: boolean;
		showDining: boolean;
		showReviews: boolean;
		/** True only on the homepage, and only when it has hero media for the nav to sit over.
		    Every other page gets the solid nav from the start. */
		transparentOverHero?: boolean;
		/** Per-hotel theme values, needed again here because the mobile menu's `Sheet` renders through
		    a bits-ui portal to `document.body`, outside the `.woven-ledger` wrapper that normally carries
		    them as inline custom properties. */
		accent: string;
		accentDeep: string;
		paper: string;
		paperDeep: string;
	} = $props();

	const sfTheme = getContext<StorefrontTheme>('sf-theme');

	const sheetThemeStyle = $derived(
		`--hotel-accent: ${accent}; --hotel-accent-light: ${lighten(accent, 0.55)}; --hotel-accent-deep: ${accentDeep}; ` +
			`--ledger-paper: ${paper}; --ledger-paper-2: ${paperDeep}; ` +
			`--ledger-ink: oklch(0.26 0.02 60); --ledger-rule: oklch(0.82 0.02 65);`
	);

	// Solid once the guest scrolls off the very top; a small fixed threshold, since the hero's real
	// height varies by device.
	const SCROLL_THRESHOLD = 40;
	let scrolled = $state(false);
	onMount(() => {
		if (!transparentOverHero) return;
		const onScroll = () => (scrolled = window.scrollY > SCROLL_THRESHOLD);
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	});

	// Absolute /{slug}/... paths: this nav renders from several nesting depths.
	const base = $derived(`/${hotelSlug}`);
	const path = $derived(page.url.pathname);
	const current = (href: string) => (path === href || path.startsWith(`${href}/`) ? 'page' : undefined);

	const links = $derived([
		{ href: `${base}#about`, label: 'About', show: true },
		{ href: `${base}#rooms`, label: 'Rooms', show: true },
		{ href: `${base}#amenities`, label: 'Amenities', show: showAmenities },
		{ href: `${base}/dining`, label: 'Dining', show: showDining, page: true },
		{ href: `${base}/meetings-events`, label: 'Events', show: showFunctionHall, page: true },
		{ href: `${base}#gallery`, label: 'Gallery', show: true },
		{ href: `${base}#reviews`, label: 'Reviews', show: showReviews },
		{ href: `${base}/contact`, label: 'Contact', show: true, page: true }
	]);

	let menuOpen = $state(false);
</script>

<nav class="sf-nav" class:is-over-hero={transparentOverHero && !scrolled} aria-label="Main">
	<div class="sf-wrap sf-nav-inner">
		<a href={base} class="sf-nav-brand">
			{#if logoUrl}<img src={logoUrl} alt="" />{/if}
			<span>{hotelName}</span>
		</a>

		<div class="sf-nav-links">
			{#each links.filter((l) => l.show) as l (l.href)}
				<a href={l.href} class="sf-nav-link" aria-current={l.page ? current(l.href) : undefined}>{l.label}</a>
			{/each}
		</div>

		<div class="sf-nav-actions">
			<button
				type="button"
				class="sf-nav-menu-btn sf-mode-btn"
				aria-label="Switch between light and dark mode"
				onclick={() => sfTheme.toggle()}
			>
				<SunIcon class="sf-mode-sun size-5" aria-hidden="true" />
				<MoonIcon class="sf-mode-moon size-5" aria-hidden="true" />
			</button>
			<a href="{base}/dates" class="sf-btn sf-btn--sm">Book now</a>
			<button
				type="button"
				class="sf-nav-menu-btn"
				aria-label="Open menu"
				aria-expanded={menuOpen}
				onclick={() => (menuOpen = true)}
			>
				<MenuIcon class="size-5" aria-hidden="true" />
			</button>
		</div>
	</div>
</nav>

<Sheet.Root bind:open={menuOpen}>
	<Sheet.Content
		side="right"
		style={sheetThemeStyle}
		data-mode={sfTheme.mode}
		class="woven-ledger w-full border-l-[var(--ledger-rule)] bg-[var(--ledger-paper)] text-[var(--ledger-ink)] sm:max-w-sm"
	>
		<Sheet.Header>
			<Sheet.Title class="sf-nav-brand-title text-xl">{hotelName}</Sheet.Title>
		</Sheet.Header>
		<nav class="flex flex-col px-5 pb-8" aria-label="Site">
			{#each links.filter((l) => l.show) as l (l.href)}
				<a href={l.href} class="sf-nav-mobile-link" onclick={() => (menuOpen = false)}>{l.label}</a>
			{/each}
			<a href="{base}/dates" class="sf-btn mt-6" onclick={() => (menuOpen = false)}>Book now</a>
			<button type="button" class="sf-btn sf-btn--outline mt-3" onclick={() => sfTheme.toggle()}>
				<SunIcon class="sf-mode-sun size-4" aria-hidden="true" />
				<MoonIcon class="sf-mode-moon size-4" aria-hidden="true" />
				Switch light / dark
			</button>
		</nav>
	</Sheet.Content>
</Sheet.Root>
