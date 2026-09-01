<script lang="ts">
	import { page } from '$app/state';
	import { ui } from '$lib/components/ui';

	let { children } = $props();

	const nav = [
		{ href: '/admin', label: 'Overview' },
		{ href: '/admin/hotels', label: 'Hotels' },
		{ href: '/admin/users', label: 'Users' }
	];

	const isActive = (href: string) =>
		href === '/admin' ? page.url.pathname === '/admin' : page.url.pathname.startsWith(href);
</script>

<div class="min-h-full">
	<header class="border-b border-border bg-surface-2">
		<div class="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
			<div class="flex items-center gap-6">
				<a href="/admin" class="font-semibold text-ink">MM Hotel · Admin</a>
				<nav class="flex gap-1">
					{#each nav as item (item.href)}
						<a
							href={item.href}
							class="rounded-md px-3 py-1.5 text-sm {isActive(item.href)
								? 'bg-brand text-brand-ink'
								: 'text-ink-muted hover:bg-surface'}"
						>
							{item.label}
						</a>
					{/each}
				</nav>
			</div>
			<form method="POST" action="/auth/logout">
				<button class="{ui.btn} {ui.btnGhost}" type="submit">Sign out</button>
			</form>
		</div>
	</header>

	<main>{@render children()}</main>
</div>
