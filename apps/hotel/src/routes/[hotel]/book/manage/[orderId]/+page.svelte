<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Poll for staff replies — this page has no push channel, and a guest may
	// sit on it waiting for a reply without ever submitting a form themselves.
	// Paused while the tab isn't visible so an idle background tab doesn't
	// keep hitting the server.
	$effect(() => {
		const POLL_MS = 15_000;
		let timer: ReturnType<typeof setInterval> | undefined;

		function start() {
			if (timer) return;
			timer = setInterval(() => invalidate('app:guest-messages'), POLL_MS);
		}
		function stop() {
			clearInterval(timer);
			timer = undefined;
		}
		function onVisibilityChange() {
			if (document.hidden) stop();
			else start();
		}

		start();
		document.addEventListener('visibilitychange', onVisibilityChange);
		return () => {
			stop();
			document.removeEventListener('visibilitychange', onVisibilityChange);
		};
	});

	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const statusLabel = (s: string) => s.replace(/_/g, ' ');
	const fmtDateTime = (v: string | Date) =>
		new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

	// Which line's "request cancellation" reason field is expanded.
	let openFormFor = $state<string | null>(null);
	let sending = $state(false);

	type Line = (typeof data.roomLines)[number] | (typeof data.hallLines)[number];

	function requestStatusLabel(line: Line): string | null {
		if (!line.openRequest) return null;
		return 'Cancellation requested — awaiting the hotel';
	}
</script>

