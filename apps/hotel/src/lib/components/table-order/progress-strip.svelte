<script lang="ts">
	import BellRingIcon from '@lucide/svelte/icons/bell-ring';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChefHatIcon from '@lucide/svelte/icons/chef-hat';
	import SendIcon from '@lucide/svelte/icons/send';
	import UtensilsIcon from '@lucide/svelte/icons/utensils';
	import { STEPS, stepIndex } from '$lib/dining-qr-ui';

	let { status }: { status: string } = $props();
	const at = $derived(stepIndex(status));
	const last = STEPS.length - 1;
</script>

{#if at >= 0}
	<!-- Where the order is on its way: Sent, Preparing, Ready, Served. The parent sets the status colour (tone-*). -->
	<ol class="tq-steps" aria-label="Order progress">
		{#each STEPS as label, i (label)}
			{@const done = i < at || at === last}
			<li class:is-done={done} class:is-current={i === at && at < last} aria-current={i === at ? 'step' : undefined}>
				<span class="tq-step-dot" aria-hidden="true">
					{#if done}<CheckIcon class="size-4" />
					{:else if i === 0}<SendIcon class="size-4" />
					{:else if i === 1}<ChefHatIcon class="size-4" />
					{:else if i === 2}<BellRingIcon class="size-4" />
					{:else}<UtensilsIcon class="size-4" />{/if}
				</span>
				<span class="tq-step-label">{label}</span>
			</li>
		{/each}
	</ol>
{/if}
