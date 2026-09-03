<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	$effect(() => {
		if (form?.error) toast.error(form.error);
	});
</script>

<div class="mx-auto flex min-h-full max-w-sm flex-col justify-center px-4 py-16">
	{#if !data.valid}
		<h1 class="mb-2 text-xl font-semibold tracking-tight text-ink">Invite unavailable</h1>
		<p class="text-sm text-ink-muted">This invite link is invalid or has expired.</p>
		<Button variant="outline" href="/auth/login" class="mt-4">Go to sign in</Button>
	{:else}
		<h1 class="mb-1 text-xl font-semibold tracking-tight text-ink">Set up your account</h1>
		<p class="mb-6 text-sm text-ink-muted">
			{data.email} · {data.kind === 'platform' ? 'Platform admin' : 'Hotel access'}
		</p>

		<form method="POST" use:enhance class="space-y-4">
			<div>
				<Label for="name">Your name</Label>
				<Input id="name" name="name" required class="mt-1" />
			</div>
			<div>
				<Label for="password">Password</Label>
				<Input
					id="password"
					name="password"
					type="password"
					autocomplete="new-password"
					required
					class="mt-1"
				/>
			</div>
			<div>
				<Label for="confirm">Confirm password</Label>
				<Input
					id="confirm"
					name="confirm"
					type="password"
					autocomplete="new-password"
					required
					class="mt-1"
				/>
			</div>
			<Button type="submit" class="w-full">Create account</Button>
		</form>
	{/if}
</div>
