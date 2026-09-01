<script lang="ts">
	import { enhance } from '$app/forms';
	import { ui } from '$lib/components/ui';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const h = $derived(data.hotel);
	const vatPct = $derived((h.vatRateBps / 100).toString());
</script>

<div class={ui.page}>
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class={ui.h1}>{h.name}</h1>
			<p class="text-sm text-ink-muted">
				<code>/{h.slug}</code> · {h.status} · org <code class="text-xs">{h.orgRef}</code>
			</p>
		</div>
		<a class="{ui.btn} {ui.btnGhost}" href="/admin/hotels">← All hotels</a>
	</div>

	{#if form?.error}<p class="{ui.alertErr} mb-4">{form.error}</p>{/if}
	{#if form?.ok}<p class="{ui.alertOk} mb-4">{form.ok}</p>{/if}
	{#if form?.inviteLink}
		<p class="{ui.card} mb-4 break-all text-sm">
			Send this link to the invitee:<br /><code>{form.inviteLink}</code>
		</p>
	{/if}

	<div class="grid gap-6 lg:grid-cols-2">
		<section class={ui.card}>
			<h2 class={ui.h2}>Configuration</h2>
			<form method="POST" action="?/updateConfig" use:enhance class="mt-3 space-y-3">
				<div>
					<label class={ui.label} for="name">Name</label>
					<input class={ui.input} id="name" name="name" value={h.name} required />
				</div>
				<div>
					<label class={ui.label} for="legalName">Legal name</label>
					<input class={ui.input} id="legalName" name="legalName" value={h.legalName ?? ''} />
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class={ui.label} for="city">City</label>
						<input class={ui.input} id="city" name="city" value={h.city ?? ''} />
					</div>
					<div>
						<label class={ui.label} for="timezone">Timezone</label>
						<input class={ui.input} id="timezone" name="timezone" value={h.timezone} required />
					</div>
				</div>
				<div>
					<label class={ui.label} for="addressLine">Address</label>
					<input class={ui.input} id="addressLine" name="addressLine" value={h.addressLine ?? ''} />
				</div>
				<div class="grid grid-cols-3 gap-3">
					<div>
						<label class={ui.label} for="currency">Currency</label>
						<select class={ui.select} id="currency" name="currency">
							<option value="PHP" selected={h.currency === 'PHP'}>PHP</option>
						</select>
					</div>
					<div>
						<label class={ui.label} for="vatRatePct">VAT %</label>
						<input
							class={ui.input}
							id="vatRatePct"
							name="vatRatePct"
							type="number"
							step="0.01"
							value={vatPct}
							required
						/>
					</div>
					<div>
						<label class={ui.label} for="orSeriesPrefix">OR prefix</label>
						<input
							class={ui.input}
							id="orSeriesPrefix"
							name="orSeriesPrefix"
							value={h.orSeriesPrefix}
							required
						/>
					</div>
				</div>
				<button class="{ui.btn} {ui.btnPrimary}" type="submit">Save configuration</button>
			</form>

			<hr class="my-4 border-border" />
			<h2 class={ui.h2}>Status</h2>
			<div class="mt-2 flex gap-2">
				<form method="POST" action="?/setStatus" use:enhance>
					<input type="hidden" name="status" value="published" />
					<button class="{ui.btn} {ui.btnPrimary}" disabled={h.status === 'published'}>Publish</button>
				</form>
				<form method="POST" action="?/setStatus" use:enhance>
					<input type="hidden" name="status" value="draft" />
					<button class="{ui.btn} {ui.btnGhost}" disabled={h.status === 'draft'}>Unpublish</button>
				</form>
				<form method="POST" action="?/setStatus" use:enhance>
					<input type="hidden" name="status" value="archived" />
					<button class="{ui.btn} {ui.btnDanger}" disabled={h.status === 'archived'}>Archive</button>
				</form>
			</div>
		</section>

		<section class={ui.card}>
			<h2 class={ui.h2}>Members</h2>
			{#if data.members.length === 0}
				<p class="mt-2 text-sm text-ink-muted">No members yet.</p>
			{:else}
				<table class="{ui.table} mt-2">
					<tbody>
						{#each data.members as m (m.userId)}
							<tr>
								<td class={ui.td}>
									<div class="font-medium">{m.name}</div>
									<div class="text-xs text-ink-muted">{m.email}</div>
								</td>
								<td class={ui.td}>
									<form method="POST" action="?/changeRole" use:enhance class="flex items-center gap-2">
										<input type="hidden" name="userId" value={m.userId} />
										<select class={ui.select} name="role" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
											{#each data.roles as r (r)}
												<option value={r} selected={r === m.role}>{r}</option>
											{/each}
										</select>
									</form>
								</td>
								<td class={ui.td}>
									<form method="POST" action="?/removeMember" use:enhance>
										<input type="hidden" name="userId" value={m.userId} />
										<button class="text-xs text-danger hover:underline">Remove</button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}

			{#if data.pendingInvites.length > 0}
				<h3 class="mt-4 text-xs font-semibold uppercase text-ink-muted">Pending invites</h3>
				<ul class="mt-1 text-sm">
					{#each data.pendingInvites as inv (inv.id)}
						<li class="py-1 text-ink-muted">{inv.email} — {inv.role}</li>
					{/each}
				</ul>
			{/if}

			<hr class="my-4 border-border" />
			<h3 class="text-xs font-semibold uppercase text-ink-muted">Invite a member</h3>
			<form method="POST" action="?/inviteMember" use:enhance class="mt-2 space-y-3">
				<div>
					<label class={ui.label} for="inviteEmail">Email</label>
					<input class={ui.input} id="inviteEmail" name="email" type="email" required />
				</div>
				<div>
					<label class={ui.label} for="inviteRole">Role</label>
					<select class={ui.select} id="inviteRole" name="role">
						{#each data.roles as r (r)}
							<option value={r}>{r}</option>
						{/each}
					</select>
				</div>
				<button class="{ui.btn} {ui.btnPrimary}" type="submit">Create invite</button>
			</form>
		</section>
	</div>
</div>
