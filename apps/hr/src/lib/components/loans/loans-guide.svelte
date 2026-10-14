<script lang="ts">
	import HelpIcon from '@lucide/svelte/icons/circle-help';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
</script>

<Popover.Root>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" size="sm" class="gap-1.5">
				<HelpIcon class="size-4" /> How to read this
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="end" class="w-96 space-y-3 text-sm text-ink">
		<p class="font-medium">How loans work</p>
		<dl class="space-y-2">
			<div>
				<dt class="font-medium">Deduction</dt>
				<dd class="text-ink-muted">
					An active loan is taken out automatically when payroll is generated: half of the monthly amount in each
					cutoff. It also appears on that month's SSS / Pag-IBIG loan remittance.
				</dd>
			</div>
			<div>
				<dt class="font-medium">Still owed</dt>
				<dd class="text-ink-muted">What is left on all open loans, after payroll deductions and payments received outside payroll.</dd>
			</div>
			<div>
				<dt class="font-medium">Behind schedule</dt>
				<dd class="text-ink-muted">
					Less has been paid than the monthly amount says should have been by now. A month still in progress is not
					counted, and skipped months push the end date out instead.
				</dd>
			</div>
			<div>
				<dt class="font-medium">Ending within 3 months</dt>
				<dd class="text-ink-muted">Loans that finish soon if the monthly amount keeps being taken.</dd>
			</div>
		</dl>
		<div>
			<p class="font-medium">Statuses</p>
			<ul class="mt-1 list-disc space-y-1 pl-4 text-xs text-ink-muted">
				<li><span class="text-ink">Active</span> — deducted every cutoff until paid off.</li>
				<li><span class="text-ink">Paused</span> — kept on record, not being deducted for now.</li>
				<li><span class="text-ink">Paid off / Cancelled</span> — closed; shown under Closed.</li>
			</ul>
		</div>
		<p class="text-xs text-ink-muted">
			If someone with an open loan separates, the balance is settled from their final pay on the Separations page, or
			record a payment received.
		</p>
	</Popover.Content>
</Popover.Root>
