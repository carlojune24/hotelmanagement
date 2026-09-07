<script lang="ts">
	import { page } from '$app/state';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import SidebarCollapseButton from '$lib/components/sidebar-collapse-button.svelte';
	import { roleCan, type MembershipRole } from '$lib/authz';
	import { mode, toggleMode } from 'mode-watcher';
	import type { LayoutData } from './$types';
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import ConciergeBellIcon from '@lucide/svelte/icons/concierge-bell';
	import CalendarCheckIcon from '@lucide/svelte/icons/calendar-check';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import GemIcon from '@lucide/svelte/icons/gem';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import UsersIcon from '@lucide/svelte/icons/users';
	import BanknoteIcon from '@lucide/svelte/icons/banknote';
	import ChartColumnIcon from '@lucide/svelte/icons/chart-column';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import BuildingIcon from '@lucide/svelte/icons/building-2';
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import StarIcon from '@lucide/svelte/icons/star';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	let logoutForm: HTMLFormElement;

	const base = $derived(`/${data.hotel?.slug ?? ''}`);
	const isAdmin = $derived(data.user?.isPlatformAdmin ?? false);
	const role = $derived(data.role as MembershipRole | null);
	const roleLabel = $derived(role ?? (isAdmin ? 'platform' : ''));

	const initials = $derived(
		(data.user?.name ?? '')
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase())
			.join('') || '?'
	);

	function can(cap: string): boolean {
		return isAdmin || (role ? roleCan(role, cap) : false);
	}

	const items = $derived(
		[
			{ seg: 'dashboard', label: 'Dashboard', icon: LayoutDashboardIcon, show: true },
			{
				seg: 'front-desk',
				label: 'Front desk',
				icon: ConciergeBellIcon,
				show: can('booking:read')
			},
			{
				seg: 'reservations',
				label: 'Reservations',
				icon: CalendarCheckIcon,
				show: can('booking:read')
			},
			{
				seg: 'housekeeping',
				label: 'Housekeeping',
				icon: SparklesIcon,
				show: can('housekeeping:read')
			},
			{ seg: 'amenities', label: 'Amenities', icon: GemIcon, show: can('booking:read') },
			{ seg: 'reviews', label: 'Reviews', icon: StarIcon, show: can('review:read') },
			{ seg: 'finance', label: 'Finance', icon: WalletIcon, show: can('finance:read') },
			{ seg: 'hr', label: 'HR', icon: UsersIcon, show: can('hr:read') },
			{ seg: 'payroll', label: 'Payroll', icon: BanknoteIcon, show: can('payroll:read') },
			{ seg: 'reports', label: 'Reports', icon: ChartColumnIcon, show: can('reports:read') },
			{
				seg: 'settings',
				label: 'Settings',
				icon: SettingsIcon,
				show: can('hotel:admin') || isAdmin
			}
		].filter((i) => i.show)
	);

	const active = (seg: string) => page.url.pathname.startsWith(`${base}/${seg}`);
</script>

<form bind:this={logoutForm} method="POST" action="/auth/logout" class="hidden"></form>

<Sidebar.Provider>
	<Sidebar.Root collapsible="icon">
		<Sidebar.Header>
			<Sidebar.Menu>
				<Sidebar.MenuItem>
					<Sidebar.MenuButton size="lg" tooltipContent={data.hotel?.name}>
						{#snippet child({ props })}
							<a href={base} {...props}>
								<BuildingIcon />
								<span class="truncate font-semibold">{data.hotel?.name}</span>
							</a>
						{/snippet}
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
			</Sidebar.Menu>
		</Sidebar.Header>

		<Sidebar.Content>
			<Sidebar.Group>
				<Sidebar.Menu>
					{#each items as item (item.seg)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={active(item.seg)} tooltipContent={item.label}>
								{#snippet child({ props })}
									<a href="{base}/{item.seg}" {...props}>
										<item.icon />
										<span>{item.label}</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.Group>

			{#if isAdmin}
				<Sidebar.Group class="mt-auto">
					<Sidebar.Menu>
						<Sidebar.MenuItem>
							<Sidebar.MenuButton tooltipContent="Platform admin">
								{#snippet child({ props })}
									<a href="/admin" {...props}>
										<ShieldIcon />
										<span>Platform admin</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					</Sidebar.Menu>
				</Sidebar.Group>
			{/if}
		</Sidebar.Content>

		<Sidebar.Footer>
			<Sidebar.Menu>
				<Sidebar.MenuItem>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Sidebar.MenuButton size="lg" {...props}>
									<Avatar.Root class="size-6">
										<Avatar.Fallback class="bg-brand text-xs text-brand-ink"
											>{initials}</Avatar.Fallback
										>
									</Avatar.Root>
									<span class="flex flex-col truncate text-left leading-tight">
										<span class="truncate font-medium">{data.user?.name}</span>
										<span class="truncate text-xs text-sidebar-foreground/70">{roleLabel}</span>
									</span>
								</Sidebar.MenuButton>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content class="w-56" align="start" side="top">
							<DropdownMenu.Label>
								<span class="block font-medium text-ink">{data.user?.name}</span>
								<span class="block text-xs font-normal text-ink-muted">{roleLabel}</span>
							</DropdownMenu.Label>
							<DropdownMenu.Separator />
							<DropdownMenu.Item variant="destructive" onSelect={() => logoutForm.requestSubmit()}>
								<LogOutIcon />
								Sign out
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</Sidebar.MenuItem>
			</Sidebar.Menu>
			<Sidebar.Separator />
			<Sidebar.Menu>
				<SidebarCollapseButton />
				<Sidebar.MenuItem>
					<Sidebar.MenuButton onclick={toggleMode} tooltipContent="Toggle theme">
						{#if mode.current === 'dark'}
							<SunIcon />
						{:else}
							<MoonIcon />
						{/if}
						<span>Toggle theme</span>
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
			</Sidebar.Menu>
		</Sidebar.Footer>
		<Sidebar.Rail />
	</Sidebar.Root>

	<Sidebar.Inset>
		<div class="md:hidden">
			<Sidebar.Trigger class="m-2" />
		</div>
		<main class="flex-1">{@render children()}</main>
	</Sidebar.Inset>
</Sidebar.Provider>
