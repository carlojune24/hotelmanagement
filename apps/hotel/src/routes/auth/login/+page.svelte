<script lang="ts">
	import { enhance } from '$app/forms';
	import { ui } from '$lib/components/ui';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<div class="mx-auto flex min-h-full max-w-sm flex-col justify-center px-4 py-16">
	<h1 class="{ui.h1} mb-6">Sign in</h1>

	{#if form?.error}
		<p class="{ui.alertErr} mb-4">{form.error}</p>
	{/if}

	<form method="POST" use:enhance class="space-y-4">
		<input type="hidden" name="next" value={data.next} />
		<div>
			<label class={ui.label} for="email">Email</label>
			<input class={ui.input} id="email" name="email" type="email" autocomplete="username" required />
		</div>
		<div>
			<label class={ui.label} for="password">Password</label>
			<input
				class={ui.input}
				id="password"
				name="password"
				type="password"
				autocomplete="current-password"
				required
			/>
		</div>
		<button class="{ui.btn} {ui.btnPrimary} w-full" type="submit">Sign in</button>
	</form>
</div>
