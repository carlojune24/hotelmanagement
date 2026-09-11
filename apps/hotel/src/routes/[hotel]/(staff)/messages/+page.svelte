<script lang="ts">
	import { page } from '$app/state';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const base = $derived(`/${page.params.hotel}`);

	let filter = $state<'all' | 'unread' | 'open'>('all');

	const fmtDateTime = (v: string | Date) =>
		new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

	function kindLabel(k: string) {
		return k === 'cancellation_request' ? 'Cancellation request' : 'Message';
	}

	function statusClass(status: string | null): string {
		if (status === 'declined') return 'border-transparent bg-danger/15 text-danger';
		if (status === 'actioned') return 'border-transparent bg-ok/15 text-ok';
		if (status === 'open') return 'border-border bg-surface-2 text-ink-muted';
		return 'border-border bg-surface-2 text-ink-muted';
	}

	const filtered = $derived(
		data.messages.filter((m) => {
			if (filter === 'unread' && m.isRead) return false;
			if (filter === 'open' && m.status !== 'open') return false;
			return true;
		})
	);

	const unreadCount = $derived(data.messages.filter((m) => !m.isRead).length);
</script>

<div class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Messages</h1>
			<p class="text-sm text-ink-muted">
				Questions and cancellation requests guests send from their booking page. Open a booking to
				reply.
			</p>
		</div>
		<Button variant="outline" href="{base}/dashboard">← Dashboard</Button>
	</div>

	<div class="mb-4 flex flex-wrap items-center gap-3">
		<Select.Root type="single" bind:value={filter}>
			<Select.Trigger class="w-44 shrink-0">
				{filter === 'all' ? 'All messages' : filter === 'unread' ? 'Unread' : 'Open requests'}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="All messages" />
				<Select.Item value="unread" label={`Unread${unreadCount > 0 ? ` (${unreadCount})` : ''}`} />
				<Select.Item value="open" label="Open requests" />
			</Select.Content>
		</Select.Root>
	</div>

	<div class="overflow-hidden rounded-xl border border-border">
		{#if filtered.length === 0}
			<div class="flex flex-col items-center gap-2 p-10 text-center">
				<MessageSquareIcon class="size-6 text-ink-muted" />
				<p class="text-sm text-ink-muted">
					{data.messages.length === 0
						? 'No guest messages yet — they show up here as soon as a guest writes from their booking page.'
						: 'No messages match this filter.'}
				</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Type</Table.Head>
						<Table.Head>Guest</Table.Head>
						<Table.Head>Message</Table.Head>
						<Table.Head>Received</Table.Head>
						<Table.Head class="text-right">Actions</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each filtered as m (m.id)}
						{@const isOpenCancellation = m.kind === 'cancellation_request' && m.status === 'open'}
						<Table.Row
							class={isOpenCancellation
								? 'border-l-2 border-l-danger bg-danger/5 hover:bg-danger/10'
								: m.isRead
									? ''
									: 'bg-surface-2/50'}
						>
							<Table.Cell class="align-top">
								<Badge variant="outline" class={statusClass(m.status)}>{kindLabel(m.kind)}</Badge>
								{#if !m.isRead}
									<div class="mt-1 text-xs font-medium text-brand">Unread</div>
								{/if}
							</Table.Cell>
							<Table.Cell class="align-top font-medium text-ink">{m.guestName}</Table.Cell>
							<Table.Cell class="align-top">
								<p class="line-clamp-2 max-w-md text-ink">{m.body}</p>
							</Table.Cell>
							<Table.Cell class="align-top text-xs whitespace-nowrap text-ink-muted">
								{fmtDateTime(m.createdAt)}
							</Table.Cell>
							<Table.Cell class="align-top">
								{#if m.bookingKind && m.bookingId}
									<Button variant="ghost" size="sm" href="{base}/reservations/{m.bookingKind}/{m.bookingId}">
										Open <ArrowRightIcon class="ml-1 size-3.5" />
									</Button>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>
</div>
