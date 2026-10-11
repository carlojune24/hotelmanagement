<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
	import { SETTINGS_ENTRIES, groupSettingsEntries } from '$lib/settings-nav';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	const base = $derived(`/${page.params.hotel}/management`);

	const entries = $derived(SETTINGS_ENTRIES.filter((e) => data.settingsEntryIds.includes(e.id)));
	const groups = $derived(groupSettingsEntries(entries));

	// The landing page is the hub; the rail marks the entry whose page you are on. Longest match wins so
	// "Roles & permissions" (settings/team/roles) is not also read as "Team" (settings/team).
	const current = $derived.by(() => {
		const path = page.url.pathname;
		let best: (typeof entries)[number] | null = null;
		for (const e of entries) {
			const target = `${base}/${e.href}`;
			if (path === target || path.startsWith(`${target}/`)) {
				if (!best || e.href.length > best.href.length) best = e;
			}
		}
		return best;
	});
	const onHub = $derived(page.url.pathname === `${base}/settings`);
</script>

<div class="lg:flex">
	<!-- Phones and tablets: one selector above the page. -->
	<div class="border-b border-border px-4 py-3 sm:px-6 lg:hidden print:hidden">
		<label for="settings-jump" class="sr-only">Go to a settings page</label>
		<select
			id="settings-jump"
			class="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink"
			value={onHub ? '' : (current ? `${base}/${current.href}` : '')}
			onchange={(e) => {
				const to = e.currentTarget.value;
				if (to) void goto(to);
			}}
		>
			<option value="">All settings</option>
			{#each groups as g (g.id)}
				<optgroup label={g.label}>
					{#each g.entries as e (e.id)}
						<option value="{base}/{e.href}">{e.label}{e.linkOut ? ' ↗' : ''}</option>
					{/each}
				</optgroup>
			{/each}
		</select>
	</div>

	<!-- Desktop: a persistent grouped rail. -->
	<nav
		aria-label="Settings"
		class="sticky top-0 hidden max-h-screen w-60 shrink-0 self-start overflow-y-auto border-r border-border px-3 py-6 lg:block print:hidden"
	>
		<a
			href="{base}/settings"
			aria-current={onHub ? 'page' : undefined}
			class="mb-4 block rounded-md px-2 py-1.5 text-sm font-semibold text-ink hover:bg-surface {onHub ? 'bg-surface' : ''}"
		>
			Settings
		</a>
		{#each groups as g (g.id)}
			<div class="mb-4">
				<div class="px-2 pb-1 text-xs font-medium tracking-wide text-ink-muted uppercase">{g.label}</div>
				<ul class="space-y-0.5">
					{#each g.entries as e (e.id)}
						{@const here = current?.id === e.id}
						<li>
							<a
								href="{base}/{e.href}"
								aria-current={here ? 'page' : undefined}
								class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors {here
									? 'bg-brand/10 font-medium text-brand'
									: 'text-ink hover:bg-surface'}"
							>
								<e.icon class="size-4 shrink-0" />
								<span class="min-w-0 flex-1 truncate">{e.label}</span>
								{#if e.linkOut}
									<ArrowUpRightIcon
										class="size-3.5 shrink-0 text-ink-muted"
										aria-label="Opens in its own section"
									/>
								{/if}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</nav>

	<div class="min-w-0 flex-1">{@render children()}</div>
</div>
