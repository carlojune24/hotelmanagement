<script lang="ts">
	import '@fontsource-variable/urbanist';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
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
		<header class="bar">
			<a href="/" class="brand" aria-label="MM Group of Companies">
				{#if data.logoUrl}
					<img src={data.logoUrl} alt="MM Group of Companies" />
				{:else}
					<span class="wordmark">MM Group</span>
				{/if}
			</a>
			<a href="/auth/login" class="signin">Sign in</a>
		</header>

		<main>
			<section class="hero">
				<p class="eyebrow">MM Group of Companies</p>
				<h2>Our hotels</h2>
				<div class="rule"></div>
				<p class="lede">Choose a property to see its rooms and book your stay.</p>
			</section>

			{#if data.hotels.length === 0}
				<p class="empty">Our hotels will appear here soon.</p>
			{:else}
				<ul class="grid">
					{#each data.hotels as h, i (h.slug)}
						<li style="--i:{i}">
							<a href="/{h.slug}" class="card" style={h.accent ? `--accent:${h.accent}` : ''}>
								<span class="photo">
									{#if h.image}
										<img src={h.image} alt="" loading={i < 2 ? 'eager' : 'lazy'} />
									{:else}
										<span class="mono" aria-hidden="true">{h.name.trim().charAt(0)}</span>
									{/if}
								</span>
								<span class="body">
									{#if h.city}<span class="city">{h.city}</span>{/if}
									<span class="name">{h.name}</span>
									{#if h.tagline}<span class="tag">{h.tagline}</span>{/if}
									<span class="go">View hotel <span aria-hidden="true">→</span></span>
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</main>

		<footer class="foot">© {new Date().getFullYear()} MM Group of Companies</footer>
	</div>
{/if}

<style>
	/* Gold & black, the HR app's dark world, scoped to this page only. */
	.landing {
		--ink: oklch(0.95 0.01 90);
		--muted: oklch(0.73 0.012 85);
		--gold: oklch(0.85 0.15 90);
		--gold-deep: oklch(0.78 0.14 85);
		--line: oklch(1 0 0 / 0.12);
		--card: oklch(0.205 0.01 85);
		min-height: 100dvh;
		color: var(--ink);
		font-family: 'Inter Variable', sans-serif;
		background:
			radial-gradient(60rem 40rem at 100% 0%, oklch(0.8 0.15 90 / 0.13), transparent 65%),
			linear-gradient(135deg, oklch(0.13 0.006 85) 0%, oklch(0.19 0.018 90) 100%);
		background-attachment: fixed;
		display: flex;
		flex-direction: column;
	}
	.bar,
	main,
	.foot {
		width: 100%;
		max-width: 76rem;
		margin-inline: auto;
		padding-inline: 1rem;
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding-block: 1.25rem;
		border-bottom: 1px solid var(--line);
	}
	.brand img {
		height: 3rem;
		width: auto;
		max-width: 14rem;
		object-fit: contain;
		display: block;
	}
	.wordmark {
		font-family: 'Urbanist Variable', sans-serif;
		font-weight: 300;
		font-size: 1.5rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}
	.signin {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding-inline: 1.5rem;
		border: 1px solid var(--gold-deep);
		border-radius: 999px;
		color: var(--gold);
		font-size: 0.875rem;
		letter-spacing: 0.04em;
		transition: background 0.2s, color 0.2s;
	}
	.signin:hover,
	.signin:focus-visible {
		background: var(--gold);
		color: oklch(0.18 0.01 85);
		outline: none;
	}
	.hero {
		padding-block: 4rem 3rem;
		max-width: 44rem;
	}
	.eyebrow {
		font-size: 0.75rem;
		letter-spacing: 0.28em;
		text-transform: uppercase;
		color: var(--gold);
	}
	h2 {
		margin-top: 0.75rem;
		font-family: 'Urbanist Variable', sans-serif;
		font-weight: 300;
		font-size: clamp(2.75rem, 7vw, 5rem);
		line-height: 1.04;
		letter-spacing: -0.02em;
		text-wrap: balance;
	}
	.rule {
		width: 4rem;
		height: 1px;
		margin-block: 1.5rem;
		background: var(--gold-deep);
	}
	.lede {
		color: var(--muted);
		font-size: 1.0625rem;
		max-width: 34rem;
	}
	.grid {
		display: grid;
		gap: 1.5rem;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
		padding-bottom: 5rem;
	}
	.card {
		--accent: var(--gold-deep);
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: 1.5rem;
		background: var(--card);
		box-shadow: 0 18px 40px -18px oklch(0 0 0 / 0.6);
		transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.25s;
	}
	.card:hover,
	.card:focus-visible {
		transform: translateY(-4px);
		border-color: var(--gold-deep);
		outline: none;
	}
	.photo {
		position: relative;
		display: block;
		aspect-ratio: 4 / 3;
		background: color-mix(in oklab, var(--accent) 30%, oklch(0.16 0.01 85));
		border-bottom: 2px solid var(--accent);
	}
	.photo img {
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
		font-family: 'Urbanist Variable', sans-serif;
		font-weight: 200;
		font-size: 6rem;
		color: color-mix(in oklab, var(--accent) 70%, white);
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 1.25rem 1.5rem 1.5rem;
		flex: 1;
	}
	.city {
		font-size: 0.75rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--gold);
	}
	.name {
		font-family: 'Urbanist Variable', sans-serif;
		font-weight: 300;
		font-size: 1.75rem;
		line-height: 1.15;
	}
	.tag {
		color: var(--muted);
		font-size: 0.9375rem;
	}
	.go {
		margin-top: auto;
		padding-top: 1rem;
		font-size: 0.875rem;
		color: var(--gold);
	}
	.empty {
		padding-block: 3rem 6rem;
		color: var(--muted);
	}
	.foot {
		margin-top: auto;
		padding-block: 1.5rem;
		border-top: 1px solid var(--line);
		font-size: 0.8125rem;
		color: var(--muted);
	}
	@media (min-width: 640px) {
		.bar,
		main,
		.foot {
			padding-inline: 2rem;
		}
	}
	@media (prefers-reduced-motion: no-preference) {
		.hero > *,
		.grid li {
			animation: rise 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
		}
		.grid li {
			animation-delay: calc(var(--i) * 70ms + 150ms);
		}
		@keyframes rise {
			from {
				opacity: 0;
				transform: translateY(10px);
			}
		}
	}
</style>