<div class="mx-auto max-w-2xl px-4 py-10 sm:px-6">
	<h1 class="ledger-display text-2xl">Manage your booking</h1>
	<p class="mt-1 text-sm text-[var(--ledger-ink-muted)]">
		{data.guestName} · Confirmation <span class="ledger-data">{data.order.confirmationCode}</span>
	</p>

	<!-- Booking lines -->
	<div class="mt-8">
		{#each data.roomLines as r (r.id)}
			<div class="ledger-hairline py-4">
				<div class="flex items-start justify-between gap-4">
					<div>
						<div class="ledger-display text-lg">{r.roomTypeName}{r.quantity > 1 ? ` × ${r.quantity}` : ''}</div>
						<p class="text-sm text-[var(--ledger-ink-muted)]">{r.ratePlanName}</p>
						<p class="ledger-data mt-1 text-sm">{r.checkIn} → {r.checkOut}</p>
					</div>
					<div class="text-right">
						<div class="ledger-label">{statusLabel(r.status)}</div>
						{#if data.order.status === 'confirmed'}
							<div class="ledger-data mt-1 text-sm">{peso(r.totalCentavos)}</div>
						{/if}
					</div>
				</div>

				{#if requestStatusLabel(r)}
					<p class="mt-3 text-sm text-[var(--ledger-ink-muted)]">{requestStatusLabel(r)}</p>
				{:else if r.cancellable}
					{#if openFormFor === r.id}
						<form
							method="POST"
							action="?/requestCancellation"
							use:enhance={() => {
								sending = true;
								return async ({ update }) => {
									await update();
									sending = false;
									openFormFor = null;
								};
							}}
							class="mt-3 space-y-2"
						>
							<input type="hidden" name="t" value={data.order.accessToken} />
							<input type="hidden" name="kind" value="room" />
							<input type="hidden" name="id" value={r.id} />
							<textarea
								name="reason"
								rows="2"
								required
								maxlength={2000}
								placeholder="Why would you like to cancel this booking?"
								class="ledger-field w-full"
							></textarea>
							<div class="flex items-center gap-2">
								<Button type="submit" size="sm" variant="destructive" disabled={sending}>
									{sending ? 'Sending…' : 'Send request'}
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onclick={() => (openFormFor = null)}
								>
									Never mind
								</Button>
							</div>
						</form>
					{:else}
						<button
							type="button"
							class="ledger-btn-ghost mt-3 text-sm"
							onclick={() => (openFormFor = r.id)}
						>
							Request cancellation
						</button>
					{/if}
				{/if}
			</div>
		{/each}

		{#each data.hallLines as h (h.id)}
			<div class="ledger-hairline py-4">
				<div class="flex items-start justify-between gap-4">
					<div>
						<div class="ledger-display text-lg">{h.hallName}</div>
						<p class="text-sm text-[var(--ledger-ink-muted)]">{h.eventType}</p>
						<p class="ledger-data mt-1 text-sm">
							{h.eventDate} · {h.startTime.slice(0, 5)}–{h.endTime.slice(0, 5)}
						</p>
					</div>
					<div class="text-right">
						<div class="ledger-label">{statusLabel(h.status)}</div>
						{#if data.order.status === 'confirmed'}
							<div class="ledger-data mt-1 text-sm">{peso(h.totalCentavos)}</div>
						{/if}
					</div>
				</div>

				{#if requestStatusLabel(h)}
					<p class="mt-3 text-sm text-[var(--ledger-ink-muted)]">{requestStatusLabel(h)}</p>
				{:else if h.cancellable}
					{#if openFormFor === h.id}
						<form
							method="POST"
							action="?/requestCancellation"
							use:enhance={() => {
								sending = true;
								return async ({ update }) => {
									await update();
									sending = false;
									openFormFor = null;
								};
							}}
							class="mt-3 space-y-2"
						>
							<input type="hidden" name="t" value={data.order.accessToken} />
							<input type="hidden" name="kind" value="hall" />
							<input type="hidden" name="id" value={h.id} />
							<textarea
								name="reason"
								rows="2"
								required
								maxlength={2000}
								placeholder="Why would you like to cancel this event?"
								class="ledger-field w-full"
							></textarea>
							<div class="flex items-center gap-2">
								<Button type="submit" size="sm" variant="destructive" disabled={sending}>
									{sending ? 'Sending…' : 'Send request'}
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onclick={() => (openFormFor = null)}
								>
									Never mind
								</Button>
							</div>
						</form>
					{:else}
						<button
							type="button"
							class="ledger-btn-ghost mt-3 text-sm"
							onclick={() => (openFormFor = h.id)}
						>
							Request cancellation
						</button>
					{/if}
				{/if}
			</div>
		{/each}
	</div>

	{#if form?.error}
		<p class="mt-4 text-sm" style="color: var(--ledger-danger, #b91c1c);">{form.error}</p>
	{/if}
	{#if form?.ok}
		<p class="mt-4 text-sm text-[var(--ledger-ink)]">{form.ok}</p>
	{/if}

	<!-- Conversation -->
	<div class="mt-10 border-t border-[var(--ledger-rule)] pt-8">
		<h2 class="ledger-display text-lg">Messages</h2>
		<p class="mt-1 text-sm text-[var(--ledger-ink-muted)]">
			Have a question, or need to change something? Send a message and the hotel will reply here.
		</p>

		{#if data.thread.length > 0}
			<div class="mt-5 space-y-4">
				{#each data.thread as m (m.id)}
					<div>
						<div class="flex items-baseline justify-between gap-3">
							<span class="ledger-label">
								{m.direction === 'guest' ? 'You' : (m.staffName ?? 'The hotel')}
								{#if m.kind === 'cancellation_request'}
									· cancellation request{m.lineLabel ? ` — ${m.lineLabel}` : ''}
									{#if m.status === 'declined'}
										<span style="color: var(--ledger-danger, #b91c1c);">· declined</span>
									{:else if m.status === 'actioned'}
										<span>· cancelled</span>
									{:else}
										<span>· pending</span>
									{/if}
								{/if}
							</span>
							<span class="ledger-data text-xs text-[var(--ledger-ink-muted)]">
								{fmtDateTime(m.createdAt)}
							</span>
						</div>
						<p class="mt-1 text-sm whitespace-pre-wrap text-[var(--ledger-ink)]">{m.body}</p>
					</div>
				{/each}
			</div>
		{/if}

		<form
			method="POST"
			action="?/sendMessage"
			use:enhance={() => {
				sending = true;
				return async ({ update }) => {
					await update();
					sending = false;
				};
			}}
			class="mt-6 space-y-2"
		>
			<input type="hidden" name="t" value={data.order.accessToken} />
			<textarea
				name="body"
				rows="3"
				required
				maxlength={2000}
				placeholder="Ask the hotel anything…"
				class="ledger-field w-full"
			></textarea>
			<Button type="submit" class="ledger-btn-primary" disabled={sending}>
				{sending ? 'Sending…' : 'Send message'}
			</Button>
		</form>
	</div>
</div>
