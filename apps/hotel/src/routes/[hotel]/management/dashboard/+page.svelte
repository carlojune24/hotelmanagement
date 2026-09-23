<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import BedIcon from '@lucide/svelte/icons/bed';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import CalendarXIcon from '@lucide/svelte/icons/calendar-x';
	import BanknoteIcon from '@lucide/svelte/icons/banknote';
	import HammerIcon from '@lucide/svelte/icons/hammer';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const base = $derived(`/${page.params.hotel}`);
	const staffBase = $derived(`${base}/management`);

	/** The hotel's own guest-facing booking site — its custom domain if set, the
	 *  platform's own path otherwise (`hooks.server.ts`'s `reroute` maps a custom
	 *  domain straight to this hotel, dropping the `/{slug}` prefix). */
	const bookingUrl = $derived(
		data.hotel?.customDomain ? `https://${data.hotel.customDomain}` : `${page.url.origin}${base}`
	);

	async function copyBookingUrl() {
		try {
			await navigator.clipboard.writeText(bookingUrl);
			toast.success('Link copied.');
		} catch {
			toast.error('Could not copy — copy it manually instead.');
		}
	}

	const peso = (c: number) =>
		`₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

	/** Business dates are hotel-local `YYYY-MM-DD` strings — format them as calendar
	 *  dates (UTC), never through the staff device's own timezone. */
	const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
	const todayLabel = $derived(
		asDate(data.today).toLocaleDateString('en-PH', {
			weekday: 'long',
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		})
	);
	const yesterdayLabel = $derived(
		asDate(data.yesterday).toLocaleDateString('en-PH', {
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		})
	);
	const monthRangeLabel = $derived.by(() => {
		const month = asDate(data.today).toLocaleDateString('en-PH', { month: 'short', timeZone: 'UTC' });
		const day = Number(data.today.slice(8));
		return day === 1 ? `${month} 1` : `${month} 1–${day}`;
	});

	type AttentionItem = { href: string; text: string; icon: typeof BedIcon; urgent?: boolean };
	const attention = $derived.by(() => {
		const items: AttentionItem[] = [];
		const a = data.attention;
		if (a.yesterdayNotClosed) {
			items.push({
				href: `${staffBase}/finance`,
				text: `Yesterday (${yesterdayLabel}) isn't closed`,
				icon: CalendarXIcon,
				urgent: true
			});
		}
		if (a.openShifts) {
			items.push({
				href: `${staffBase}/finance/shifts`,
				text: `${plural(a.openShifts, 'cashier shift')} still open`,
				icon: BanknoteIcon
			});
		}
		if (a.pendingDamage) {
			items.push({
				href: `${staffBase}/${a.damageHref}`,
				text: `${plural(a.pendingDamage, 'damage report')} to charge or dismiss`,
				icon: HammerIcon
			});
		}
		if (data.unreadMessageCount > 0) {
			items.push({
				href: `${staffBase}/messages`,
				text: `${plural(data.unreadMessageCount, 'unread guest message')}`,
				icon: MessageSquareIcon
			});
		}
		return items;
	});

	const hasRooms = $derived(!!data.rooms && data.rooms.total > 0);
	const nothingForRole = $derived(!data.rooms && !data.money && attention.length === 0);

	const setupLinks = $derived([
		{
			href: `${staffBase}/settings/rooms`,
			icon: BedIcon,
			title: 'Rooms & room types',
			description: 'Inventory, capacity, bedding, amenities and media.'
		},
		{
			href: `${staffBase}/settings/rates`,
			icon: WalletIcon,
			title: 'Rates & policies',
			description: 'Base pricing, fees, deposits and cancellation policies.'
		}
	]);
</script>

