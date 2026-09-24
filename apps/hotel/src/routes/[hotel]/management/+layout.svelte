<script lang="ts">
	import { page } from '$app/state';
	import { invalidate } from '$app/navigation';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import SidebarCollapseButton from '$lib/components/sidebar-collapse-button.svelte';
	import { roleCan } from '$lib/authz';
	import { mode, toggleMode } from 'mode-watcher';
	import type { LayoutData } from './$types';
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import ConciergeBellIcon from '@lucide/svelte/icons/concierge-bell';
	import ShoppingCartIcon from '@lucide/svelte/icons/shopping-cart';
	import CalendarCheckIcon from '@lucide/svelte/icons/calendar-check';
	import ReceiptIcon from '@lucide/svelte/icons/receipt';
	import MailIcon from '@lucide/svelte/icons/mail';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import UsersIcon from '@lucide/svelte/icons/users';
	import BanknoteIcon from '@lucide/svelte/icons/banknote';
	import ChartColumnIcon from '@lucide/svelte/icons/chart-column';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import BuildingIcon from '@lucide/svelte/icons/building-2';
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import StarIcon from '@lucide/svelte/icons/star';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	let logoutForm: HTMLFormElement = $state()!;

	// The login page renders standalone — no sidebar shell, since the visitor isn't
	// authenticated yet and `data.user`/`data.role` may be null.
	const isLoginRoute = $derived(page.route.id === '/[hotel]/management/login');

	const base = $derived(`/${data.hotel?.slug ?? ''}/management`);
	const isAdmin = $derived(data.user?.isPlatformAdmin ?? false);
	const role = $derived(data.role);
	const roleLabel = $derived(role?.name ?? (isAdmin ? 'Platform' : ''));

	const initials = $derived(
		(data.user?.name ?? '')
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase())
			.join('') || '?'
	);

	function can(cap: string): boolean {
		return isAdmin || (role ? roleCan(role.capabilities, cap) : false);
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
				seg: 'quick-sale',
				label: 'Quick sale',
				icon: ShoppingCartIcon,
				show: can('payment:create')
			},
			{
				seg: 'reservations',
				label: 'Reservations',
				icon: CalendarCheckIcon,
				show: can('booking:read')
			},
			{
				seg: 'transactions',
				label: 'Booking transactions',
				icon: ReceiptIcon,
				show: can('booking:read')
			},
			{ seg: 'emails', label: 'Emails', icon: MailIcon, show: can('booking:read') },
			{ seg: 'messages', label: 'Messages', icon: MessageSquareIcon, show: can('booking:read') },
			{
				seg: 'housekeeping',
				label: 'Housekeeping',
				icon: SparklesIcon,
				show: can('housekeeping:read')
			},
			{ seg: 'reviews', label: 'Reviews', icon: StarIcon, show: can('review:read') },
			{ seg: 'finance', label: 'Finance', icon: WalletIcon, show: can('finance:read') },
			{ seg: 'hr', label: 'HR', icon: UsersIcon, show: can('hr:read') },
			{ seg: 'payroll', label: 'Payroll', icon: BanknoteIcon, show: can('payroll:read') },
			{ seg: 'reports', label: 'Reports', icon: ChartColumnIcon, show: can('reports:read') },
			{
				seg: 'settings/audit',
				label: 'Audit log',
				icon: ShieldCheckIcon,
				show: can('hotel:admin') || isAdmin
			},
			{
				seg: 'settings',
				label: 'Settings',
				icon: SettingsIcon,
				show: can('hotel:admin') || isAdmin
			}
		].filter((i) => i.show)
	);

	const active = (seg: string) => {
		const path = page.url.pathname;
		const target = `${base}/${seg}`;
		if (path === target) return true;
		// "Settings" would otherwise also read active on /settings/audit, since that
		// route nests under it — it now has its own top-level entry, so exclude it here.
		if (seg === 'settings') return path.startsWith(`${target}/`) && !path.startsWith(`${base}/settings/audit`);
		return path.startsWith(`${target}/`);
	};

	// Keep the unread badge live across the whole staff app — not just on the
	// Messages page itself — so a new cancellation request is noticed without
	// staff having to think to check, or stumble into it inside a booking.
	$effect(() => {
		const interval = setInterval(() => invalidate('app:guest-messages'), 30_000);
		return () => clearInterval(interval);
	});

	// Open cashier shifts are the one thing staff must never lose sight of: an always-on
	// strip (own shift, plus overdue ones for anyone who can close them) and a sign-out gate.
	// Re-poll so a shift's age ticks up and it turns red without a page change.
	$effect(() => {
		const interval = setInterval(() => invalidate('app:shift-alerts'), 60_000);
		return () => clearInterval(interval);
	});

	const shiftsHref = $derived(`${base}/finance/shifts`);
	const isShiftsIndex = $derived(page.url.pathname === shiftsHref);
	const ageLabel = (h: number) => (h < 1 ? 'under an hour' : `${h}h`);
	const clock = (d: Date) =>
		new Date(d).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });

	type StripItem = { id: string; stale: boolean; text: string; action: string };
	const stripItems = $derived.by((): StripItem[] => {
		const a = data.shiftAlerts;
		const mine: StripItem[] = a.mine.map((s) => ({
			id: s.shiftId,
			stale: s.stale,
			text: s.stale
				? `Your shift on ${s.drawerName} is overdue — open ${ageLabel(s.hoursOpen)} since ${clock(s.openedAt)}. Count the drawer and close it.`
				: `Your shift on ${s.drawerName} has been open since ${clock(s.openedAt)}. Count and close it when you finish — you can't sign out with it open.`,
			action: 'Close shift'
		}));
		const others: StripItem[] = a.others
			.filter((s) => s.stale)
			.map((s) => ({
				id: s.shiftId,
				stale: true,
				text: `${s.openedByName ?? 'Someone'}'s shift on ${s.drawerName} is overdue — open ${ageLabel(s.hoursOpen)}. The day can't be closed while it's open.`,
				action: 'Close on behalf'
			}));
		return [...mine, ...others];
	});
	const STRIP_MAX = 3;

	let signOutGateOpen = $state(false);
	function requestSignOut() {
		if (data.shiftAlerts.mine.length > 0) signOutGateOpen = true;
		else logoutForm.requestSubmit();
	}
