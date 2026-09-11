<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import StarIcon from '@lucide/svelte/icons/star';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let rating = $state(5);
</script>

<div class="mx-auto max-w-2xl px-4 py-10 sm:px-6">
	<h1 class="ledger-display text-2xl">Your stay</h1>
	<p class="mt-1 text-sm text-[var(--ledger-ink-muted)]">
		{data.roomTypeName} · {data.checkIn} → {data.checkOut}
	</p>

	{#if !data.stayComplete}
		<p class="mt-6 max-w-md text-sm text-[var(--ledger-ink-muted)]">
			This stay isn't complete yet — you'll be able to leave a review once you've checked out.
		</p>
	{:else if data.existingReview}
		<div class="mt-6">
			<div class="flex items-center gap-1">
				{#each Array(5) as _, i (i)}
					<StarIcon
						class="size-4 {i < data.existingReview.rating
							? 'fill-current text-[var(--hotel-accent)]'
							: 'text-[var(--ledger-rule)]'}"
					/>
				{/each}
			</div>
			<p class="mt-2 max-w-md text-sm text-[var(--ledger-ink)]">{data.existingReview.comment}</p>
			<p class="mt-3 text-xs text-[var(--ledger-ink-muted)]">
				{#if data.existingReview.status === 'pending'}
					Thanks — your review is waiting on the hotel to take a look before it goes live.
				{:else if data.existingReview.status === 'approved'}
					Your review is live on the hotel's page.
				{:else}
					The hotel didn't publish this review{data.existingReview.moderationNote
						? `: ${data.existingReview.moderationNote}`
						: '.'}
				{/if}
			</p>
		</div>
	{:else}
		{#if form?.ok}
			<p class="mt-6 max-w-md text-sm text-[var(--ledger-ink)]">{form.ok}</p>
		{:else}
			<form method="POST" action="?/submit" use:enhance class="mt-6 space-y-5">
				<input type="hidden" name="t" value={data.accessToken} />
				<div>
					<span class="ledger-label">Rating</span>
					<div class="mt-2 flex items-center gap-1">
						{#each Array(5) as _, i (i)}
							{@const value = i + 1}
							<button
								type="button"
								aria-label="{value} star{value === 1 ? '' : 's'}"
								onclick={() => (rating = value)}
							>
								<StarIcon
									class="size-6 {value <= rating
										? 'fill-current text-[var(--hotel-accent)]'
										: 'text-[var(--ledger-rule)]'}"
								/>
							</button>
						{/each}
					</div>
					<input type="hidden" name="rating" value={rating} />
				</div>
				<div>
					<Label for="guestDisplayName" class="ledger-label">Name</Label>
					<Input
						id="guestDisplayName"
						name="guestDisplayName"
						required
						maxlength={120}
						value={data.guestFullName}
						class="ledger-field mt-1"
					/>
					<p class="mt-1 text-xs text-[var(--ledger-ink-muted)]">
						Shown alongside your review — edit it if you'd rather not use your full name.
					</p>
				</div>
				<div>
					<Label for="comment" class="ledger-label">Your review</Label>
					<textarea
						id="comment"
						name="comment"
						rows="5"
						required
						minlength={10}
						maxlength={2000}
						placeholder="What stood out about your stay?"
						class="ledger-field mt-1"
					></textarea>
				</div>

				{#if form?.error}
					<p class="text-sm" style="color: var(--ledger-danger, #b91c1c);">{form.error}</p>
				{/if}

				<Button type="submit" class="ledger-btn-primary">Submit review</Button>
			</form>
		{/if}
	{/if}
</div>
