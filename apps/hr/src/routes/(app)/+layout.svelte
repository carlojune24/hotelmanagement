<script lang="ts">
	import { page } from '$app/state';
	import BuildingIcon from '@lucide/svelte/icons/building-2';
	import UsersIcon from '@lucide/svelte/icons/users';
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import ContactIcon from '@lucide/svelte/icons/contact';
	import KeyIcon from '@lucide/svelte/icons/key-round';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	const items = $derived(
		[
			{ seg: 'establishments', label: 'Establishments', icon: BuildingIcon, show: data.nav.establishments },
			{ seg: 'approvals', label: 'Approvals', icon: InboxIcon, show: data.nav.approvals },
			{ seg: 'payroll', label: 'Payroll', icon: WalletIcon, show: data.nav.payroll },
			{ seg: 'people', label: 'People', icon: ContactIcon, show: data.nav.people },
			{ seg: 'users', label: 'Users', icon: UsersIcon, show: data.nav.users }
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
								<button type="submit" {...props}>
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
