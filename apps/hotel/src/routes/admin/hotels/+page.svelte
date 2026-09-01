<script lang="ts">
	import { enhance } from '$app/forms';
	import { ui } from '$lib/components/ui';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const badgeClass: Record<string, string> = {
		draft: 'bg-surface text-ink-muted border border-border',
		published: 'bg-ok/15 text-ok',
		archived: 'bg-danger/10 text-danger'
	};
</script>

<div class={ui.page}>
	<h1 class="{ui.h1} mb-6">Hotels</h1>

	<div class="grid gap-6 md:grid-cols-[1fr_320px]">
		<section class={ui.card}>
			{#if data.hotels.length === 0}
				<p class="text-sm text-ink-muted">No hotels yet. Create the first one.</p>
			{:else}
				<table class={ui.table}>
					<thead>
						<tr>
							<th class={ui.th}>Name</th>
							<th class={ui.th}>Slug</th>
							<th class={ui.th}>Status</th>
						</tr>
					</thead>
					<tbody>
						{#each data.hotels as h (h.id)}
							<tr class="hover:bg-surface/50">
								<td class={ui.td}>
									<a class="font-medium text-brand hover:underline" href="/admin/hotels/{h.id}">
										{h.name}
									</a>
								</td>
								<td class={ui.td}><code class="text-xs">/{h.slug}</code></td>
								<td class={ui.td}>
									<span class="{ui.badge} {badgeClass[h.status]}">{h.status}</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>

		<section class="{ui.card} h-fit">
			<h2 class={ui.h2}>Add hotel</h2>
			{#if form?.error}<p class="{ui.alertErr} mt-3">{form.error}</p>{/if}
			<form method="POST" action="?/create" use:enhance class="mt-3 space-y-3">
				<div>
					<label class={ui.label} for="name">Name</label>
					<input class={ui.input} id="name" name="name" required placeholder="Seaside Inn" />
				</div>
				<div>
					<label class={ui.label} for="slug">URL slug</label>
					<input
						class={ui.input}
						id="slug"
						name="slug"
						required
						placeholder="seaside-inn"
						pattern="[a-z0-9][a-z0-9-]&#123;1,38&#125;[a-z0-9]"
					/>
					<p class="mt-1 text-xs text-ink-muted">Guests and staff reach it at /slug</p>
				</div>
				<button class="{ui.btn} {ui.btnPrimary} w-full" type="submit">Create draft</button>
			</form>
		</section>
	</div>
</div>
