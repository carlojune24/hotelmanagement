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
	const codes = $derived((form as { recoveryCodes?: string[] } | null)?.recoveryCodes ?? null);
	const recoveryError = $derived((form as { recoveryError?: string } | null)?.recoveryError ?? null);
	let copied = $state(false);
	async function copyCodes() {
		if (!codes) return;
		try {
			await navigator.clipboard.writeText(codes.join('\n'));
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			toast.error('Could not copy. Select the codes and copy them by hand.');
		}
	}
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
			action="?/password"
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

	<section class="panel space-y-4 p-6" aria-label="Recovery codes">
		<div>
			<h2 class="text-xl font-light">Recovery codes</h2>
			<p class="mt-1 text-sm text-ink-muted">
				If sign-in needs an emailed code and the email does not arrive, one of these gets you in. Each works once.
				Print them or keep them somewhere safe, away from your password.
			</p>
		</div>

		{#if codes}
			<div class="space-y-3 rounded-2xl bg-white/70 p-4">
				<p class="text-sm font-medium">Your new codes. They are shown only now.</p>
				<ul class="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-base tracking-wider" aria-label="New recovery codes">
					{#each codes as c (c)}<li>{c}</li>{/each}
				</ul>
				<div class="flex flex-wrap gap-2">
					<Button type="button" variant="outline" onclick={copyCodes}>{copied ? 'Copied' : 'Copy'}</Button>
					<Button type="button" variant="outline" onclick={() => window.print()}>Print</Button>
				</div>
				<p class="text-xs text-ink-muted">Any older codes no longer work.</p>
			</div>
		{:else}
			<p class="text-sm">
				{#if data.recovery.total === 0}
					You have no recovery codes yet.
				{:else}
					<strong class="font-medium">{data.recovery.unused}</strong> of {data.recovery.total} unused.
				{/if}
			</p>
		{/if}

		<form
			method="POST"
			action="?/recovery"
			class="space-y-3"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update({ reset: true });
					busy = false;
				};
			}}
		>
			<div class="space-y-1.5">
				<Label for="rcurrent">Current password</Label>
				<Input id="rcurrent" name="current" type="password" autocomplete="current-password" required />
				{#if recoveryError}<p role="alert" class="text-sm text-destructive">{recoveryError}</p>{/if}
			</div>
			<Button type="submit" variant="outline" disabled={busy}>
				{data.recovery.total === 0 ? 'Create recovery codes' : 'Replace with new codes'}
			</Button>
		</form>
	</section>
</div>
