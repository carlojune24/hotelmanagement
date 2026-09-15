<script lang="ts">
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

	let {
		images,
		index = $bindable(null)
	}: {
		images: string[];
		/** The open photo's position in `images` — `null` means closed. Bindable so a caller
		    can open it at a specific photo (e.g. the one just clicked in a grid). */
		index: number | null;
	} = $props();

	const hasMultiple = $derived(images.length > 1);

	function close() {
		index = null;
	}
	function stepPrev() {
		if (index != null) index = (index - 1 + images.length) % images.length;
	}
	function stepNext() {
		if (index != null) index = (index + 1) % images.length;
	}
	function prev(e: MouseEvent) {
		e.stopPropagation();
		stepPrev();
	}
	function next(e: MouseEvent) {
		e.stopPropagation();
		stepNext();
	}
	function stopClick(e: MouseEvent) {
		e.stopPropagation();
	}
	/** A photo that fails to load (fake seed URLs, a stale hotel-set link) hides itself
	    rather than showing a broken-image icon — same convention as every gallery grid. */
	function hidePhoto(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (index == null) return;
		if (e.key === 'Escape') close();
		else if (hasMultiple && e.key === 'ArrowLeft') stepPrev();
		else if (hasMultiple && e.key === 'ArrowRight') stepNext();
	}}
/>

{#if index != null}
	{@const current = images[index]!}
	<div
		class="storefront-lightbox"
		role="button"
		tabindex="0"
		aria-label="Close photo"
		onclick={close}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') close();
		}}
	>
		<button type="button" class="storefront-lightbox-close" onclick={close}>
			Close ✕
		</button>

		<div class="storefront-lightbox-stage" onclick={stopClick} role="presentation">
			{#if hasMultiple}
				<button
					type="button"
					class="storefront-lightbox-arrow is-prev"
					onclick={prev}
					aria-label="Previous photo"
				>
					<ChevronLeftIcon aria-hidden="true" />
				</button>
			{/if}
			<img src={current} alt="" onerror={hidePhoto} />
			{#if hasMultiple}
				<button
					type="button"
					class="storefront-lightbox-arrow is-next"
					onclick={next}
					aria-label="Next photo"
				>
					<ChevronRightIcon aria-hidden="true" />
				</button>
			{/if}
		</div>

		{#if hasMultiple}
			<div class="storefront-lightbox-thumbs" onclick={stopClick}>
				{#each images as url, i (url + i)}
					<button
						type="button"
						class="storefront-lightbox-thumb {i === index ? 'is-active' : ''}"
						onclick={() => (index = i)}
						aria-label="Photo {i + 1} of {images.length}"
					>
						<img src={url} alt="" loading="lazy" onerror={hidePhoto} />
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}
