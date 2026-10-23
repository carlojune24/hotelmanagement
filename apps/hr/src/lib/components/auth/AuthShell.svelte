<script lang="ts">
	import '@fontsource-variable/urbanist';
	import '@fontsource-variable/playfair-display';
	import { enhance } from '$app/forms';

	/**
	 * The sign-in screen shared by the hotel platform login, each hotel's staff login and the HR app:
	 * dark black-and-gold over a photo, same world as the public landing page. Copy is passed in.
	 * (Kept as a copy in apps/hotel and apps/hr; edit both. Only the HR copy has the emailed-code step.)
	 */
	let {
		brandName,
		logoUrl = null,
		photoUrl = null,
		headline = 'Redefining Comfort the MM Way',
		blurb,
		points = [],
		note = '',
		next = '',
		error = null,
		backHref = null,
		backLabel = 'Back',
		step = 'password',
		codeEmail = '',
		codeMinutes = 10,
		sendsLeft = 0,
		info = null,
		mailFailed = false
	}: {
		brandName: string;
		logoUrl?: string | null;
		photoUrl?: string | null;
		headline?: string;
		blurb: string;
		points?: string[];
		note?: string;
		next?: string;
		error?: string | null;
		backHref?: string | null;
		backLabel?: string;
		/** 'code' = the emailed 6-digit code, asked for after a correct password. */
		step?: 'password' | 'code';
		/** Masked address the code was sent to. */
		codeEmail?: string;
		codeMinutes?: number;
		sendsLeft?: number;
		info?: string | null;
		/** The code could not be emailed; a recovery code is the way in. */
		mailFailed?: boolean;
	} = $props();

	let busy = $state(false);
</script>

