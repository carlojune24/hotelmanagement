<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import SearchIcon from '@lucide/svelte/icons/search';
	import MailIcon from '@lucide/svelte/icons/mail';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}`);

	let search = $state('');
	let statusFilter = $state<'all' | 'sent' | 'failed'>('all');
	let resendingId = $state<string | null>(null);

	const fmtDateTime = (v: string | Date) =>
		new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

	// Every transactional email the app can send. Keep in sync with the `email_type`
	// enum (src/lib/server/db/schema/email-log.ts).
	const TYPE_LABELS: Record<string, string> = {
		booking_confirmation: 'Booking confirmation'
	};
	const typeLabel = (t: string) => TYPE_LABELS[t] ?? t.replace(/_/g, ' ');

	function statusClass(status: string): string {
		if (status === 'sent') return 'border-transparent bg-ok/15 text-ok';
		if (status === 'failed') return 'border-transparent bg-danger/15 text-danger';
		return 'border-border bg-surface-2 text-ink-muted';
	}

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});

	const filtered = $derived(
		data.emails.filter((m) => {
			if (statusFilter !== 'all' && m.status !== statusFilter) return false;
			if (search.trim()) {
				const q = search.trim().toLowerCase();
				const hay = `${m.guestName ?? ''} ${m.toAddress} ${m.subject}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		})
	);
</script>

<div class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Emails</h1>
			<p class="text-sm text-ink-muted">
				Every confirmation sent to a guest, and whether it went through. Resend from here or open
				the booking it belongs to.
			</p>
		</div>
		<Button variant="outline" href="{base}/dashboard">← Dashboard</Button>
	</div>

	<div class="mb-4 flex flex-wrap items-center gap-3">
		<div class="relative min-w-48 flex-1">
			<SearchIcon class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
			<Input placeholder="Search guest, address or subject…" bind:value={search} class="pl-8" />
		</div>
		<Select.Root type="single" bind:value={statusFilter}>
			<Select.Trigger class="w-40 shrink-0">
				{statusFilter === 'all' ? 'All statuses' : statusFilter === 'sent' ? 'Sent' : 'Failed'}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="All statuses" />
				<Select.Item value="sent" label="Sent" />
				<Select.Item value="failed" label="Failed" />
			</Select.Content>
		</Select.Root>
	</div>

	<div class="overflow-hidden rounded-xl border border-border">
		{#if filtered.length === 0}
			<div class="flex flex-col items-center gap-2 p-10 text-center">
				<MailIcon class="size-6 text-ink-muted" />
				<p class="text-sm text-ink-muted">
					{data.emails.length === 0
						? 'No emails sent yet. A confirmation goes out automatically when a guest pays.'
						: 'No emails match these filters.'}
				</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Status</Table.Head>
						<Table.Head>Guest</Table.Head>
						<Table.Head>Email</Table.Head>
						<Table.Head>Sent</Table.Head>
						<Table.Head class="text-right">Actions</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each filtered as m (m.id)}
						<Table.Row>
							<Table.Cell class="align-top">
								<Badge variant="outline" class={statusClass(m.status)}>{m.status}</Badge>
							</Table.Cell>
							<Table.Cell class="align-top">
								<div class="font-medium text-ink">{m.guestName ?? '—'}</div>
								<div class="text-xs break-all text-ink-muted">{m.toAddress}</div>
							</Table.Cell>
							<Table.Cell class="align-top">
								<div class="text-xs font-medium tracking-wide text-ink-muted uppercase">
									{typeLabel(m.type)}
								</div>
								<div class="text-ink">{m.subject}</div>
								{#if m.status === 'failed' && m.error}
									<div class="mt-0.5 text-xs text-danger">{m.error}</div>
								{/if}
							</Table.Cell>
							<Table.Cell class="align-top text-xs whitespace-nowrap text-ink-muted">
								{fmtDateTime(m.createdAt)}
							</Table.Cell>
							<Table.Cell class="align-top">
								<div class="flex items-center justify-end gap-1.5">
									{#if m.bookingKind && m.bookingId}
										<Button
											variant="ghost"
											size="sm"
											href="{base}/reservations/{m.bookingKind}/{m.bookingId}"
										>
											Booking <ArrowRightIcon class="ml-1 size-3.5" />
										</Button>
									{/if}
									{#if m.orderId && m.orderStatus === 'confirmed'}
										<form
											method="POST"
											action="?/resend"
											use:enhance={() => {
												resendingId = m.id;
												return async ({ update }) => {
													await update();
													resendingId = null;
												};
											}}
										>
											<input type="hidden" name="orderId" value={m.orderId} />
											<Button
												type="submit"
												variant="outline"
												size="sm"
												disabled={resendingId === m.id}
											>
												{resendingId === m.id ? 'Sending…' : 'Resend'}
											</Button>
										</form>
									{/if}
								</div>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>
</div>
