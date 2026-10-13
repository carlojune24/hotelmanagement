<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { MIN_PASSWORD } from '$lib/user-schema';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let busy = $state(false);
	const err = (name: string): string | undefined =>
		(form as { errors?: Record<string, string[] | undefined> } | null)?.errors?.[name]?.[0];
</script>

<svelte:head><title>Account · HR</title></svelte:head>

<div class="mx-auto max-w-xl space-y-6">
	<h1 class="text-5xl font-light tracking-tight">Account</h1>

	<section class="panel space-y-5 p-6" aria-label="Change password">
		<div>
			<p class="font-medium">{data.name}</p>
			<p class="text-sm text-ink-muted">{data.email}</p>
		</div>

		<form
			method="POST"
			class="space-y-4"
			use:enhance={() => {
				busy = true;
				return async ({ result, update }) => {
					await update({ reset: result.type === 'success' });
					busy = false;
					if (result.type === 'success') {
						toast.success((result.data as { ok?: string } | undefined)?.ok ?? 'Saved.');
					} else if (result.type === 'failure') {
						const m = (result.data as { message?: string } | undefined)?.message;
						if (m) toast.error(m);
					}
				};
			}}
		>
			<h2 class="text-xl font-light">Change password</h2>
			<div class="space-y-1.5">
				<Label for="current">Current password</Label>
				<Input id="current" name="current" type="password" autocomplete="current-password" required />
				{#if err('current')}<p class="text-sm text-destructive">{err('current')}</p>{/if}
			</div>
			<div class="space-y-1.5">
				<Label for="next">New password</Label>
				<Input id="next" name="next" type="password" autocomplete="new-password" minlength={MIN_PASSWORD} required />
				<p class="text-xs text-ink-muted">At least {MIN_PASSWORD} characters.</p>
				{#if err('next')}<p class="text-sm text-destructive">{err('next')}</p>{/if}
			</div>
			<div class="space-y-1.5">
				<Label for="confirm">Confirm new password</Label>
				<Input id="confirm" name="confirm" type="password" autocomplete="new-password" required />
				{#if err('confirm')}<p class="text-sm text-destructive">{err('confirm')}</p>{/if}
			</div>
			<Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</Button>
		</form>
	</section>
</div>
