<script lang="ts">
	import { page } from '$app/state';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import SidebarCollapseButton from '$lib/components/sidebar-collapse-button.svelte';
	import { mode, toggleMode } from 'mode-watcher';
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import BuildingIcon from '@lucide/svelte/icons/building-2';
	import UsersIcon from '@lucide/svelte/icons/users';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
	import ChartColumnIcon from '@lucide/svelte/icons/chart-column';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import UsersRoundIcon from '@lucide/svelte/icons/users-round';
	import StarIcon from '@lucide/svelte/icons/star';
	import BedDoubleIcon from '@lucide/svelte/icons/bed-double';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import LandmarkIcon from '@lucide/svelte/icons/landmark';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	let logoutForm: HTMLFormElement = $state()!;

	// Groups grow as city modules ship (Registration, Reports, Tourism); only pages that exist are linked.
	const groups = [
		{
			label: null,
			items: [
				{ href: '/city', label: 'Overview', icon: LayoutDashboardIcon },
				{ href: '/city/hotels', label: 'Hotels', icon: BuildingIcon }
			]
		},
		{
			label: 'Registration',
			items: [
				{ href: '/city/applications', label: 'Applications', icon: ClipboardListIcon },
				{ href: '/city/apply', label: 'New application', icon: PlusIcon },
				{ href: '/city/permits', label: 'Permits', icon: ShieldCheckIcon }
			]
		},
		{
			label: 'Reports',
			items: [
				{ href: '/city/reports/income', label: 'Income', icon: ChartColumnIcon },
				{ href: '/city/reports/guests', label: 'Guests', icon: UsersRoundIcon },
				{ href: '/city/reports/ratings', label: 'Ratings', icon: StarIcon },
				{ href: '/city/reports/occupancy', label: 'Occupancy', icon: BedDoubleIcon }
			]
		},
		{
			label: 'Platform',
			items: [
				{ href: '/city/users', label: 'Users', icon: UsersIcon },
				{ href: '/city/api-keys', label: 'API keys', icon: KeyRoundIcon },
				{ href: '/city/errors', label: 'Errors', icon: TriangleAlertIcon }
			]
		}
	];

	const isActive = (href: string) =>
		href === '/city' ? page.url.pathname === '/city' : page.url.pathname.startsWith(href);

	const initials = $derived(
		(data.user?.name ?? '')
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((p) => p[0]!.toUpperCase())
			.join('') || '?'
	);
</script>

<form bind:this={logoutForm} method="POST" action="/auth/logout" class="hidden">
	<input type="hidden" name="redirectTo" value="/auth/login" />
</form>

<Sidebar.Provider class="city-shell">
	<Sidebar.Root collapsible="icon" class="print:hidden">
		<Sidebar.Header>
			<Sidebar.Menu>
				<Sidebar.MenuItem>
					<Sidebar.MenuButton
						size="lg"
						tooltipContent="City management"
						class="group-data-[collapsible=icon]:justify-center"
					>
						{#snippet child({ props })}
							<a href="/city" {...props}>
								<LandmarkIcon />
								<span class="truncate font-semibold group-data-[collapsible=icon]:hidden"
									>City management</span
								>
							</a>
						{/snippet}
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
			</Sidebar.Menu>
		</Sidebar.Header>

		<Sidebar.Content>
			{#each groups as group (group.label ?? 'main')}
				<Sidebar.Group>
					{#if group.label}
						<Sidebar.GroupLabel>{group.label}</Sidebar.GroupLabel>
					{/if}
					<Sidebar.Menu>
						{#each group.items as item (item.href)}
							<Sidebar.MenuItem>
								<Sidebar.MenuButton isActive={isActive(item.href)} tooltipContent={item.label}>
									{#snippet child({ props })}
										<a href={item.href} {...props}>
											<item.icon />
											<span>{item.label}</span>
										</a>
									{/snippet}
								</Sidebar.MenuButton>
							</Sidebar.MenuItem>
						{/each}
					</Sidebar.Menu>
				</Sidebar.Group>
			{/each}
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
										<span class="truncate text-xs text-sidebar-foreground/70">Platform admin</span>
									</span>
								</Sidebar.MenuButton>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content class="w-56" align="start" side="top">
							<DropdownMenu.Label>
								<span class="block font-medium text-ink">{data.user?.name}</span>
								<span class="block text-xs font-normal text-ink-muted">Platform admin</span>
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
		<div class="md:hidden print:hidden">
			<Sidebar.Trigger class="m-2" />
		</div>
		<main class="flex-1">{@render children()}</main>
	</Sidebar.Inset>
</Sidebar.Provider>

<style>
	/*
	 * City brand hue (teal) so /city is never mistaken for /admin (blue). Scoped here, not in app.css.
	 * The semantic aliases (--primary, --sidebar-primary, …) are resolved at :root, so overriding
	 * --brand alone would not reach them — re-point each one for this subtree.
	 */
	:global(.city-shell) {
		--brand: oklch(0.52 0.1 195);
		--brand-ink: oklch(0.98 0.01 195);
		--color-brand: var(--brand);
		--color-brand-ink: var(--brand-ink);
		--primary: var(--brand);
		--primary-foreground: var(--brand-ink);
		--ring: var(--brand);
		--sidebar-primary: var(--brand);
		--sidebar-primary-foreground: var(--brand-ink);
		--sidebar-ring: var(--brand);
	}
	:global(.dark .city-shell) {
		--brand: oklch(0.72 0.1 195);
		--brand-ink: oklch(0.2 0.03 195);
	}
</style>
