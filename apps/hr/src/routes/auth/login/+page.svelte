<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let busy = $state(false);

	const POINTS = [
		'Managers submit rosters, leave and overtime; Main HR approves.',
		'DTRs are built from the biometric data, then sent to Main HR to lock.',
		'Payslips are released after each payroll run.'
	];
</script>

<svelte:head><title>Sign in · HR</title></svelte:head>

<main class="mx-auto grid min-h-dvh w-full max-w-6xl items-center gap-10 p-6 md:p-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-16">
	<section class="intro order-2 space-y-8 lg:order-1">
		<div class="flex items-center gap-3">
			{#if data.logoUrl}
				<img src={data.logoUrl} alt={data.orgName} class="h-14 w-auto max-w-56 object-contain" />
			{:else}
				<span class="inline-flex h-9 items-center rounded-full border border-ink/40 px-5 font-display text-lg tracking-wide">HR</span>
				<span class="text-sm text-ink-muted">{data.orgName}</span>
			{/if}
		</div>

		<div class="space-y-4">
			<h1 class="max-w-xl font-display text-4xl leading-[1.08] font-light tracking-tight text-balance md:text-5xl">
				One cutoff, every business, one payroll.
			</h1>
			<div class="h-px w-16 bg-gold-deep"></div>
			<p class="max-w-lg text-base text-ink-muted">
				Rosters, leave, overtime and DTRs from every establishment come together here, so Main HR can run payroll
				without chasing anyone.
			</p>
		</div>

		<ul class="max-w-lg divide-y divide-dotted divide-ink/25 text-sm">
			{#each POINTS as point (point)}
				<li class="py-3">{point}</li>
			{/each}
		</ul>

		<p class="text-xs text-ink-muted">Staff access only. Ask Main HR if you need an account.</p>
	</section>

	<div class="panel order-1 w-full max-w-sm space-y-7 p-8 lg:order-2 lg:justify-self-center">
		<h2 class="text-4xl font-light">Sign in</h2>

		<form
			method="POST"
			class="space-y-4"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update({ reset: false });
					busy = false;
				};
			}}
		>
			<input type="hidden" name="next" value={data.next} />
			<div class="space-y-1.5">
				<Label for="email">Email</Label>
				<Input id="email" name="email" type="email" autocomplete="username" required />
			</div>
			<div class="space-y-1.5">
				<Label for="password">Password</Label>
				<Input id="password" name="password" type="password" autocomplete="current-password" required />
			</div>
			{#if form?.error}
				<p role="alert" class="text-sm text-destructive">{form.error}</p>
			{/if}
			<Button type="submit" class="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
		</form>
	</div>
</main>

<style>
	/* One authored moment: the intro settles in once. Reduced-motion users get it static. */
	@media (prefers-reduced-motion: no-preference) {
		.intro > * {
			animation: rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
		}
		.intro > :nth-child(2) {
			animation-delay: 70ms;
		}
		.intro > :nth-child(3) {
			animation-delay: 140ms;
		}
		.intro > :nth-child(4) {
			animation-delay: 210ms;
		}
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
</style>
