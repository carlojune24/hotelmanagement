<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let busy = $state(false);
</script>

<svelte:head><title>Sign in · HR</title></svelte:head>

<main class="grid min-h-dvh place-items-center p-6">
	<div class="panel w-full max-w-sm space-y-7 p-8">
		<div class="space-y-3">
			<span
				class="inline-flex h-9 items-center rounded-full border border-ink/40 px-5 font-display text-lg tracking-wide"
				>HR</span
			>
			<h1 class="text-4xl font-light">Sign in</h1>
		</div>

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
