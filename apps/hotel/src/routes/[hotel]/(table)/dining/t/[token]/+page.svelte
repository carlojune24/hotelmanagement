<script lang="ts">
	import { page } from '$app/state';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import CartBar from '$lib/components/table-order/cart-bar.svelte';
	import CartPanel from '$lib/components/table-order/cart-panel.svelte';
	import CartSheet from '$lib/components/table-order/cart-sheet.svelte';
	import { getTableCart } from '$lib/dining-cart.svelte';
	import { findPlainLine, quantityOf } from '$lib/dining-cart';
	import { checkAddonSelection } from '$lib/dining-orders';
	import { buildMenuSections, categoryChips, effectiveCategory, peso, visibleSections } from '$lib/dining-qr-ui';
	import { themeStyle } from '$lib/table-theme';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const hotel = $derived(page.data.hotel!);
	const cart = getTableCart();
	const themeVars = $derived(themeStyle(page.data.theme, page.data.branding));

	type Item = PageData['menu']['items'][number];
	type Group = PageData['menu']['groups'][number];

	// A reload or a trip to My orders and back keeps the cart; the stored lines are checked against this menu first.
	$effect(() => cart.hydrate({ items: data.menu.items, groups: data.menu.groups }));

	// ---- the menu, by category ------------------------------------------------------------------
	const sections = $derived(buildMenuSections(data.menu.categories, data.menu.items));
	const groupsFor = (item: Item): Group[] => data.menu.groups.filter((g) => item.addonGroupIds.includes(g.id));
	const chips = $derived(categoryChips(sections));

	// "All", then a chip per category: choosing one shows just that part of the menu.
	let selected = $state('all');
	const active = $derived(effectiveCategory(sections, selected));
	const shown = $derived(visibleSections(sections, selected));
	let menuTop = $state<HTMLElement>();
	function choose(id: string) {
		selected = id;
		editing = null;
		// A short category leaves the page shorter than where the guest was: bring them to the top of the dishes.
		const top = menuTop?.getBoundingClientRect().top ?? 0;
		if (top < 130) {
			const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
			window.scrollTo({ top: window.scrollY + top - 130, behavior: reduce ? 'auto' : 'smooth' });
		}
	}

	// ---- adding dishes ------------------------------------------------------------------------
	let editing = $state<{ item: Item; picks: Record<string, string[]>; quantity: number; remarks: string } | null>(null);
	let editError = $state('');
	let announce = $state('');
	let sheetOpen = $state(false);

	function startItem(item: Item) {
		if (!item.isAvailable) return;
		if (groupsFor(item).length === 0) {
			addPlain(item);
			return;
		}
		// A dish with choices opens its panel in place (no pop-up), a second tap closes it.
		editing = editing?.item.id === item.id ? null : { item, picks: {}, quantity: 1, remarks: '' };
		editError = '';
	}
	function addPlain(item: Item) {
		cart.add(item, [], 1, '');
		announce = `Added ${item.name}. ${quantityOf(cart.lines, item.id)} in your cart.`;
	}
	function stepPlain(item: Item, delta: number) {
		const line = findPlainLine(cart.lines, item.id);
		if (!line) return;
		cart.change(line.key, delta);
		const left = quantityOf(cart.lines, item.id);
		announce = left > 0 ? `${item.name}: ${left} in your cart.` : `Removed ${item.name}.`;
	}
	function togglePick(groupId: string, addonId: string, max: number | null) {
		if (!editing) return;
		const cur = editing.picks[groupId] ?? [];
		if (cur.includes(addonId)) editing.picks[groupId] = cur.filter((x) => x !== addonId);
		else if (max === 1) editing.picks[groupId] = [addonId];
		else editing.picks[groupId] = [...cur, addonId];
		editError = '';
	}
	function confirmEditing() {
		if (!editing) return;
		const groups = groupsFor(editing.item);
		const counts: Record<string, number> = {};
		for (const g of groups) counts[g.id] = (editing.picks[g.id] ?? []).length;
		const problem = checkAddonSelection(
			editing.item.name,
			groups.map((g) => ({ id: g.id, name: g.name, minChoices: g.minChoices, maxChoices: g.maxChoices })),
			counts
		);
		if (problem) {
			editError = problem;
			return;
		}
		const chosen = groups.flatMap((g) =>
			g.addons.filter((a) => (editing!.picks[g.id] ?? []).includes(a.id)).map((a) => ({ id: a.id, name: a.name, priceCentavos: a.priceCentavos }))
		);
		cart.add(editing.item, chosen, editing.quantity, editing.remarks.trim());
		announce = `Added ${editing.quantity} ${editing.item.name}.`;
		editing = null;
	}
	const rule = (g: Group) =>
		g.minChoices > 0
			? g.maxChoices === 1
				? 'choose 1'
				: `choose ${g.minChoices}${g.maxChoices ? `–${g.maxChoices}` : ' or more'}`
			: g.maxChoices
				? `optional, up to ${g.maxChoices}`
				: 'optional';
