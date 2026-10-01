<script lang="ts">
	import './[hotel]/(guest)/woven-ledger.css';
	import { darken, lighten, wovenPatternDataUri } from '$lib/woven-pattern';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The Municipal Register: Woven Ledger vocabulary with ONE fixed city accent (no hotel
	// accents here — the One Thread Rule), and ratings as a plain mono figure, never star chrome.
	const ACCENT = '#0f5f66';
	const rootStyle =
		`--hotel-accent: ${ACCENT}; ` +
		`--hotel-accent-light: ${lighten(ACCENT, 0.4)}; ` +
		`--hotel-accent-deep: ${darken(ACCENT, 0.3)}; ` +
		`--hotel-woven-pattern: url("${wovenPatternDataUri(ACCENT)}");`;

	const { totals } = $derived(data);
</script>

<svelte:head>
	<title>{data.cityName} Hotel Register</title>
	<meta
		name="description"
		content="Registered hotels in {data.cityName}, with guest ratings from approved reviews."
	/>
</svelte:head>

<div class="woven-ledger register" style={rootStyle}>
	<header class="ledger-hairline">
		<div class="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
			<a href="/" class="ledger-display text-lg">{data.cityName} Hotel Register</a>
			<nav class="flex items-center gap-5 text-sm">
				{#if data.signedIn}
					{#if data.dashboardHref}
						<a class="register-link" href={data.dashboardHref}>My dashboard</a>
					{/if}
					<form method="POST" action="/auth/logout">
						<input type="hidden" name="redirectTo" value="/" />
						<button type="submit" class="register-link">Sign out</button>
					</form>
				{:else}
					<a class="register-link" href="/auth/login">Staff sign in</a>
				{/if}
			</nav>
		</div>
	</header>

	<div class="ledger-woven-band register-band" aria-hidden="true"></div>

	<main class="mx-auto max-w-5xl px-4 pb-16 pt-10 sm:px-6">
		<h1 class="register-title">Hotels of {data.cityName}</h1>

		{#if totals.hotels > 0}
			<p class="register-summary">
				<span class="ledger-data">{totals.hotels}</span>
				{totals.hotels === 1 ? 'hotel' : 'hotels'} registered ·
				<span class="ledger-data">{totals.rooms}</span>
				{totals.rooms === 1 ? 'room' : 'rooms'}
				{#if totals.overall.avg !== null}
					· average guest rating <span class="ledger-data">{totals.overall.avg.toFixed(1)}</span>
					from <span class="ledger-data">{totals.overall.count}</span>
					{totals.overall.count === 1 ? 'review' : 'reviews'}
				{/if}
			</p>
		{/if}

		<form method="GET" class="register-filter" role="search">
			<label class="register-filter-field">
				<span class="ledger-label">Search</span>
				<input
					class="ledger-field"
					type="search"
					name="q"
					value={data.q}
					placeholder="Hotel name or city"
					autocomplete="off"
				/>
			</label>
			<label class="register-filter-field register-filter-sort">
				<span class="ledger-label">Sort by</span>
				<select class="ledger-field" name="sort" value={data.sort}>
					<option value="rating">Highest rated</option>
					<option value="name">Name A–Z</option>
				</select>
			</label>
			<button type="submit" class="ledger-btn-primary register-apply">Apply</button>
		</form>

		{#if data.rows.length === 0}
			<div class="register-empty">
				{#if data.q.trim()}
					<p class="ledger-display text-xl">No hotels match “{data.q.trim()}”.</p>
					<p class="mt-2 text-sm" style="color: var(--ledger-ink-muted)">
						<a class="register-link" href="/">Show all hotels</a>
					</p>
				{:else}
					<p class="ledger-display text-xl">No hotels are registered yet.</p>
					<p class="mt-2 text-sm" style="color: var(--ledger-ink-muted)">
						Hotels appear here once they are published.
					</p>
				{/if}
			</div>
		{:else}
			<ul class="register-list">
				{#each data.rows as h (h.id)}
					<li>
						<a class="register-row" href="/{h.slug}">
							<span
								class="register-thumb"
								class:ledger-woven-band={!h.photoUrl}
								style={h.photoUrl ? `background-image: url("${h.photoUrl}")` : ''}
								role="img"
								aria-label={h.photoUrl ? `${h.name}` : 'No photo yet'}
							></span>
							<span class="register-main">
								<span class="ledger-display register-name">{h.name}</span>
								<span class="register-meta">
									{h.city ?? 'Location not listed'} ·
									<span class="ledger-data">{h.rooms}</span>
									{h.rooms === 1 ? 'room' : 'rooms'}
								</span>
							</span>
							<span class="register-rating">
								{#if h.rating !== null}
									<span class="ledger-data register-rating-value">{h.rating.toFixed(1)}</span>
									<span class="register-rating-count">
										<span class="ledger-data">{h.reviewCount}</span>
										{h.reviewCount === 1 ? 'review' : 'reviews'}
									</span>
								{:else}
									<span class="register-rating-count">Not yet rated</span>
								{/if}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}

		<p class="register-foot">
			Ratings are the average of guest reviews that hotels' staff have approved, on a scale of 1 to
			5. A hotel with no approved reviews shows as not yet rated.
		</p>
	</main>
</div>

<style>
	.register {
		--register-gap: 1rem;
	}
	.register ::selection {
		background: var(--hotel-accent-light);
		color: var(--ledger-ink);
	}
	.register-band {
		height: 14px;
	}
	.register-link {
		color: var(--ledger-ink);
		border-bottom: 1px solid transparent;
		padding-bottom: 1px;
		background: none;
		cursor: pointer;
	}
	.register-link:hover {
		border-bottom-color: var(--hotel-accent);
	}
	.register-link:focus-visible,
	.register-row:focus-visible {
		outline: 2px solid var(--hotel-accent);
		outline-offset: 3px;
	}
	.register-title {
		font-size: clamp(2rem, 5vw, 3.25rem);
		line-height: 1.05;
		text-wrap: balance;
		color: var(--hotel-accent-deep);
	}
	.register-summary {
		margin-top: 0.75rem;
		max-width: 68ch;
		line-height: 1.55;
		color: var(--ledger-ink-muted);
	}
	.register-summary :global(.ledger-data) {
		color: var(--ledger-ink);
	}
	.register-filter {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--register-gap);
		margin-top: 2rem;
		padding-bottom: 1.25rem;
		border-bottom: 1px solid var(--ledger-rule);
	}
	.register-filter-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1 1 14rem;
	}
	.register-filter-sort {
		flex: 0 1 12rem;
	}
	.register-apply {
		padding: 0.5rem 1.25rem;
	}
	.register-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.register-list li {
		border-bottom: 1px solid var(--ledger-rule);
	}
	.register-row {
		display: grid;
		grid-template-columns: 6rem 1fr auto;
		align-items: center;
		gap: var(--register-gap);
		padding: 1rem 0.25rem;
		color: inherit;
		text-decoration: none;
	}
	.register-row:hover {
		background: var(--ledger-paper-2);
	}
	.register-thumb {
		display: block;
		width: 6rem;
		height: 4.5rem;
		border-radius: 4px;
		background-size: cover;
		background-position: center;
		background-color: var(--ledger-paper-2);
		opacity: 1;
	}
	.register-thumb.ledger-woven-band {
		opacity: 0.55;
	}
	.register-main {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}
	.register-name {
		font-size: 1.375rem;
		line-height: 1.15;
		overflow-wrap: anywhere;
	}
	.register-meta,
	.register-rating-count {
		font-size: 0.875rem;
		color: var(--ledger-ink-muted);
	}
	.register-rating {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.125rem;
		text-align: right;
		min-width: 5.5rem;
	}
	.register-rating-value {
		font-size: 1.25rem;
		line-height: 1.1;
	}
	.register-empty {
		padding: 3rem 0;
	}
	.register-foot {
		margin-top: 2rem;
		max-width: 68ch;
		font-size: 0.8125rem;
		line-height: 1.55;
		color: var(--ledger-ink-muted);
	}
	@media (max-width: 30rem) {
		.register-row {
			grid-template-columns: 4.5rem 1fr;
		}
		.register-thumb {
			width: 4.5rem;
			height: 3.5rem;
		}
		.register-rating {
			grid-column: 2;
			flex-direction: row;
			align-items: baseline;
			justify-content: flex-start;
			gap: 0.5rem;
			text-align: left;
		}
	}
</style>
