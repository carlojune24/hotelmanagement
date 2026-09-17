<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import XIcon from '@lucide/svelte/icons/x';

	/**
	 * Tag-style inclusions editor — types + Add (or Enter) appends a chip instead
	 * of hand-typing a comma-separated string. Existing inclusion text already
	 * used elsewhere on this hotel's other rate plans is offered as suggestions
	 * while typing; picking one (or typing an exact case-insensitive match)
	 * appends that same canonical spelling instead of a near-duplicate variant —
	 * the actual standardization this replaces free-text CSV entry for.
	 * Submits as `name` on the form, comma-joined, matching the existing server
	 * `inclusionsCsv` contract unchanged.
	 */
	let {
		value = $bindable([]),
		suggestions = [],
		name,
		id,
		placeholder = 'e.g. Breakfast'
	}: {
		value?: string[];
		suggestions?: string[];
		name: string;
		id: string;
		placeholder?: string;
	} = $props();

	let draft = $state('');
	let showSuggestions = $state(false);

	const matches = $derived.by(() => {
		const q = draft.trim().toLowerCase();
		if (!q) return [];
		return suggestions
			.filter((s) => s.toLowerCase().includes(q))
			.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()))
			.slice(0, 6);
	});

	function addInclusion(raw: string) {
		const text = raw.trim();
		if (!text) return;
		// Prefer the already-used canonical spelling over whatever case the
		// staff happened to type, so the same inclusion never ends up spelled
		// two different ways across rate plans.
		const canonical = suggestions.find((s) => s.toLowerCase() === text.toLowerCase()) ?? text;
		if (value.some((v) => v.toLowerCase() === canonical.toLowerCase())) {
			draft = '';
			showSuggestions = false;
			return;
		}
		value = [...value, canonical];
		draft = '';
		showSuggestions = false;
	}

	function removeInclusion(text: string) {
		value = value.filter((v) => v !== text);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			addInclusion(draft);
		} else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
			value = value.slice(0, -1);
		}
	}
</script>

<div class="relative">
	<input type="hidden" {name} value={value.join(',')} />
	{#if value.length > 0}
		<div class="mb-1.5 flex flex-wrap gap-1.5">
			{#each value as item (item)}
				<span
					class="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 py-0.5 pr-1 pl-2.5 text-xs text-ink"
				>
					{item}
					<button
						type="button"
						onclick={() => removeInclusion(item)}
						class="rounded-full p-0.5 text-ink-muted hover:bg-surface hover:text-ink"
						aria-label="Remove {item}"
					>
						<XIcon class="size-3" />
					</button>
				</span>
			{/each}
		</div>
	{/if}
	<div class="flex gap-1.5">
		<Input
			{id}
			bind:value={draft}
			{placeholder}
			onkeydown={onKeydown}
			oninput={() => (showSuggestions = true)}
			onfocus={() => (showSuggestions = true)}
			onblur={() => setTimeout(() => (showSuggestions = false), 150)}
			class="flex-1"
		/>
		<Button type="button" variant="outline" onclick={() => addInclusion(draft)}>Add</Button>
	</div>
	{#if showSuggestions && matches.length > 0}
		<div
			class="absolute top-full right-0 left-0 z-10 mt-1 rounded-md border border-border bg-surface shadow-md"
		>
			{#each matches as m (m)}
				<button
					type="button"
					onclick={() => addInclusion(m)}
					class="block w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-surface-2"
				>
					{m}
				</button>
			{/each}
		</div>
	{/if}
</div>
