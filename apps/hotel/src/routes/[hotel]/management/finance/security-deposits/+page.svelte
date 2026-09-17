<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	$effect(() => {
		if (form && 'ok' in form && form.ok) {
			toast.success(form.ok);
			voidingId = null;
		}
		if (form && 'error' in form && form.error) toast.error(form.error);
	});
	let voidingId = $state<string | null>(null);

	const statusClass: Record<string, string> = {
		held: 'border-transparent bg-brand/15 text-brand',
		settled: 'border-transparent bg-ok/15 text-ok',
		voided: 'border-border bg-surface-2 text-ink-muted'
	};
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
	<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Security deposits</h1>
			<p class="text-sm text-ink-muted">
				Every refundable room-damage hold — held, settled (refunded/forfeited), or voided.
			</p>
		</div>
		<div class="flex gap-1 text-sm">
			<a href="?show=all" class="rounded-md px-3 py-1.5 {data.show === 'all' ? 'bg-surface-2 text-ink' : 'text-ink-muted'}">All</a>
			<a href="?show=held" class="rounded-md px-3 py-1.5 {data.show === 'held' ? 'bg-surface-2 text-ink' : 'text-ink-muted'}">Held</a>
			<a href="?show=settled" class="rounded-md px-3 py-1.5 {data.show === 'settled' ? 'bg-surface-2 text-ink' : 'text-ink-muted'}">Settled</a>
			<a href="?show=voided" class="rounded-md px-3 py-1.5 {data.show === 'voided' ? 'bg-surface-2 text-ink' : 'text-ink-muted'}">Voided</a>
		</div>
	</div>

	<div class="overflow-x-auto rounded-xl border border-border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Collected</Table.Head>
					<Table.Head>Guest / Room</Table.Head>
					<Table.Head class="text-right">Held</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head class="text-right">Forfeited / Refunded</Table.Head>
					<Table.Head></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.rows as r (r.id)}
					<Table.Row>
						<Table.Cell class="whitespace-nowrap text-ink-muted">
							{new Date(r.collectedAt).toISOString().slice(0, 10)}
						</Table.Cell>
						<Table.Cell class="text-ink">
							{r.guestName ?? '—'}
							{#if r.roomTypeName}
								<span class="block text-xs text-ink-muted">
									{r.roomTypeName} · {r.checkIn} → {r.checkOut}
								</span>
							{/if}
						</Table.Cell>
						<Table.Cell class="text-right tabular-nums text-ink">{peso(r.amountCentavos)}</Table.Cell>
						<Table.Cell><Badge variant="outline" class={statusClass[r.status]}>{r.status}</Badge></Table.Cell>
						<Table.Cell class="text-right tabular-nums text-ink-muted">
							{#if r.status === 'settled'}
								{#if r.forfeitedCentavos}<span class="text-danger">−{peso(r.forfeitedCentavos)}</span>{/if}
								{#if r.forfeitedCentavos && r.refundedCentavos}<br />{/if}
								{#if r.refundedCentavos}<span>{peso(r.refundedCentavos)} refunded</span>{/if}
							{:else}
								—
							{/if}
						</Table.Cell>
						<Table.Cell class="text-right whitespace-nowrap">
							{#if r.bookingId}
								<a
									href="/{page.params.hotel}/management/reservations/room/{r.bookingId}"
									class="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
								>
									View booking
								</a>
							{/if}
							{#if r.status === 'held'}
								<button
									type="button"
									onclick={() => (voidingId = voidingId === r.id ? null : r.id)}
									class="ml-2 text-xs text-ink-muted underline underline-offset-2 hover:text-danger"
								>
									Void
								</button>
							{/if}
						</Table.Cell>
					</Table.Row>
					{#if voidingId === r.id}
						<Table.Row>
							<Table.Cell colspan={6} class="bg-surface-2">
								<form method="POST" action="?/void" use:enhance class="flex flex-wrap items-end gap-2">
									<input type="hidden" name="id" value={r.id} />
									<div class="min-w-56 flex-1">
										<Label class="text-xs">
											Reason for voiding this {peso(r.amountCentavos)} hold — reverses the cash movement
										</Label>
										<Input
											name="reason"
											required
											maxlength={300}
											placeholder="e.g. collected by mistake, wrong amount"
											class="mt-1 h-8"
										/>
									</div>
									<Button type="submit" size="sm" variant="destructive">Confirm void</Button>
									<button
										type="button"
										onclick={() => (voidingId = null)}
										class="pb-1.5 text-xs text-ink-muted underline underline-offset-2"
									>
										Cancel
									</button>
								</form>
							</Table.Cell>
						</Table.Row>
					{/if}
				{:else}
					<Table.Row>
						<Table.Cell colspan={6} class="py-6 text-center text-ink-muted">
							No security deposits {data.show === 'all' ? 'yet' : `with status "${data.show}"`}.
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>
