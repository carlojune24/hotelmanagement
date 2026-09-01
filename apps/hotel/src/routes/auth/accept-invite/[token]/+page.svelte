<script lang="ts">
	import { enhance } from '$app/forms';
	import { ui } from '$lib/components/ui';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<div class="mx-auto flex min-h-full max-w-sm flex-col justify-center px-4 py-16">
	{#if !data.valid}
		<h1 class="{ui.h1} mb-2">Invite unavailable</h1>
		<p class="text-sm text-ink-muted">This invite link is invalid or has expired.</p>
		<a class="{ui.btn} {ui.btnGhost} mt-4" href="/auth/login">Go to sign in</a>
	{:else}
		<h1 class="{ui.h1} mb-1">Set up your account</h1>
		<p class="mb-6 text-sm text-ink-muted">
			{data.email} · {data.kind === 'platform' ? 'Platform admin' : 'Hotel access'}
		</p>

		{#if form?.error}<p class="{ui.alertErr} mb-4">{form.error}</p>{/if}

		<form method="POST" use:enhance class="space-y-4">
			<div>
				<label class={ui.label} for="name">Your name</label>
				<input class={ui.input} id="name" name="name" required />
			</div>
			<div>
				<label class={ui.label} for="password">Password</label>
				<input
					class={ui.input}
					id="password"
					name="password"
					type="password"
					autocomplete="new-password"
					required
				/>
			</div>
			<div>
				<label class={ui.label} for="confirm">Confirm password</label>
				<input
					class={ui.input}
					id="confirm"
					name="confirm"
					type="password"
					autocomplete="new-password"
					required
				/>
			</div>
			<button class="{ui.btn} {ui.btnPrimary} w-full" type="submit">Create account</button>
		</form>
	{/if}
</div>
