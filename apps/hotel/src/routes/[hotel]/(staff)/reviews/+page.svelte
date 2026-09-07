<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import StarIcon from '@lucide/svelte/icons/star';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}`);

	let activeTab = $state<'pending' | 'approved' | 'rejected'>('pending');
	const tabs = ['pending', 'approved', 'rejected'] as const;

	const grouped = $derived({
		pending: data.reviews.filter((r) => r.status === 'pending'),
		approved: data.reviews.filter((r) => r.status === 'approved'),
		rejected: data.reviews.filter((r) => r.status === 'rejected')
	});

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});
</script>

<div class="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Reviews</h1>
			<p class="text-sm text-ink-muted">
				Real guest reviews, tied to a completed stay — approve the ones you want live.
			</p>
		</div>
		<Button variant="outline" href="{base}/dashboard">← Dashboard</Button>
	</div>

	<Tabs.Root bind:value={activeTab}>
		<Tabs.List>
			<Tabs.Trigger value="pending">Pending ({grouped.pending.length})</Tabs.Trigger>
			<Tabs.Trigger value="approved">Approved ({grouped.approved.length})</Tabs.Trigger>
			<Tabs.Trigger value="rejected">Rejected ({grouped.rejected.length})</Tabs.Trigger>
		</Tabs.List>

		{#each tabs as tab (tab)}
			<Tabs.Content value={tab} class="mt-4 space-y-3">
				{#if grouped[tab].length === 0}
					<p class="rounded-xl border border-border bg-surface p-6 text-center text-sm text-ink-muted">
						No {tab} reviews.
					</p>
				{:else}
					{#each grouped[tab] as r (r.id)}
						<div class="rounded-xl border border-border bg-surface p-4 shadow-sm">
							<div class="flex items-start justify-between gap-4">
								<div class="min-w-0">
									<div class="flex items-center gap-1">
										{#each Array(5) as _, i (i)}
											<StarIcon
												class="size-3.5 {i < r.rating
													? 'fill-current text-brand'
													: 'text-ink-muted'}"
											/>
										{/each}
									</div>
									<div class="mt-1 font-medium text-ink">{r.guestDisplayName}</div>
									<div class="text-xs text-ink-muted">
										{r.roomTypeName} · {r.checkIn} → {r.checkOut}
									</div>
									<p class="mt-2 text-sm text-ink">{r.comment}</p>
									{#if r.moderationNote}
										<p class="mt-1 text-xs text-ink-muted">Note: {r.moderationNote}</p>
									{/if}
								</div>
								<Badge
									variant="outline"
									class={r.status === 'approved'
										? 'border-transparent bg-ok/15 text-ok'
										: r.status === 'rejected'
											? 'border-transparent bg-danger/15 text-danger'
											: 'border-border bg-surface-2 text-ink-muted'}
								>
									{r.status}
								</Badge>
							</div>
							{#if r.status === 'pending'}
								<div class="mt-3 flex items-center gap-2">
									<form method="POST" action="?/approve" use:enhance>
										<input type="hidden" name="id" value={r.id} />
										<Button type="submit" size="sm">
											<CircleCheckIcon class="size-4" /> Approve
										</Button>
									</form>
									<form method="POST" action="?/reject" use:enhance>
										<input type="hidden" name="id" value={r.id} />
										<Button type="submit" variant="outline" size="sm">
											<CircleXIcon class="size-4" /> Reject
										</Button>
									</form>
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</Tabs.Content>
		{/each}
	</Tabs.Root>
</div>
