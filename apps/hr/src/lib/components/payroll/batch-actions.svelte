<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import type { BatchView } from '$lib/server/hr/payroll-view';

	let {
		b,
		runId,
		ratesOk,
		busy,
		run
	}: { b: BatchView; runId: string; ratesOk: boolean; busy: boolean; run: SubmitFunction } = $props();
</script>

{#if b.generatedAt}
	<Button variant="outline" href="/print/{b.establishmentSlug}/payroll/{runId}" target="_blank" rel="noopener">Print</Button>
{/if}
{#if b.status === 'draft'}
	<form method="POST" action="?/generate" use:enhance={run}>
		<input type="hidden" name="batchId" value={b.id} />
		<Button type="submit" variant="outline" disabled={busy || !b.dtrReceived}>
			{b.generatedAt ? 'Regenerate' : 'Generate'}
		</Button>
	</form>
	{#if b.generatedAt}
		<!-- The trigger wraps the form, not the button: a disabled button gets no pointer events. -->
		<Tooltip.Provider>
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<span {...props} class="inline-flex">
							<form method="POST" action="?/lock" use:enhance={run}>
								<input type="hidden" name="batchId" value={b.id} />
								<Button type="submit" disabled={busy || !ratesOk}>Lock</Button>
							</form>
						</span>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>
					{#if ratesOk}
						Freezes this batch: no more regenerating or adjusting. Loan deductions count and the figures feed the remittance schedules. Payslips stay hidden from managers until you release them. You can unlock it until its month’s remittance is marked paid.
					{:else}
						Confirm the rates in force for this run first (“I’ve checked these for this period”), then you can lock.
					{/if}
				</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>
	{/if}
{:else if b.status === 'locked'}
	<form method="POST" action="?/unlock" use:enhance={run}>
		<input type="hidden" name="batchId" value={b.id} />
		<Button type="submit" variant="outline" disabled={busy}>Unlock</Button>
	</form>
	<form method="POST" action="?/release" use:enhance={run}>
		<input type="hidden" name="batchId" value={b.id} />
		<Button type="submit" variant="gold" disabled={busy}>Release payslips</Button>
	</form>
{/if}
