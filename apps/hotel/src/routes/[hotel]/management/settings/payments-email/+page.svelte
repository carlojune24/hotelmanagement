<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}/management`);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form && 'ok' in form && form.ok) toast.success(form.ok);
	});

	let busy = $state<string | null>(null);
	let confirmingDisconnect = $state(false);
	let confirmingRemoveEmail = $state(false);

	/** Shared enhance: marks which action is running, resets confirmations afterwards. */
	const run = (name: string) => () => {
		busy = name;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			busy = null;
			confirmingDisconnect = false;
			confirmingRemoveEmail = false;
		};
	};

	const when = (iso: string) =>
		new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
</script>

<div class="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between gap-4">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Payments &amp; email</h1>
			<p class="text-sm text-ink-muted">
				Your own PayMongo account for online payment, and the mailbox guest email comes from.
			</p>
		</div>
		<Button variant="outline" href="{base}/settings">← Settings</Button>
	</div>

	<!-- PayMongo -->
	<section aria-labelledby="paymongo-heading" class="mb-6 rounded-xl border border-border p-5">
		<div class="mb-3 flex flex-wrap items-center gap-2">
			<h2 id="paymongo-heading" class="text-sm font-semibold text-ink">PayMongo</h2>
			{#if data.paymongo}
				{#if data.paymongo.mode === 'live'}
					<span class="rounded-full bg-ok/15 px-2 py-0.5 text-xs font-medium text-ok">Live</span>
				{:else}
					<span class="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-ink"
						>Test mode — no real money</span
					>
				{/if}
				{#if data.paymongo.status === 'webhook_error'}
					<span class="text-xs font-medium text-danger">Webhook needs attention</span>
				{:else}
					<span class="text-xs text-ink-muted">Connected {when(data.paymongo.connectedAt)}</span>
				{/if}
			{/if}
		</div>

		{#if data.paymongo}
			<dl class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
				<dt class="text-ink-muted">Secret key</dt>
				<dd class="font-mono text-ink">{data.paymongo.secretKeyHint}</dd>
				<dt class="text-ink-muted">Webhook</dt>
				<dd class="min-w-0 font-mono text-xs break-all text-ink">
					{data.paymongo.webhookUrl ?? '—'}
				</dd>
			</dl>
			{#if data.paymongo.lastError}
				<p class="mt-3 text-sm text-danger">{data.paymongo.lastError}</p>
			{/if}

			<div class="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
				<form method="POST" action="?/reconnectPaymongo" use:enhance={run('reconnect')}>
					<Button type="submit" variant="outline" size="sm" disabled={busy !== null}>
						{busy === 'reconnect' ? 'Reconnecting…' : 'Reconnect'}
					</Button>
				</form>
				{#if !confirmingDisconnect}
					<Button
						type="button"
						variant="outline"
						size="sm"
						class="text-danger"
						disabled={busy !== null}
						onclick={() => (confirmingDisconnect = true)}>Disconnect</Button
					>
				{:else}
					<form
						method="POST"
						action="?/disconnectPaymongo"
						use:enhance={run('disconnect')}
						class="flex flex-wrap items-center gap-2"
					>
						<span class="text-sm text-danger">Guests won't be able to book online.</span>
						<Button type="submit" variant="destructive" size="sm" disabled={busy !== null}>
							{busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect PayMongo'}
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onclick={() => (confirmingDisconnect = false)}>Keep it</Button
						>
					</form>
				{/if}
			</div>
			<p class="mt-2 text-xs text-ink-muted">
				Reconnect re-points PayMongo at this server — use it after the site's address changes. To
				switch between test and live, paste the other key below.
			</p>
		{:else}
			<p class="mb-3 text-sm text-ink-muted">
				Not connected — guests can't book online until you connect your hotel's PayMongo account.
				Front desk bookings aren't affected.
			</p>
		{/if}

		<form
			method="POST"
			action="?/connectPaymongo"
			use:enhance={run('connect')}
			class="mt-4 {data.paymongo ? 'border-t border-border pt-4' : ''}"
		>
			<Label for="secretKey">{data.paymongo ? 'Replace secret key' : 'Secret key'}</Label>
			<div class="mt-1 flex flex-col gap-2 sm:flex-row">
				<Input
					id="secretKey"
					name="secretKey"
					type="password"
					autocomplete="off"
					spellcheck="false"
					placeholder="sk_live_… or sk_test_…"
					required
					class="font-mono"
				/>
				<Button type="submit" disabled={busy !== null} class="shrink-0">
					{busy === 'connect' ? 'Connecting…' : data.paymongo ? 'Replace' : 'Connect'}
				</Button>
			</div>
			<p class="mt-2 text-xs text-ink-muted">
				From the PayMongo dashboard → Developers → API keys. Use the secret key (sk_…), not the
				public key. The webhook is set up for you, and the key is stored encrypted and never shown
				again.
			</p>
		</form>
	</section>

	<!-- Email -->
	<section aria-labelledby="email-heading" class="rounded-xl border border-border p-5">
		<div class="mb-1 flex flex-wrap items-center gap-2">
			<h2 id="email-heading" class="text-sm font-semibold text-ink">Email</h2>
			{#if data.email?.lastTestAt}
				{#if data.email.lastTestOk}
					<span class="text-xs text-ok">Test sent {when(data.email.lastTestAt)}</span>
				{:else}
					<span class="text-xs text-danger">Last test failed {when(data.email.lastTestAt)}</span>
				{/if}
			{/if}
		</div>
		<p class="mb-4 text-xs text-ink-muted">
			{#if data.email}
				Guest emails (confirmations, receipts, cancellations) go out from this mailbox.
			{:else if data.platformEmailConfigured}
				Not set — guest emails go out through the platform mailbox, sent under your hotel's name.
			{:else}
				Not set — and no platform mailbox is configured, so guest emails are not delivered yet.
			{/if}
		</p>

		<form method="POST" action="?/saveEmail" use:enhance={run('saveEmail')} class="space-y-3">
			<div class="grid grid-cols-[1fr_6rem] gap-3">
				<div>
					<Label for="host">SMTP host</Label>
					<Input
						id="host"
						name="host"
						value={data.email?.host ?? ''}
						placeholder="smtp.gmail.com"
						required
						class="mt-1"
					/>
				</div>
				<div>
					<Label for="port">Port</Label>
					<Input
						id="port"
						name="port"
						type="number"
						min="1"
						max="65535"
						value={data.email?.port ?? 587}
						required
						class="mt-1"
					/>
				</div>
			</div>
			<label class="flex items-center gap-2 text-sm text-ink">
				<input type="checkbox" name="secure" checked={data.email?.secure ?? false} class="size-4" />
				Use SSL/TLS from the start (usually port 465)
			</label>
			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<Label for="username">Username</Label>
					<Input
						id="username"
						name="username"
						autocomplete="off"
						value={data.email?.username ?? ''}
						class="mt-1"
					/>
				</div>
				<div>
					<Label for="password">Password</Label>
					<Input
						id="password"
						name="password"
						type="password"
						autocomplete="new-password"
						placeholder={data.email?.passwordHint
							? `Saved (${data.email.passwordHint}) — leave blank to keep`
							: ''}
						class="mt-1"
					/>
				</div>
			</div>
			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<Label for="fromName">From name</Label>
					<Input
						id="fromName"
						name="fromName"
						value={data.email?.fromName ?? ''}
						placeholder="Your hotel's name"
						class="mt-1"
					/>
				</div>
				<div>
					<Label for="fromAddress">From address</Label>
					<Input
						id="fromAddress"
						name="fromAddress"
						type="email"
						value={data.email?.fromAddress ?? ''}
						placeholder="reservations@yourhotel.com"
						required
						class="mt-1"
					/>
				</div>
			</div>
			<div>
				<Label for="replyTo">Reply-to (optional)</Label>
				<Input
					id="replyTo"
					name="replyTo"
					type="email"
					value={data.email?.replyTo ?? ''}
					placeholder="Where guest replies should go"
					class="mt-1"
				/>
			</div>
			<div class="flex justify-end">
				<Button type="submit" disabled={busy !== null}>
					{busy === 'saveEmail' ? 'Saving…' : 'Save email settings'}
				</Button>
			</div>
		</form>

		<div class="mt-4 border-t border-border pt-4">
			<form method="POST" action="?/sendTestEmail" use:enhance={run('test')}>
				<Label for="testTo">Send a test email to</Label>
				<div class="mt-1 flex flex-col gap-2 sm:flex-row">
					<Input id="testTo" name="to" type="email" value={data.userEmail} required />
					<Button type="submit" variant="outline" disabled={busy !== null} class="shrink-0">
						{busy === 'test' ? 'Sending…' : 'Send test'}
					</Button>
				</div>
			</form>
			{#if data.email?.lastTestOk === false && data.email.lastTestError}
				<p class="mt-2 text-xs break-words text-danger">{data.email.lastTestError}</p>
			{/if}
		</div>

		{#if data.email}
			<div class="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
				{#if !confirmingRemoveEmail}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="text-danger"
						onclick={() => (confirmingRemoveEmail = true)}>Remove this mailbox</Button
					>
				{:else}
					<form
						method="POST"
						action="?/clearEmail"
						use:enhance={run('clearEmail')}
						class="flex flex-wrap items-center gap-2"
					>
						<span class="text-sm text-ink-muted">Email will fall back to the platform mailbox.</span
						>
						<Button type="submit" variant="destructive" size="sm" disabled={busy !== null}
							>Remove</Button
						>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onclick={() => (confirmingRemoveEmail = false)}>Keep it</Button
						>
					</form>
				{/if}
			</div>
		{/if}
	</section>
</div>
