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
		if (form?.ok) toast.success(form.ok);
	});

	const when = (d: Date | string | null) =>
		d ? new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'never';
</script>

<div class="mx-auto w-full max-w-2xl space-y-6 px-4 py-8 sm:px-6">
	<div>
		<h1 class="text-xl font-semibold tracking-tight text-ink">HR connection</h1>
		<p class="mt-1 text-sm text-ink-muted">
			Staff logins can be created from the company HR app's employee records, and follow HR when
			someone leaves or moves. Nothing else in this hotel depends on HR — if it is unreachable, Team
			just loses its employee picker.
		</p>
	</div>

	{#if data.connection}
		<section class="rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
			<dl class="grid gap-3 text-sm sm:grid-cols-2">
				<div>
					<dt class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Connected as</dt>
					<dd class="mt-0.5 font-medium">{data.connection.establishmentName ?? '—'}</dd>
				</div>
				<div>
					<dt class="text-xs font-semibold uppercase tracking-wide text-ink-muted">HR app</dt>
					<dd class="mt-0.5 font-mono text-xs break-all">{data.connection.baseUrl}</dd>
				</div>
				<div>
					<dt class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Key</dt>
					<dd class="mt-0.5 font-mono text-xs">{data.connection.keyHint}</dd>
				</div>
				<div>
					<dt class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Last contact</dt>
					<dd class="mt-0.5">{when(data.connection.lastSyncAt)}</dd>
				</div>
			</dl>
			{#if data.connection.lastError}
				<p class="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-sm">
					Last attempt failed: {data.connection.lastError} — staff access was left unchanged.
				</p>
			{/if}
			<div class="mt-4 flex flex-wrap gap-2">
				<form method="POST" action="?/syncNow" use:enhance>
					<Button type="submit" variant="outline">Check linked staff now</Button>
				</form>
				<form method="POST" action="?/disconnect" use:enhance>
					<Button type="submit" variant="ghost">Disconnect</Button>
				</form>
			</div>
		</section>
	{/if}

	<section class="rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">
			{data.connection ? 'Replace the key' : 'Connect'}
		</h2>
		<form method="POST" action="?/connect" use:enhance class="mt-3 space-y-3">
			<div>
				<Label for="baseUrl">HR app address</Label>
				<Input
					id="baseUrl"
					name="baseUrl"
					required
					placeholder="https://hr.yourcompany.com"
					class="mt-1"
					value={data.connection?.baseUrl ?? ''}
				/>
			</div>
			<div>
				<Label for="apiKey">Key from Main HR</Label>
				<Input
					id="apiKey"
					name="apiKey"
					type="password"
					autocomplete="off"
					required
					placeholder="mmhr_live_…"
					class="mt-1 font-mono"
				/>
				<p class="mt-1 text-xs text-ink-muted">
					Main HR issues it under this hotel's Settings in the HR app. It is stored encrypted and
					never shown again.
				</p>
			</div>
			<Button type="submit">{data.connection ? 'Save new key' : 'Connect'}</Button>
		</form>
	</section>
</div>
