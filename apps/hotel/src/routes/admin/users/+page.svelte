<script lang="ts">
	import { enhance } from '$app/forms';
	import { ui } from '$lib/components/ui';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<div class={ui.page}>
	<h1 class="{ui.h1} mb-6">Users</h1>

	{#if form?.error}<p class="{ui.alertErr} mb-4">{form.error}</p>{/if}
	{#if form?.ok}<p class="{ui.alertOk} mb-4">{form.ok}</p>{/if}
	{#if form?.inviteLink}
		<p class="{ui.card} mb-4 break-all text-sm"><code>{form.inviteLink}</code></p>
	{/if}

	<div class="grid gap-6 md:grid-cols-[1fr_320px]">
		<section class={ui.card}>
			<table class={ui.table}>
				<thead>
					<tr>
						<th class={ui.th}>User</th>
						<th class={ui.th}>Platform admin</th>
						<th class={ui.th}>Status</th>
						<th class={ui.th}></th>
					</tr>
				</thead>
				<tbody>
					{#each data.users as u (u.id)}
						<tr>
							<td class={ui.td}>
								<div class="font-medium">{u.name}</div>
								<div class="text-xs text-ink-muted">{u.email}</div>
							</td>
							<td class={ui.td}>{u.isPlatformAdmin ? 'Yes' : '—'}</td>
							<td class={ui.td}>
								<span
									class="{ui.badge} {u.status === 'active'
										? 'bg-ok/15 text-ok'
										: 'bg-danger/10 text-danger'}">{u.status}</span
								>
							</td>
							<td class={ui.td}>
								<form method="POST" action="?/setStatus" use:enhance>
									<input type="hidden" name="userId" value={u.id} />
									<input
										type="hidden"
										name="status"
										value={u.status === 'active' ? 'disabled' : 'active'}
									/>
									<button class="text-xs text-brand hover:underline">
										{u.status === 'active' ? 'Disable' : 'Enable'}
									</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>

		<section class="{ui.card} h-fit">
			<h2 class={ui.h2}>Invite platform admin</h2>
			<form method="POST" action="?/invitePlatformAdmin" use:enhance class="mt-3 space-y-3">
				<div>
					<label class={ui.label} for="email">Email</label>
					<input class={ui.input} id="email" name="email" type="email" required />
				</div>
				<button class="{ui.btn} {ui.btnPrimary} w-full" type="submit">Create invite</button>
			</form>
		</section>
	</div>
</div>
