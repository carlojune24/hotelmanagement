<script lang="ts">
	import { Combobox } from 'bits-ui';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';

	/**
	 * Pick a saved vendor or type a one-off name. Posts the text as `name`; the server matches it to a
	 * saved vendor case-insensitively, otherwise keeps it as a one-off name (Expenses, Inventory → Restock).
	 */
	let {
		vendors,
		value = $bindable(''),
		id,
		name = 'vendor'
	}: { vendors: { id: string; name: string }[]; value?: string; id: string; name?: string } = $props();

	const matches = $derived(vendors.filter((v) => v.name.toLowerCase().includes(value.trim().toLowerCase())));
	const exact = $derived(vendors.some((v) => v.name.toLowerCase() === value.trim().toLowerCase()));
</script>

<Combobox.Root type="single" inputValue={value} onValueChange={(v) => (value = v)}>
	<div class="relative mt-1">
		<Combobox.Input
			{id}
			maxlength={200}
			placeholder="Pick a saved vendor or type a name"
			oninput={(e) => (value = e.currentTarget.value)}
			class="h-9 w-full min-w-0 rounded-md border border-input bg-transparent py-1 pr-9 pl-2.5 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
		/>
		<Combobox.Trigger aria-label="Show saved vendors" class="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-ink-muted hover:text-ink">
			<ChevronsUpDownIcon class="size-4" aria-hidden="true" />
		</Combobox.Trigger>
	</div>
	<Combobox.Portal>
		<Combobox.Content
			sideOffset={4}
			class="z-50 max-h-64 w-(--bits-combobox-anchor-width) min-w-48 overflow-y-auto rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
		>
			{#each matches as v (v.id)}
				<Combobox.Item
					value={v.name}
					label={v.name}
					class="relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
				>
					{#snippet children({ selected })}
						{v.name}
						{#if selected}<CheckIcon class="absolute right-2 size-4" aria-hidden="true" />{/if}
					{/snippet}
				</Combobox.Item>
			{/each}
			{#if value.trim() && !exact}
				<p class="px-2 py-1.5 text-sm text-ink-muted">Use “{value.trim()}” as a one-off vendor</p>
			{:else if matches.length === 0}
				<p class="px-2 py-1.5 text-sm text-ink-muted">No saved vendors yet — type a name.</p>
			{/if}
		</Combobox.Content>
	</Combobox.Portal>
</Combobox.Root>
<input type="hidden" {name} {value} />
