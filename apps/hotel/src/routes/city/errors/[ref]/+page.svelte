<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const fullTimestamp = (d: Date | string) =>
		new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'medium' });
</script>

<div class="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between gap-4">
		<div>
			<h1 class="font-mono text-xl font-semibold tracking-tight text-ink">{data.entry.ref}</h1>
			<p class="text-sm text-ink-muted">{fullTimestamp(data.entry.occurredAt)}</p>
		</div>
		<Button variant="outline" href="/city/errors">← Errors</Button>
	</div>

	<section class="mb-6 rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
		<p class="mb-4 text-sm font-medium text-ink">{data.entry.message}</p>
		<dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
			<div>
				<dt class="text-xs text-ink-muted">Method</dt>
				<dd class="font-mono text-ink">{data.entry.method}</dd>
			</div>
			<div class="col-span-2 sm:col-span-2">
				<dt class="text-xs text-ink-muted">Path</dt>
				<dd class="font-mono text-ink">{data.entry.path}</dd>
			</div>
			<div>
				<dt class="text-xs text-ink-muted">Route</dt>
				<dd class="text-ink">{data.entry.routeId ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-xs text-ink-muted">Hotel</dt>
				<dd class="text-ink">{data.entry.hotelName ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-xs text-ink-muted">User</dt>
				<dd class="font-mono text-xs text-ink">{data.entry.userId ?? '—'}</dd>
			</div>
		</dl>
	</section>

	{#if data.entry.stack}
		<section class="mb-6">
			<h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">
				Stack trace
			</h2>
			<pre class="overflow-x-auto rounded-xl border border-border bg-surface-2 p-4 text-xs text-ink"><code
					>{data.entry.stack}</code
				></pre>
		</section>
	{/if}

	{#if data.siblings.length > 0}
		<section>
			<h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">
				Other occurrences ({data.siblings.length})
			</h2>
			<div class="overflow-hidden rounded-xl border border-border">
				<ul class="divide-y divide-border">
					{#each data.siblings as s (s.ref)}
						<li>
							<a
								href="/city/errors/{s.ref}"
								class="flex items-center justify-between gap-4 px-4 py-2.5 text-sm hover:bg-surface"
							>
								<span class="font-mono text-xs text-brand">{s.ref}</span>
								<span class="text-xs text-ink-muted">{fullTimestamp(s.occurredAt)}</span>
							</a>
						</li>
					{/each}
				</ul>
			</div>
		</section>
	{/if}
</div>
