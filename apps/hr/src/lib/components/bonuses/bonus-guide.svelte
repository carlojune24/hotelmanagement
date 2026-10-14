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
		<p class="font-medium">Where the figures come from</p>
		<dl class="space-y-2">
			<div>
				<dt class="font-medium">Basic earned</dt>
				<dd class="text-ink-muted">
					Basic pay on <em>locked or released</em> payslips this year. Draft payslips aren't counted, so lock the
					payroll first.
				</dd>
			</div>
			<div>
				<dt class="font-medium">Late / undertime</dt>
				<dd class="text-ink-muted">Pay lost to lateness and undertime on those payslips, taken off before dividing.</dd>
			</div>
			<div>
				<dt class="font-medium">13th month (÷ 12)</dt>
				<dd class="text-ink-muted">(Basic earned − late / undertime) ÷ 12. Overtime, premiums and allowances aren't basic.</dd>
			</div>
			<div>
				<dt class="font-medium">Already paid</dt>
				<dd class="text-ink-muted">13th month already issued this year, e.g. a mid-year installment.</dd>
			</div>
			<div>
				<dt class="font-medium">Pay now</dt>
				<dd class="text-ink-muted">13th month less already paid. This is the amount that gets issued.</dd>
			</div>
		</dl>
		<div>
			<p class="font-medium">Who gets it</p>
			<ul class="mt-1 list-disc space-y-1 pl-4 text-xs text-ink-muted">
				<li>Rank-and-file employees (PD 851). Managerial staff are not covered, and anyone can be marked not covered in their profile.</li>
				<li>Anyone with at least one month (30 days) of service in the year, however they're paid or regular or not.</li>
				<li>Someone who leaves is paid pro-rated up to their last day, usually in their final pay, and isn't paid again here.</li>
			</ul>
		</div>
		<p class="text-xs text-ink-muted">
			Period: mid-year counts payslips from January 1 up to the batch's cut-off date (default June 30), for both basic
			and late / undertime. Year-end counts the whole year, less what was already paid.
		</p>
		<p class="text-xs text-ink-muted">
			₱0.00 with "Under one month" means under 30 days of service this year; "Not entitled" means managerial or marked
			not covered. Use Refresh after locking payroll.
		</p>
	</Popover.Content>
</Popover.Root>