<div class="auth">
	<img class="photo" src={photoUrl ?? '/landing-hero.webp'} alt="" />
	<div class="shade"></div>

	<main>
		<a href={backHref ?? '/'} class="brand" aria-label={brandName}>
			{#if logoUrl}
				<img src={logoUrl} alt={brandName} />
			{:else}
				<span class="wordmark">{brandName}</span>
			{/if}
		</a>

		<section class="copy">
				<p class="eyebrow">Welcome back</p>
				<h1>{headline}</h1>
				<div class="rule"></div>
				<p class="blurb">{blurb}</p>
				{#if points.length}
					<ul class="points">
						{#each points as p (p)}<li>{p}</li>{/each}
					</ul>
				{/if}
		</section>

		<div class="card">
			{#if step === 'code'}
				<h2>Check your email</h2>
				<p class="lead">
					{#if mailFailed}
						We could not email a code to <strong>{codeEmail}</strong>. Enter one of your recovery codes below, or try
						sending a new code.
					{:else}
						We sent a 6-digit code to <strong>{codeEmail}</strong>. It works for {codeMinutes} minutes.
					{/if}
				</p>
				<form
					method="POST"
					action="?/verify"
					use:enhance={() => {
						busy = true;
						return async ({ update }) => {
							await update({ reset: false });
							busy = false;
						};
					}}
				>
					<label>
						<span>Sign-in code</span>
						<input
							name="code"
							inputmode="numeric"
							autocomplete="one-time-code"
							maxlength="12"
							placeholder="000 000"
							autocapitalize="characters"
							spellcheck="false"
							required
						/>
					</label>
					<p class="hint">Can't get the email? Enter one of your recovery codes instead.</p>
					{#if error}<p role="alert" class="error">{error}</p>{/if}
					{#if info && !error}<p role="status" class="info">{info}</p>{/if}
					<button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
					{#if sendsLeft > 0}
						<button type="submit" formaction="?/resend" formnovalidate class="secondary" disabled={busy}>
							Send a new code
						</button>
					{/if}
				</form>
				<a class="again" href="/auth/login">Use a different account</a>
			{:else}
				<h2>Sign in</h2>
				<form
					method="POST"
					use:enhance={() => {
						busy = true;
						return async ({ update }) => {
							await update({ reset: false });
							busy = false;
						};
					}}
				>
					<input type="hidden" name="next" value={next} />
					<label>
						<span>Email</span>
						<input name="email" type="email" autocomplete="username" required />
					</label>
					<label>
						<span>Password</span>
						<input name="password" type="password" autocomplete="current-password" required />
					</label>
					{#if error}<p role="alert" class="error">{error}</p>{/if}
					<button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
				</form>
			{/if}
		</div>

		<div class="foot">
			{#if note}<p class="note">{note}</p>{/if}
			{#if backHref}<a class="back" href={backHref}>← {backLabel}</a>{/if}
		</div>
	</main>
</div>

<style>
	.auth {
		--ink: oklch(0.95 0.01 90);
		--muted: oklch(0.76 0.012 85);
		--gold: oklch(0.82 0.13 88);
		--gold-deep: oklch(0.7 0.12 82);
		position: relative;
		isolation: isolate;
		min-height: 100dvh;
		color: var(--ink);
		font-family: 'Inter Variable', sans-serif;
		background: oklch(0.13 0.006 85);
	}
	.photo {
		position: absolute;
		inset: 0;
		z-index: -2;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.shade {
		position: absolute;
		inset: 0;
		z-index: -1;
		background:
			linear-gradient(90deg, oklch(0.1 0.006 85 / 0.85) 0%, oklch(0.1 0.006 85 / 0.55) 55%, oklch(0.1 0.006 85 / 0.7) 100%);
	}
	/* Small screens: logo, then the form, then the welcome copy, stacked from the top. */
	main {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas: 'brand' 'copy' 'card' 'foot';
		align-content: start;
		gap: 1.5rem;
		width: 100%;
		max-width: 76rem;
		min-height: 100dvh;
		margin-inline: auto;
		padding: 1.5rem 1.25rem 2.5rem;
	}
	.brand {
		grid-area: brand;
		justify-self: start;
	}
	.copy {
		grid-area: copy;
		padding-top: 0.5rem;
	}
	.foot {
		grid-area: foot;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.brand img {
		display: block;
		height: 3.25rem;
		width: auto;
		max-width: 14rem;
		object-fit: contain;
	}
	.wordmark {
		font-family: 'Urbanist Variable', sans-serif;
		font-weight: 300;
		font-size: 1.375rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
	}
	.eyebrow {
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.28em;
		text-transform: uppercase;
		color: var(--gold);
	}
	h1 {
		margin-top: 0.75rem;
		max-width: 14ch;
		font-family: 'Playfair Display Variable', serif;
		font-weight: 400;
		font-size: clamp(2.25rem, 5vw, 3.75rem);
		line-height: 1.08;
		text-wrap: balance;
	}
	.rule {
		width: 3.5rem;
		height: 2px;
		margin-block: 1.25rem;
		background: var(--gold-deep);
	}
	.blurb {
		max-width: 30rem;
		color: oklch(0.9 0.01 85);
		line-height: 1.6;
	}
	.points {
		max-width: 30rem;
		margin-top: 1.25rem;
		font-size: 0.875rem;
		color: var(--muted);
	}
	.points li {
		padding-block: 0.6rem;
		border-top: 1px dotted oklch(1 0 0 / 0.2);
	}
	.note {
		font-size: 0.75rem;
		color: var(--muted);
	}
	.back {
		font-size: 0.875rem;
		color: var(--gold);
	}
	.card {
		grid-area: card;
		width: 100%;
		max-width: 28rem;
		justify-self: center;
		padding: 1.5rem 1.25rem 1.75rem;
		border: 1px solid oklch(1 0 0 / 0.14);
		border-radius: 1.5rem;
		background: oklch(0.14 0.008 85 / 0.82);
		backdrop-filter: blur(14px);
		box-shadow: 0 24px 60px -20px oklch(0 0 0 / 0.7);
	}
	h2 {
		font-family: 'Playfair Display Variable', serif;
		font-weight: 400;
		font-size: 2rem;
		line-height: 1.1;
	}
	form {
		display: grid;
		gap: 1.1rem;
		margin-top: 1.5rem;
	}
	label {
		display: grid;
		gap: 0.4rem;
		font-size: 0.8125rem;
		color: var(--muted);
	}
	input[name='email'],
	input[name='password'],
	input[name='code'] {
		height: 3rem;
		padding-inline: 1.1rem;
		border: 1px solid oklch(1 0 0 / 0.2);
		border-radius: 999px;
		background: oklch(1 0 0 / 0.05);
		color: var(--ink);
		font-size: 0.9375rem;
		outline: none;
		transition: border-color 0.2s, box-shadow 0.2s;
	}
	input[name='code'] {
		font-family: 'JetBrains Mono Variable', ui-monospace, monospace;
		font-size: 1.25rem;
		letter-spacing: 0.3em;
		text-align: center;
	}
	input[name='email']:focus-visible,
	input[name='password']:focus-visible,
	input[name='code']:focus-visible {
		border-color: var(--gold);
		box-shadow: 0 0 0 3px oklch(0.82 0.13 88 / 0.25);
	}
	.error {
		font-size: 0.875rem;
		color: oklch(0.78 0.15 25);
	}
	.hint {
		margin-top: -0.5rem;
		font-size: 0.8125rem;
		color: var(--muted);
	}
	.lead {
		margin-top: 0.75rem;
		font-size: 0.9375rem;
		line-height: 1.5;
		color: oklch(0.9 0.01 85);
	}
	.info {
		font-size: 0.875rem;
		color: var(--gold);
	}
	button.secondary {
		border: 1px solid oklch(1 0 0 / 0.25);
		background: transparent;
		color: var(--ink);
	}
	button.secondary:hover:not(:disabled),
	button.secondary:focus-visible {
		background: oklch(1 0 0 / 0.08);
	}
	.again {
		display: inline-block;
		margin-top: 1.25rem;
		font-size: 0.875rem;
		color: var(--gold);
	}
	button {
		min-height: 3rem;
		border: 0;
		border-radius: 999px;
		background: var(--gold);
		color: oklch(0.18 0.01 85);
		font-size: 0.9375rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s;
	}
	button:hover:not(:disabled),
	button:focus-visible {
		background: oklch(0.88 0.13 88);
		outline: none;
	}
	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
	@media (min-width: 64rem) {
		main {
			grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
			grid-template-areas: 'brand card' 'copy card' 'foot card';
			grid-template-rows: auto 1fr auto;
			align-content: stretch;
			column-gap: 4rem;
			padding-inline: 2rem;
		}
		.copy {
			align-self: center;
		}
		.card {
			align-self: center;
			justify-self: center;
			max-width: 24rem;
			padding: 2rem;
		}
		h2 {
			font-size: 2.25rem;
		}
		input[name='email'],
		input[name='password'],
		input[name='code'],
		button {
			height: 2.75rem;
			min-height: 2.75rem;
		}
		label {
			font-size: 0.8125rem;
		}
	}
	@media (prefers-reduced-motion: no-preference) {
		.copy,
		.card,
		.foot {
			animation: rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
		}
		.card {
			animation-delay: 120ms;
		}
		@keyframes rise {
			from {
				opacity: 0;
				transform: translateY(8px);
			}
		}
	}
</style>
