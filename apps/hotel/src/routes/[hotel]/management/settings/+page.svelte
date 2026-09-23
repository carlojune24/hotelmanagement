<script lang="ts">
	import { page } from '$app/state';
	import BedIcon from '@lucide/svelte/icons/bed';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import PaletteIcon from '@lucide/svelte/icons/palette';
	import PartyPopperIcon from '@lucide/svelte/icons/party-popper';
	import UtensilsIcon from '@lucide/svelte/icons/utensils';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import GemIcon from '@lucide/svelte/icons/gem';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import UsersIcon from '@lucide/svelte/icons/users';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';

	const base = $derived(`/${page.params.hotel}/management`);

	const sections = [
		{
			href: 'rooms',
			icon: BedIcon,
			label: 'Room types & rooms',
			desc: 'Manage the room types you sell and the physical rooms behind them.'
		},
		{
			href: 'rates',
			icon: WalletIcon,
			label: 'Rates & policies',
			desc: 'Rate plans, seasonal price overrides, and cancellation policies.'
		},
		{
			href: 'amenities',
			icon: SparklesIcon,
			label: 'Amenities',
			desc: 'The master list of features shown on your hotel page and room listings.'
		},
		{
			href: 'branding',
			icon: PaletteIcon,
			label: 'Branding',
			desc: 'Logo, accent color, hero image, and tagline for your public booking page.'
		},
		{
			href: 'function-halls',
			icon: PartyPopperIcon,
			label: 'Function hall',
			desc: 'The event space you rent by the hour, its pricing, and included services.'
		},
		{
			href: 'dining',
			icon: UtensilsIcon,
			label: 'Dining',
			desc: 'Restaurants, bars, and menu photos shown on your public "Dining" page.'
		},
		{
			href: 'check-in-out',
			icon: ClockIcon,
			label: 'Check-in & check-out',
			desc: 'Standard times and extension fees your front desk works from.'
		},
		{
			href: 'payments-email',
			icon: CreditCardIcon,
			label: 'Payments & email',
			desc: 'Your PayMongo account for online payment, and the mailbox guest email comes from.'
		},
		{
			href: 'amenity-items',
			icon: GemIcon,
			label: 'Sellable items',
			desc: 'Priced extras front desk can charge to a guest’s folio — minibar, spa, damages.'
		},
		{
			href: 'automation',
			icon: ZapIcon,
			label: 'Automation',
			desc: 'Background jobs that run on a schedule instead of a manual button.'
		},
		{
			href: 'team',
			icon: UsersIcon,
			label: 'Team',
			desc: 'Invite staff to this hotel and manage their roles.'
		}
	];
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
	<h1 class="mb-6 text-xl font-semibold tracking-tight text-ink">Settings</h1>

	<div class="grid gap-3 sm:grid-cols-2">
		{#each sections as s (s.href)}
			<a
				href="{base}/settings/{s.href}"
				class="group flex items-start gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm transition hover:border-brand/50"
			>
				<div
					class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand"
				>
					<s.icon class="size-4.5" />
				</div>
				<div class="min-w-0 flex-1">
					<div class="font-medium text-ink">{s.label}</div>
					<p class="mt-0.5 text-sm text-ink-muted">{s.desc}</p>
				</div>
				<ArrowRightIcon
					class="mt-2 size-4 shrink-0 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-brand"
				/>
			</a>
		{/each}
	</div>
</div>
