<script lang="ts">
	import { applyAction, deserialize } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';

	let {
		open = $bindable(false),
		order,
		canWrite,
		timezone
	}: {
		open: boolean;
		order: { id: string; code: string; guestName: string | null; guestPhone: string | null } | null;
		canWrite: boolean;
		timezone: string;
	} = $props();

	interface Msg {
		id: string;
		direction: string;
		body: string;
		createdAt: string;
	}
	let messages = $state<Msg[]>([]);
	let loading = $state(false);
	let draft = $state('');
	let sending = $state(false);

	const stamp = (iso: string) =>
		new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(iso));

	async function call(action: string, fields: Record<string, string>) {
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.set(k, v);
		const res = await fetch(`?/${action}`, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
		return deserialize(await res.text());
	}

	async function load() {
		if (!order) return;
		loading = true;
		const result = await call('openThread', { orderId: order.id });
		loading = false;
		if (result.type === 'success' && result.data?.thread) {
			messages = (result.data.thread as { messages: Msg[] }).messages;
			// Opening the thread marks the guest's messages read, so refresh the board's badges.
			await invalidate('app:dining-orders');
		} else {
			await applyAction(result);
		}
	}

	$effect(() => {
		if (open && order) {
			draft = '';
			messages = [];
			void load();
		}
	});

	async function send(e: SubmitEvent) {
		e.preventDefault();
		if (!order || !draft.trim()) return;
		sending = true;
		const result = await call('reply', { orderId: order.id, body: draft });
		sending = false;
		if (result.type === 'success') {
			draft = '';
			await load();
		} else if (result.type === 'failure') {
			toast.error((result.data as { error?: string })?.error ?? 'The message could not be sent.');
		}
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="right" class="flex w-full flex-col gap-0 p-0 sm:max-w-md">
		<Sheet.Header class="border-b border-border px-5 py-4">
			<Sheet.Title>Messages{order ? `: ${order.code}` : ''}</Sheet.Title>
			<Sheet.Description>
				{order?.guestName ?? 'Guest'}{order?.guestPhone ? ` · ${order.guestPhone}` : ''}. Replies appear on the guest's order page.
			</Sheet.Description>
		</Sheet.Header>

		<div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4" aria-live="polite">
			{#if loading && messages.length === 0}
				<p class="text-sm text-ink-muted">Loading…</p>
			{:else if messages.length === 0}
				<p class="text-sm text-ink-muted">No messages yet.</p>
			{:else}
				{#each messages as m (m.id)}
					<div class="flex {m.direction === 'staff' ? 'justify-end' : 'justify-start'}">
						<div class="max-w-[85%] rounded-lg px-3 py-2 text-sm {m.direction === 'staff' ? 'bg-brand/10 text-ink' : 'bg-surface-2 text-ink'}">
							<p class="whitespace-pre-line">{m.body}</p>
							<p class="mt-1 text-[11px] text-ink-muted">{m.direction === 'staff' ? 'You' : 'Guest'} · {stamp(m.createdAt)}</p>
						</div>
					</div>
				{/each}
			{/if}
		</div>

		{#if canWrite}
			<form class="space-y-2 border-t border-border px-5 py-4" onsubmit={send}>
				<Textarea bind:value={draft} rows={2} maxlength={1000} placeholder="Reply to the guest" aria-label="Reply to the guest" class="min-h-0" />
				<div class="flex justify-end">
					<Button type="submit" disabled={sending || !draft.trim()}>{sending ? 'Sending…' : 'Send reply'}</Button>
				</div>
			</form>
		{/if}
	</Sheet.Content>
</Sheet.Root>
