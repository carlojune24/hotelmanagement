<script lang="ts">
	import '@fontsource-variable/urbanist';
	import '@fontsource-variable/playfair-display';
	import '@fontsource-variable/playfair-display/wght-italic.css';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import BuildingIcon from '@lucide/svelte/icons/building';
	import BellIcon from '@lucide/svelte/icons/concierge-bell';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const peso = (c: number) =>
		new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(c / 100);

	const hotels = $derived(data.signedIn ? [] : data.hotels);
	// Which photo each hotel card is showing (its arrows page through that hotel's own images).
	let shown = $state<Record<string, number>>({});
	const at = (slug: string, n: number) => Math.min(shown[slug] ?? 0, Math.max(n - 1, 0));
	const step = (slug: string, n: number, d: number) => (shown[slug] = (at(slug, n) + d + n) % n);

	function toFeatured(e: MouseEvent) {
		const el = document.getElementById('featured');
		if (!el) return;
		e.preventDefault();
		el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
	}
</script>

<svelte:head>
	<title>MM Group of Companies · Hotels</title>
	<meta name="description" content="The hotels of MM Group of Companies. Choose a property to see its rooms and book your stay." />
</svelte:head>

{#if data.signedIn}
	<div class="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 text-center">
		<h1 class="text-lg font-semibold text-ink">No hotel access yet</h1>
		<p class="mt-2 text-sm text-ink-muted">
			Your account isn't a member of any hotel. Ask your hotel admin to invite you, or contact
			platform support.
		</p>
		<form method="POST" action="/auth/logout" class="mt-4">
			<Button variant="outline" type="submit">Sign out</Button>
		</form>
	</div>
{:else}
	<div class="landing">
		<div class="stage">
			<img class="stage-photo" src={data.heroImageUrl ?? '/landing-hero.webp'} alt="" fetchpriority="high" />
			<div class="stage-shade"></div>

			<header class="bar">
				<a href="/" class="brand" aria-label="MM Group of Companies">
					{#if data.logoUrl}
						<img src={data.logoUrl} alt="MM Group of Companies" />
					{:else}
						<span class="wordmark">MM Group<small>Hotels &amp; Resorts</small></span>
					{/if}
				</a>
				<nav class="actions" aria-label="Site">
					<a href="/auth/login" class="signin">Sign in</a>
				</nav>
			</header>

			<section class="hero">
				<p class="eyebrow">Welcome to MM Group</p>
				<h1>Redefining Comfort the MM Way</h1>
				<div class="underline"></div>
				<p class="lede">
					Experience a perfect blend of comfort, modern design, and exceptional service across our handpicked
					hotels and resorts.
				</p>
				<ul class="pillars">
					<li><span class="ico"><MapPinIcon class="size-5" /></span>Prime Locations</li>
					<li><span class="ico"><BuildingIcon class="size-5" /></span>World-Class Amenities</li>
					<li><span class="ico"><BellIcon class="size-5" /></span>Exceptional Service</li>
				</ul>
			</section>
			<p class="script" aria-hidden="true">More than a stay,<br />it's an experience.</p>
		</div>

		<main id="featured">
			<div class="section-head">
				<p class="eyebrow">Our Hotels</p>
				<h2>Featured Hotels<span class="dash"></span></h2>
			</div>

			{#if hotels.length === 0}
				<p class="empty">Our hotels will appear here soon.</p>
			{:else}
				{#each hotels as current, hi (current.slug)}
					{@const n = current.images.length}
					{@const i = at(current.slug, n)}
					<article class="feature" style={current.accent ? `--accent:${current.accent}` : ''}>
						<div class="photo" role="group" aria-roledescription="carousel" aria-label="{current.name} photos">
							{#if n > 0}
								<img src={current.images[i]} alt="{current.name}, photo {i + 1} of {n}" loading={hi === 0 ? 'eager' : 'lazy'} />
							{:else}
								<span class="mono" aria-hidden="true">{current.name.trim().charAt(0)}</span>
							{/if}
							<span class="badge">Featured</span>
							{#if n > 1}
								<button type="button" class="arrow left" onclick={() => step(current.slug, n, -1)} aria-label="Previous photo of {current.name}"><ChevronLeftIcon class="size-5" /></button>
								<button type="button" class="arrow right" onclick={() => step(current.slug, n, 1)} aria-label="Next photo of {current.name}"><ChevronRightIcon class="size-5" /></button>
								<div class="counter" aria-hidden="true">
									<span>{i + 1} / {n}</span>
									{#each current.images as u, k (u)}<i class:on={k === i}></i>{/each}
								</div>
							{/if}
						</div>

						<div class="body">
							{#if current.city}<p class="eyebrow">{current.city}</p>{/if}
							<h3 class="name">{current.name}</h3>
							<div class="underline"></div>
							{#if current.about ?? current.tagline}<p class="about">{current.about ?? current.tagline}</p>{/if}
							{#if current.amenities.length}
								<ul class="chips">
									{#each current.amenities as a (a)}<li>{a}</li>{/each}
								</ul>
							{/if}
							{#if current.roomTypes > 0 || current.fromCentavos !== null}
								<p class="facts">
									{#if current.roomTypes > 0}{current.roomTypes} room {current.roomTypes === 1 ? 'type' : 'types'}{/if}
									{#if current.roomTypes > 0 && current.fromCentavos !== null} · {/if}
									{#if current.fromCentavos !== null}from <strong>{peso(current.fromCentavos)}</strong> / night{/if}
								</p>
							{/if}
							{#if current.address || current.phone || current.email}
								<p class="contact">
									{#if current.address}<span>{current.address}</span>{/if}
									{#if current.phone}<a href="tel:{current.phone}">{current.phone}</a>{/if}
									{#if current.email}<a href="mailto:{current.email}">{current.email}</a>{/if}
								</p>
							{/if}
							<div class="cta">
								<a href="/{current.slug}" class="book">Book Now <ArrowRightIcon class="size-4" /></a>
								<a href="/{current.slug}/management/login" class="book-outline">Manage</a>
							</div>
						</div>
					</article>
				{/each}
			{/if}
		</main>

		<footer class="foot">
			<div class="foot-in">
				<div>
					<p class="wordmark">MM Group<small>Hotels &amp; Resorts</small></p>
					<p class="foot-tag">Your next stay, our privilege.</p>
				</div>
				<nav aria-label="Quick links">
					<p class="foot-h">Quick links</p>
					<a href="#featured" onclick={toFeatured}>Our Hotels</a>
					<a href="/auth/login">Sign in</a>
				</nav>
				<p class="copy">© {new Date().getFullYear()} MM Group of Companies. All rights reserved.</p>
			</div>
		</footer>
	</div>
{/if}

<style>
	/* Gold & black, the HR app's dark world, scoped to this page only. */
	.landing {
		--ink: oklch(0.95 0.01 90);
		--muted: oklch(0.76 0.012 85);
		--gold: oklch(0.82 0.13 88);
		--gold-deep: oklch(0.7 0.12 82);
		--line: oklch(1 0 0 / 0.12);
		--card: oklch(0.17 0.008 85);
		min-height: 100dvh;
		color: var(--ink);
		font-family: 'Inter Variable', sans-serif;
		background: oklch(0.13 0.006 85);
		display: flex;
		flex-direction: column;
	}
	.bar,
	.hero,
	main,
	.foot-in {
		width: 100%;
		max-width: 76rem;
		margin-inline: auto;
		padding-inline: 1rem;
	}

	/* Hero stage */
	.stage {
		position: relative;
		isolation: isolate;
		display: flex;
		flex-direction: column;
		min-height: min(40rem, 90dvh);
	}
	.stage-photo {
		position: absolute;
		inset: 0;
		z-index: -2;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.stage-shade {
		position: absolute;
		inset: 0;
		z-index: -1;
		background:
			linear-gradient(90deg, oklch(0.1 0.006 85 / 0.78) 0%, oklch(0.1 0.006 85 / 0.35) 55%, oklch(0.1 0.006 85 / 0.1) 100%),
			linear-gradient(180deg, oklch(0.1 0.006 85 / 0.55) 0%, transparent 30%, oklch(0.13 0.006 85) 100%);
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding-block: 1.25rem;
	}
	.brand img {
		height: 3rem;
		width: auto;
		max-width: 14rem;
		object-fit: contain;
		display: block;
	}
	.wordmark {
		display: inline-flex;
		flex-direction: column;
		font-family: 'Urbanist Variable', sans-serif;
		font-weight: 300;
		font-size: 1.375rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		line-height: 1.1;
	}
	.wordmark small {
		font-size: 0.5625rem;
		letter-spacing: 0.3em;
		color: var(--gold);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 1.25rem;
	}
	.signin {
		font-size: 0.875rem;
		color: var(--ink);
		padding-block: 0.75rem;
	}
	.signin:hover,
	.signin:focus-visible {
		color: var(--gold);
		outline: none;
	}
	.book-outline {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding-inline: 1.5rem;
		border: 1px solid var(--gold-deep);
		border-radius: 999px;
		color: var(--gold);
		font-size: 0.875rem;
		letter-spacing: 0.02em;
		transition: background 0.2s, color 0.2s;
	}
	.book-outline:hover,
	.book-outline:focus-visible {
		background: var(--gold);
		color: oklch(0.18 0.01 85);
		outline: none;
	}
	.hero {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding-block: 3rem 5rem;
	}
	.eyebrow {
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.28em;
		text-transform: uppercase;
		color: var(--gold);
	}
	h1 {
		margin-top: 1rem;
		max-width: 14ch;
		font-family: 'Playfair Display Variable', serif;
		font-weight: 400;
		font-size: clamp(2.5rem, 6.5vw, 4.75rem);
		line-height: 1.06;
		text-wrap: balance;
	}
	.underline {
		width: 3.5rem;
		height: 2px;
		margin-block: 1.25rem;
		background: var(--gold-deep);
	}
	.lede {
		max-width: 30rem;
		color: oklch(0.9 0.01 85);
		font-size: 1rem;
		line-height: 1.6;
	}
	.pillars {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem 2rem;
		margin-top: 2rem;
		font-size: 0.8125rem;
	}
	.pillars li {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.ico {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border: 1px solid var(--gold-deep);
		border-radius: 999px;
		color: var(--gold);
	}
	.script {
		position: absolute;
		right: max(1.5rem, calc((100% - 76rem) / 2 + 1rem));
		bottom: 3.5rem;
		text-align: right;
		font-family: 'Playfair Display Variable', serif;
		font-style: italic;
		font-size: 1.375rem;
		line-height: 1.35;
		color: var(--gold);
		transform: rotate(-6deg);
		display: none;
	}
	@media (min-width: 900px) {
		.script {
			display: block;
		}
	}

	/* Featured hotels */
	.section-head {
		padding-block: 3.5rem 1.75rem;
	}
	h2 {
		margin-top: 0.5rem;
		display: flex;
		align-items: center;
		gap: 1rem;
		font-family: 'Playfair Display Variable', serif;
		font-weight: 400;
		font-size: clamp(2rem, 4.5vw, 3rem);
		line-height: 1.1;
	}
	.dash {
		width: 2.5rem;
		height: 2px;
		background: var(--gold-deep);
	}
	.feature {
		--accent: var(--gold-deep);
		display: grid;
		overflow: hidden;
		margin-bottom: 2rem;
		border: 1px solid var(--line);
		border-radius: 1.5rem;
		background: var(--card);
	}
	.photo {
		position: relative;
		aspect-ratio: 16 / 10;
		background: color-mix(in oklab, var(--accent) 30%, oklch(0.16 0.01 85));
	}
	.photo > img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.mono {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		font-family: 'Playfair Display Variable', serif;
		font-size: 7rem;
		color: color-mix(in oklab, var(--accent) 70%, white);
	}
	.badge {
		position: absolute;
		top: 1rem;
		left: 1rem;
		padding: 0.4rem 0.9rem;
		border-radius: 999px;
		background: var(--gold);
		color: oklch(0.18 0.01 85);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}
	.arrow {
		position: absolute;
		top: 50%;
		translate: 0 -50%;
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 999px;
		border: 1px solid oklch(1 0 0 / 0.25);
		background: oklch(0.1 0.006 85 / 0.6);
		color: var(--ink);
		cursor: pointer;
		transition: background 0.2s, color 0.2s;
	}
	.arrow:hover,
	.arrow:focus-visible {
		background: var(--gold);
		color: oklch(0.18 0.01 85);
		outline: none;
	}
	.arrow.left {
		left: 1rem;
	}
	.arrow.right {
		right: 1rem;
	}
	.counter {
		position: absolute;
		left: 1.25rem;
		bottom: 1rem;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.75rem;
		text-shadow: 0 1px 6px oklch(0 0 0 / 0.7);
	}
	.counter span {
		margin-right: 0.35rem;
	}
	.counter i {
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 999px;
		background: oklch(1 0 0 / 0.4);
	}
	.counter i.on {
		background: var(--gold);
	}
	.body {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1.75rem 1.5rem 2rem;
		justify-content: center;
	}
	.body .underline {
		margin-block: 0.25rem;
	}
	.name {
		font-family: 'Playfair Display Variable', serif;
		font-weight: 400;
		font-size: clamp(1.75rem, 3.4vw, 2.5rem);
		line-height: 1.1;
	}
	.about {
		color: oklch(0.88 0.01 85);
		font-size: 0.9375rem;
		line-height: 1.6;
		display: -webkit-box;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.chips li {
		padding: 0.4rem 0.9rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		font-size: 0.8125rem;
	}
	.facts {
		font-size: 0.9375rem;
		color: var(--muted);
	}
	.facts strong {
		color: var(--gold);
		font-weight: 600;
	}
	.contact {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1.25rem;
		font-size: 0.875rem;
		color: var(--muted);
	}
	.contact a:hover {
		color: var(--gold);
	}
	.cta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}
	.book {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2.75rem;
		padding-inline: 1.75rem;
		border-radius: 999px;
		background: var(--gold);
		color: oklch(0.18 0.01 85);
		font-size: 0.9375rem;
		font-weight: 600;
		transition: background 0.2s;
	}
	.book:hover,
	.book:focus-visible {
		background: oklch(0.88 0.13 88);
		outline: none;
	}
	main {
		padding-bottom: 3rem;
	}
	.empty {
		padding-block: 1rem 6rem;
		color: var(--muted);
	}

	/* Footer */
	.foot {
		margin-top: auto;
		border-top: 1px solid var(--line);
	}
	.foot-in {
		display: grid;
		gap: 1.5rem;
		padding-block: 2.25rem;
		font-size: 0.875rem;
	}
	.foot-tag {
		margin-top: 0.75rem;
		color: var(--muted);
	}
	.foot-h {
		margin-bottom: 0.5rem;
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--gold);
	}
	.foot nav a {
		display: block;
		padding-block: 0.2rem;
		color: var(--muted);
	}
	.foot nav a:hover {
		color: var(--gold);
	}
	.copy {
		font-size: 0.8125rem;
		color: var(--muted);
	}
	@media (min-width: 640px) {
		.bar,
		.hero,
		main,
		.foot-in {
			padding-inline: 2rem;
		}
	}
	@media (min-width: 900px) {
		.feature {
			grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
		}
		.photo {
			aspect-ratio: auto;
			min-height: 26rem;
			border-right: 2px solid var(--gold-deep);
		}
		.body {
			padding: 2.5rem 3rem;
		}
		.foot-in {
			grid-template-columns: 1.4fr 1fr 1.2fr;
			align-items: start;
		}
		.copy {
			text-align: right;
		}
	}
	@media (prefers-reduced-motion: no-preference) {
		.hero > *,
		.feature {
			animation: rise 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
		}
		@keyframes rise {
			from {
				opacity: 0;
				transform: translateY(10px);
			}
		}
	}
</style>