<svelte:head><title>Today · {data.hotel?.name}</title></svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
	<header class="mb-6">
		<h1 class="text-xl font-semibold tracking-tight text-balance text-ink">Today</h1>
		<p class="mt-1 text-sm text-ink-muted">
			<span class="tabular-nums">{todayLabel}</span> · {data.hotel?.name}
		</p>
	</header>

	{#if attention.length > 0}
		<section aria-labelledby="attention-heading" class="mb-8">
			<h2 id="attention-heading" class="mb-3 text-sm font-semibold text-ink">Needs attention</h2>
			<ul class="divide-y divide-border overflow-hidden rounded-xl border border-border">
				{#each attention as item (item.href + item.text)}
					<li>
						<a
							href={item.href}
							class="group flex min-h-12 items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring {item.urgent
								? 'font-medium text-danger'
								: 'text-ink'}"
						>
							<item.icon class="size-4 shrink-0 {item.urgent ? '' : 'text-ink-muted'}" />
							<span class="min-w-0 flex-1">{item.text}</span>
							<ChevronRightIcon
								class="size-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5"
							/>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if data.rooms}
		{#if hasRooms}
			<section aria-labelledby="rooms-heading" class="mb-8">
				<h2 id="rooms-heading" class="mb-3 text-sm font-semibold text-ink">Rooms</h2>
				<!-- One ruled board, cells split by 1px hairlines (the gap shows the border colour) —
				     a departures-board strip, not four floating cards. -->
				<div
					class="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4"
				>
					<a href="{staffBase}/{data.roomsHref}" class="dash-cell">
						<span class="dash-label">Arrivals</span>
						<span class="dash-figure">{data.rooms.arrivals}</span>
						<span class="dash-sub">to check in</span>
					</a>
					<a href="{staffBase}/{data.roomsHref}" class="dash-cell">
						<span class="dash-label">Departures</span>
						<span class="dash-figure">{data.rooms.departures}</span>
						{#if data.rooms.overdue > 0}
							<span class="dash-sub font-medium text-danger">{data.rooms.overdue} overdue</span>
						{:else}
							<span class="dash-sub">to check out</span>
						{/if}
					</a>
					<a href="{staffBase}/{data.roomsHref}" class="dash-cell">
						<span class="dash-label">In-house</span>
						<span class="dash-figure">{data.rooms.inHouseGuests}</span>
						<span class="dash-sub"
							>{data.rooms.inHouseGuests === 1 ? 'guest' : 'guests'} in {plural(
								data.rooms.occupiedRooms,
								'room'
							)}</span
						>
					</a>
					<a href="{staffBase}/{data.roomsHref}" class="dash-cell">
						<span class="dash-label">Occupancy</span>
						<span class="dash-figure">{data.rooms.occupancyPct}%</span>
						<span class="dash-sub"
							>{data.rooms.occupiedRooms} of {plural(data.rooms.sellableRooms, 'room')}</span
						>
						<span
							class="mt-2 block h-1 overflow-hidden rounded-full bg-border"
							role="presentation"
						>
							<span
								class="block h-full rounded-full bg-brand"
								style="width: {Math.min(100, data.rooms.occupancyPct)}%"
							></span>
						</span>
					</a>
				</div>
			</section>
		{:else if !data.canSetup}
			<p class="mb-8 text-sm text-ink-muted">
				No rooms set up yet — a hotel admin adds them in Settings.
			</p>
		{:else}
			<section aria-labelledby="setup-heading" class="mb-8">
				<h2 id="setup-heading" class="mb-3 text-sm font-semibold text-ink">
					Add your rooms to get started
				</h2>
				<div class="grid gap-3 sm:grid-cols-2">
					{#each setupLinks as link (link.href)}
						<a
							href={link.href}
							class="group flex items-start gap-3 rounded-xl border border-border p-4 transition-colors hover:border-brand/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
						>
							<link.icon class="mt-0.5 size-4.5 shrink-0 text-brand" />
							<div class="min-w-0 flex-1">
								<div class="font-medium text-ink">{link.title}</div>
								<p class="mt-0.5 text-sm text-ink-muted">{link.description}</p>
							</div>
							<ArrowRightIcon
								class="mt-1 size-4 shrink-0 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-brand"
							/>
						</a>
					{/each}
				</div>
			</section>
		{/if}
	{/if}

	{#if data.money}
		<section aria-labelledby="money-heading" class="mb-8">
			<h2 id="money-heading" class="mb-3 text-sm font-semibold text-ink">Money</h2>
			<div
				class="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-2"
			>
				<a href="{staffBase}/finance" class="dash-cell">
					<span class="dash-label">Cash on hand</span>
					<span class="dash-figure dash-figure-money">{peso(data.money.cashOnHandCentavos)}</span>
					<span class="dash-sub">all cash accounts, right now</span>
				</a>
				<a href="{staffBase}/finance?from={data.monthStart}&to={data.today}" class="dash-cell">
					<span class="dash-label">Collected this month</span>
					<span class="dash-figure dash-figure-money"
						>{peso(data.money.collectedThisMonthCentavos)}</span
					>
					<span class="dash-sub"><span class="tabular-nums">{monthRangeLabel}</span> · cash basis</span>
				</a>
			</div>
		</section>
	{/if}

	{#if nothingForRole}
		<p class="mb-8 text-sm text-ink-muted">
			{#if data.canHr}
				Your work lives in <a href="{staffBase}/hr" class="text-brand underline underline-offset-4"
					>HR</a
				>.
			{:else}
				Nothing needs you here right now — use the menu to get to your work.
			{/if}
		</p>
	{/if}

	<div
		class="flex flex-col gap-3 rounded-xl border border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
	>
		<div class="flex min-w-0 items-center gap-3">
			<GlobeIcon class="size-4 shrink-0 text-ink-muted" />
			<div class="min-w-0">
				<div class="text-sm font-medium text-ink">Your booking site</div>
				<p class="truncate text-xs text-ink-muted">{bookingUrl}</p>
			</div>
		</div>
		<div class="flex shrink-0 gap-2">
			<Button variant="outline" size="sm" onclick={copyBookingUrl}>
				<CopyIcon class="size-4" /> Copy link
			</Button>
			<Button variant="outline" size="sm" href={bookingUrl} target="_blank" rel="noopener noreferrer">
				<ExternalLinkIcon class="size-4" /> View site
			</Button>
		</div>
	</div>
</div>

<style>
	.dash-cell {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 8.5rem;
		padding: 1.25rem;
		background: var(--surface);
		transition: background-color 150ms cubic-bezier(0.16, 1, 0.3, 1);
	}
	.dash-cell:hover {
		background: var(--surface-2);
	}
	.dash-cell:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
	.dash-label {
		font-size: 0.875rem;
		color: var(--ink-muted);
	}
	.dash-figure {
		margin-top: 0.5rem;
		font-size: 2.5rem;
		line-height: 1;
		font-weight: 600;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}
	.dash-figure-money {
		font-size: clamp(1.5rem, 3.2vw, 1.875rem);
		overflow-wrap: anywhere;
	}
	.dash-sub {
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		color: var(--ink-muted);
	}
</style>