</script>

<svelte:head>
	<title>Menu · Table {page.data.table?.name ?? ''} — {hotel.name}</title>
</svelte:head>

<!-- Spoken only: "Added Pray Rays. 2 in your cart." -->
<p class="sr-only" aria-live="polite">{announce}</p>

<!-- Chips: All, then each category. Sticky under the top bar. -->
{#if chips.length > 0}
	<nav class="tq-chips" aria-label="Menu categories">
		<div class="tq-chips-inner">
			{#each chips as c (c.id)}
				<button type="button" class="tq-chip" class:is-on={active === c.id} aria-pressed={active === c.id} onclick={() => choose(c.id)}>{c.name}</button>
			{/each}
		</div>
	</nav>
{/if}

<main class="tq-main" class:has-bar={cart.lines.length > 0}>
	<!-- A warm welcome and the three steps, instead of a paragraph nobody reads. -->
	<section class="tq-hero" aria-labelledby="menu-title">
		<div class="tq-hero-weave" aria-hidden="true"></div>
		<p class="tq-hero-eyebrow">{page.data.table?.venueTitle} · Table {page.data.table?.name}</p>
		<h1 id="menu-title" class="ledger-display tq-title">What would you like?</h1>
		<ol class="tq-hero-steps">
			<li><span class="tq-step-num" aria-hidden="true">1</span> Choose your dishes</li>
			<li><span class="tq-step-num" aria-hidden="true">2</span> Place order</li>
			<li><span class="tq-step-num" aria-hidden="true">3</span> Pay at the Cash Desk</li>
		</ol>
	</section>

	<div class="tq-menu-grid">
		<div class="tq-menu" bind:this={menuTop}>
			{#each shown as section (section.id)}
				<section id="sec-{section.id}" class="tq-section" aria-label={section.name || 'Menu'}>
					{#if section.name}<h2 class="tq-section-title ledger-display">{section.name}</h2>{/if}
					<ul>
						{#each section.items as item (item.id)}
							{@const open = editing?.item.id === item.id}
							{@const hasChoices = groupsFor(item).length > 0}
							{@const plain = findPlainLine(cart.lines, item.id)}
							{@const inCart = quantityOf(cart.lines, item.id)}
							<li class="tq-dish" class:is-sold-out={!item.isAvailable}>
								<div class="tq-dish-top">
									<button
										type="button"
										class="tq-dish-main"
										disabled={!item.isAvailable}
										aria-expanded={hasChoices ? open : undefined}
										aria-label={item.isAvailable ? `${hasChoices ? 'Choose options for' : 'Add'} ${item.name}, ${peso(item.priceCentavos)}` : `${item.name}, sold out today`}
										onclick={() => startItem(item)}
									>
										<span class="tq-dish-name">{item.name}</span>
										{#if item.description}<span class="tq-dish-desc">{item.description}</span>{/if}
										{#if !item.isAvailable}<span class="tq-dish-flag">Sold out today</span>{/if}
									</button>
									{#if item.imageUrl}
										<span class="tq-dish-photo" aria-hidden="true">
											<img src={item.imageUrl} alt="" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
										</span>
									{/if}
								</div>

								<div class="tq-dish-foot">
									<span class="ledger-data tq-dish-price">{peso(item.priceCentavos)}</span>
									{#if item.isAvailable}
										{#if !hasChoices && plain}
											<div class="tq-stepper" role="group" aria-label="Quantity of {item.name}">
												<button type="button" aria-label={plain.quantity > 1 ? 'Fewer' : `Remove ${item.name}`} onclick={() => stepPlain(item, -1)}><MinusIcon class="size-4" /></button>
												<span class="ledger-data">{plain.quantity}</span>
												<button type="button" aria-label="More" disabled={plain.quantity >= 50} onclick={() => stepPlain(item, 1)}><PlusIcon class="size-4" /></button>
											</div>
										{:else}
											<button type="button" class="tq-add" class:has-count={inCart > 0} aria-label="{hasChoices ? 'Choose options for' : 'Add'} {item.name}" aria-expanded={hasChoices ? open : undefined} onclick={() => startItem(item)}>
												{#if hasChoices}
													{open ? 'Close' : 'Choose'}{#if inCart > 0 && !open}<span class="tq-add-count ledger-data">{inCart}</span>{/if}
												{:else}
													<PlusIcon class="size-4" aria-hidden="true" /> Add
												{/if}
											</button>
										{/if}
									{/if}
								</div>

								{#if open && editing}
									<div class="tq-addons">
										{#each groupsFor(item) as g (g.id)}
											<fieldset>
												<legend class="ledger-label">{g.name} <span class="tq-rule-note">· {rule(g)}</span></legend>
												<div class="tq-choices">
													{#each g.addons as a (a.id)}
														<Label class="tq-choice {a.isAvailable ? '' : 'is-off'}">
															<Checkbox checked={(editing.picks[g.id] ?? []).includes(a.id)} disabled={!a.isAvailable} onCheckedChange={() => togglePick(g.id, a.id, g.maxChoices)} />
															<span class="tq-choice-name">{a.name}</span>
															<span class="ledger-data tq-choice-price">{a.priceCentavos ? `+${peso(a.priceCentavos)}` : 'free'}</span>
														</Label>
													{/each}
												</div>
											</fieldset>
										{/each}
										<div>
											<Label for="line-note-{item.id}" class="ledger-label">A note for the kitchen (optional)</Label>
											<Input id="line-note-{item.id}" bind:value={editing.remarks} maxlength={300} placeholder="No onions, extra spicy" class="ledger-field tq-input" />
										</div>
										{#if editError}<p role="alert" class="tq-error-line">{editError}</p>{/if}
										<div class="tq-addons-foot">
											<div class="tq-stepper" role="group" aria-label="Quantity">
												<button type="button" aria-label="Fewer" disabled={editing.quantity <= 1} onclick={() => editing && editing.quantity > 1 && editing.quantity--}><MinusIcon class="size-4" /></button>
												<span class="ledger-data">{editing.quantity}</span>
												<button type="button" aria-label="More" disabled={editing.quantity >= 50} onclick={() => editing && editing.quantity < 50 && editing.quantity++}><PlusIcon class="size-4" /></button>
											</div>
											<button type="button" class="ledger-btn-primary tq-btn tq-btn-lg" onclick={confirmEditing}>Add to order</button>
										</div>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{:else}
				<p class="tq-empty">The menu is not available just now. Please ask your waiter.</p>
			{/each}
		</div>

		<!-- On a wide screen the cart is this side panel; on a phone it is the bottom bar and sheet below. -->
		<aside class="tq-aside" aria-label="Your new order">
			<div class="tq-aside-card">
				<h2 class="tq-aside-title">
					Your order
					{#if cart.totals.itemCount > 0}<span class="tq-count-pill">{cart.totals.itemCount} {cart.totals.itemCount === 1 ? 'item' : 'items'}</span>{/if}
				</h2>
				<CartPanel {cart} error={form?.error} idPrefix="aside" />
			</div>
		</aside>
	</div>
</main>

{#if cart.lines.length > 0}
	<CartBar count={cart.totals.itemCount} total={cart.totals.totalCentavos} onopen={() => (sheetOpen = true)} />
{/if}
<CartSheet bind:open={sheetOpen} {cart} error={form?.error} {themeVars} />
