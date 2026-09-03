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
	<h1 class="mb-6 text-xl font-semibold tracking-tight text-ink">Sign in</h1>

	<form method="POST" use:enhance class="space-y-4">
		<input type="hidden" name="next" value={data.next} />
		<div>
			<Label for="email">Email</Label>
			<Input id="email" name="email" type="email" autocomplete="username" required class="mt-1" />
		</div>
		<div>
			<Label for="password">Password</Label>
			<Input
				id="password"
				name="password"
				type="password"
				autocomplete="current-password"
				required
				class="mt-1"
			/>
		</div>
		<Button type="submit" class="w-full">Sign in</Button>
	</form>
</div>
