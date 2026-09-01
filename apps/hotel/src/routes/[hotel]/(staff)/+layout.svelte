<script lang="ts">
	import { page } from '$app/state';
	import { ui } from '$lib/components/ui';
	import { roleCan, type MembershipRole } from '$lib/authz';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	const base = $derived(`/${data.hotel?.slug ?? ''}`);
	const isAdmin = $derived(data.user?.isPlatformAdmin ?? false);
	const role = $derived(data.role as MembershipRole | null);

	function can(cap: string): boolean {
		return isAdmin || (role ? roleCan(role, cap) : false);
	}

	const items = $derived(
		[
			{ seg: 'dashboard', label: 'Dashboard', show: true },
			{ seg: 'front-desk', label: 'Front desk', show: can('booking:read') },
			{ seg: 'reservations', label: 'Reservations', show: can('booking:read') },
			{ seg: 'housekeeping', label: 'Housekeeping', show: can('housekeeping:read') },
			{ seg: 'amenities', label: 'Amenities', show: can('booking:read') },
			{ seg: 'finance', label: 'Finance', show: can('finance:read') },
			{ seg: 'hr', label: 'HR', show: can('hr:read') },
			{ seg: 'payroll', label: 'Payroll', show: can('payroll:read') },
			{ seg: 'reports', label: 'Reports', show: can('reports:read') },
			{ seg: 'settings', label: 'Settings', show: can('hotel:admin') || isAdmin }
		].filter((i) => i.show)
	);

	const active = (seg: string) => page.url.pathname.startsWith(`${base}/${seg}`);
</script>

<div class="min-h-full">
	<header class="border-b border-border bg-surface-2">
		<div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
			<div class="flex items-center gap-4">
				<a href={base} class="font-semibold text-ink">{data.hotel?.name}</a>
				{#if isAdmin}
					<a href="/admin" class="text-xs text-ink-muted hover:underline">admin</a>
				{/if}
			</div>
			<div class="flex items-center gap-3 text-sm">
				<span class="text-ink-muted">{data.user?.name} · {role ?? (isAdmin ? 'platform' : '')}</span>
				<form method="POST" action="/auth/logout">
					<button class="{ui.btn} {ui.btnGhost}" type="submit">Sign out</button>
				</form>
			</div>
		</div>
		<nav class="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2 sm:px-6">
			{#each items as item (item.seg)}
				<a
					href="{base}/{item.seg}"
					class="whitespace-nowrap rounded-md px-3 py-1.5 text-sm {active(item.seg)
						? 'bg-brand text-brand-ink'
						: 'text-ink-muted hover:bg-surface'}"
				>
					{item.label}
				</a>
			{/each}
		</nav>
	</header>

	<main>{@render children()}</main>
</div>