</script>

{#if isLoginRoute}
	{@render children()}
{:else}
<form bind:this={logoutForm} method="POST" action="/auth/logout" class="hidden">
	<input type="hidden" name="redirectTo" value="{base}/login" />
</form>

<Sidebar.Provider>
	<Sidebar.Root collapsible="icon" class="print:hidden">
		<Sidebar.Header>
			<Sidebar.Menu>
				<Sidebar.MenuItem>
					<Sidebar.MenuButton
						size="lg"
						tooltipContent={data.hotel?.name}
						class="group-data-[collapsible=icon]:justify-center"
					>
						{#snippet child({ props })}
							<a href="{base}/dashboard" {...props}>
								<BuildingIcon />
								<span class="truncate font-semibold group-data-[collapsible=icon]:hidden"
								>{data.hotel?.name}</span
							>
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
										{#if item.seg === 'messages' && data.unreadMessageCount > 0}
											<Badge
												variant="outline"
												class="ml-auto border-transparent bg-brand/15 px-1.5 text-brand"
											>
												{data.unreadMessageCount}
											</Badge>
										{/if}
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
							<DropdownMenu.Item variant="destructive" onSelect={requestSignOut}>
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
		{#if stripItems.length > 0 && !isShiftsIndex}
			<div class="border-b border-border print:hidden" role="status" aria-live="polite">
				{#each stripItems.slice(0, STRIP_MAX) as item (item.id)}
					<div
						class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm {item.stale
							? 'bg-danger/10 text-danger'
							: 'bg-surface-2 text-ink-muted'}"
					>
						<BanknoteIcon class="size-4 shrink-0" />
						<span class="min-w-0 flex-1">{item.text}</span>
						<a href={shiftsHref} class="font-medium whitespace-nowrap underline underline-offset-2"
							>{item.action}</a
						>
					</div>
				{/each}
				{#if stripItems.length > STRIP_MAX}
					<a
						href={shiftsHref}
						class="block bg-surface-2 px-4 py-1.5 text-xs text-ink-muted underline underline-offset-2"
						>{stripItems.length - STRIP_MAX} more open shifts</a
					>
				{/if}
			</div>
		{/if}
		<main class="flex-1">{@render children()}</main>
	</Sidebar.Inset>
</Sidebar.Provider>

<Dialog.Root bind:open={signOutGateOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Close your shift before signing out</Dialog.Title>
			<Dialog.Description>
				{#each data.shiftAlerts.mine as s (s.shiftId)}
					<span class="block">{s.drawerName} — open since {clock(s.openedAt)}</span>
				{/each}
				<span class="mt-2 block"
					>Count the drawer so the cash you handled matches what's in it. The shift stays open, and
					under your name, until you do.</span
				>
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (signOutGateOpen = false)}>Stay signed in</Button>
			<Button href={`${shiftsHref}?logout=blocked`} onclick={() => (signOutGateOpen = false)}
				>Count &amp; close shift</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
{/if}
