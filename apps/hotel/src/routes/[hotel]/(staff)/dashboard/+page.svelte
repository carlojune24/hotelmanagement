<script lang="ts">
	import { page } from '$app/state';
	import BedIcon from '@lucide/svelte/icons/bed';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import ConciergeBellIcon from '@lucide/svelte/icons/concierge-bell';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const base = $derived(`/${page.params.hotel}`);

	const setupLinks = $derived([
		{
			href: `${base}/settings/rooms`,
			icon: BedIcon,
			title: 'Rooms & room types',
			description: 'Inventory, capacity, bedding, amenities and media are ready to configure.'
		},
		{
			href: `${base}/settings/rates`,
			icon: WalletIcon,
			title: 'Rates & policies',
			description: 'Set base pricing, fees, deposits and cancellation policies.'
		}
	]);
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
	<h1 class="mb-1 text-xl font-semibold tracking-tight text-ink">Dashboard</h1>
	<p class="mb-8 text-sm text-ink-muted">
		{data.hotel?.name} · {data.hotel?.timezone}
	</p>

	<h2 class="text-sm font-semibold text-ink">Set up your inventory</h2>
	<div class="mt-3 grid gap-3 sm:grid-cols-2">
		{#each setupLinks as link (link.href)}
			<a
				href={link.href}
				class="group flex items-start gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm transition hover:border-brand/50"
			>
				<div
					class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand"
				>
					<link.icon class="size-4.5" />
				</div>
				<div class="min-w-0 flex-1">
					<div class="font-medium text-ink">{link.title}</div>
					<p class="mt-0.5 text-sm text-ink-muted">{link.description}</p>
				</div>
				<ArrowRightIcon
					class="mt-2 size-4 shrink-0 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-brand"
				/>
			</a>
		{/each}
	</div>

	<div class="mt-8 flex items-start gap-3 rounded-xl border border-dashed border-border p-4">
		<div
			class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-muted"
		>
			<ConciergeBellIcon class="size-4.5" />
		</div>
		<div>
			<div class="font-medium text-ink">Front desk & booking is next</div>
			<p class="mt-0.5 text-sm text-ink-muted">
				Arrivals, in-house guests and cash position will appear here once front desk and booking
				ship, followed by housekeeping, finance, HR and reports.
			</p>
		</div>
	</div>
</div>
