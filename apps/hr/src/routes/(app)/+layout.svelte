<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import BuildingIcon from '@lucide/svelte/icons/building-2';
	import UsersIcon from '@lucide/svelte/icons/users';
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import LandmarkIcon from '@lucide/svelte/icons/landmark';
	import HandCoinsIcon from '@lucide/svelte/icons/hand-coins';
	import UserRoundXIcon from '@lucide/svelte/icons/user-round-x';
	import GiftIcon from '@lucide/svelte/icons/gift';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import PalmtreeIcon from '@lucide/svelte/icons/tree-palm';
	import TimerIcon from '@lucide/svelte/icons/timer';
import ReceiptIcon from '@lucide/svelte/icons/receipt-text';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import ContactIcon from '@lucide/svelte/icons/contact';
	import KeyIcon from '@lucide/svelte/icons/key-round';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	const SCOPE_ICON = {
		dashboard: LayoutDashboardIcon,
		employees: ContactIcon,
		schedule: CalendarDaysIcon,
		dtr: ClockIcon,
		leave: PalmtreeIcon,
overtime: TimerIcon,
		memos: FileTextIcon,
		payslips: ReceiptIcon,
		settings: SettingsIcon
	} as const;

	// A manager or clerk gets their establishment's menu; Main HR and the owner keep the company menu.
	const items = $derived(
		data.scope
			? data.scope.items.map((i) => ({
					seg: `${data.scope!.current.slug}/${i.seg}`,
					label: i.label,
					icon: SCOPE_ICON[i.seg as keyof typeof SCOPE_ICON] ?? LayoutDashboardIcon,
					show: true
				}))
			: [
			{ seg: 'establishments', label: 'Establishments', icon: BuildingIcon, show: data.nav.establishments },
			{ seg: 'approvals', label: 'Approvals', icon: InboxIcon, show: data.nav.approvals },
			{ seg: 'payroll', label: 'Payroll', icon: WalletIcon, show: data.nav.payroll },
			{ seg: 'loans', label: 'Loans', icon: HandCoinsIcon, show: data.nav.loans },
			{ seg: 'bonuses', label: 'Bonuses', icon: GiftIcon, show: data.nav.bonuses },
			{ seg: 'separations', label: 'Separations', icon: UserRoundXIcon, show: data.nav.separations },
			{ seg: 'announcements', label: 'Announcements', icon: MegaphoneIcon, show: data.nav.announcements },
			{ seg: 'remittances', label: 'Remittances', icon: LandmarkIcon, show: data.nav.remittances },
			{ seg: 'people', label: 'People', icon: ContactIcon, show: data.nav.people },
			{ seg: 'users', label: 'Users', icon: UsersIcon, show: data.nav.users },
			{ seg: 'settings', label: 'Settings', icon: SettingsIcon, show: data.nav.settings }
		].filter((i) => i.show)
	);
	const active = (seg: string) => page.url.pathname.startsWith(`/${seg}`);
</script>

<Sidebar.Provider>
	<Sidebar.Root collapsible="icon" class="print:hidden">
		<Sidebar.Header class="p-4">
			<div class="flex items-center gap-3 group-data-[collapsible=icon]:justify-center">
				<span
					class="inline-flex h-9 shrink-0 items-center rounded-full border border-ink/40 px-4 font-display text-lg tracking-wide"
					>HR</span
				>
				<span class="truncate text-sm text-ink-muted group-data-[collapsible=icon]:hidden"
					>{data.orgName}</span
				>
			</div>
			{#if data.scope}
				<div class="mt-3 group-data-[collapsible=icon]:hidden">
					{#if data.scope.establishments.length > 1}
						<label class="sr-only" for="est-switch">Establishment</label>
						<select
							id="est-switch"
							class="h-10 w-full rounded-full border border-transparent bg-white px-4 text-sm font-medium shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
							value={data.scope.current.slug}
							onchange={(e) => goto(`/${e.currentTarget.value}/dashboard`)}
						>
							{#each data.scope.establishments as e (e.slug)}<option value={e.slug}>{e.name}</option>{/each}
						</select>
					{:else}
						<p class="truncate px-1 text-sm font-medium">{data.scope.current.name}</p>
					{/if}
				</div>
			{/if}
		</Sidebar.Header>

		<Sidebar.Content class="px-2">
			<Sidebar.Group>
				<Sidebar.Menu>
					{#each items as item (item.seg)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={active(item.seg)} tooltipContent={item.label}>
								{#snippet child({ props })}
									<a href="/{item.seg}" {...props}>
										<item.icon />
										<span>{item.label}</span>
										{#if item.seg === 'approvals' && data.pendingApprovals > 0}
											<span
												class="ml-auto rounded-full bg-gold px-2 text-xs font-medium text-ink group-data-[collapsible=icon]:hidden"
												aria-label="{data.pendingApprovals} waiting">{data.pendingApprovals}</span
											>
										{/if}
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.Group>
		</Sidebar.Content>

		<Sidebar.Footer class="p-4">
			<div class="mb-2 min-w-0 px-1 group-data-[collapsible=icon]:hidden">
				<p class="truncate text-sm font-medium">{data.user.name}</p>
				<p class="truncate text-xs text-ink-muted">{data.user.email}</p>
			</div>
			<form method="POST" action="/auth/logout">
				<Sidebar.Menu>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton isActive={active('account')} tooltipContent="Account">
							{#snippet child({ props })}
								<a href="/account" {...props}>
									<KeyIcon />
									<span>Account</span>
								</a>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton tooltipContent="Sign out">
							{#snippet child({ props })}
								<!-- type after the spread: the tooltip trigger's props carry type="button", which would stop the submit -->
								<button {...props} type="submit">
									<LogOutIcon />
									<span>Sign out</span>
								</button>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				</Sidebar.Menu>
			</form>
		</Sidebar.Footer>
		<Sidebar.Rail />
	</Sidebar.Root>

	<Sidebar.Inset class="bg-transparent">
		<div class="md:hidden print:hidden">
			<Sidebar.Trigger class="m-2" />
		</div>
		<main class="flex-1 p-4 md:p-8">{@render children()}</main>
	</Sidebar.Inset>
</Sidebar.Provider>
