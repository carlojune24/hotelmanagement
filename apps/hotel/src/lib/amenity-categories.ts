/**
 * Client-safe copy of the amenity category labels/order. The canonical list
 * lives in `lib/server/amenities/catalog.ts` (server-only — importing it from
 * a `.svelte` file breaks SvelteKit's client/server boundary, the same class
 * of bug fixed in `$lib/branding.ts`), so the storefront's grouped "About"
 * section gets its own copy here. Keep the two in sync by hand if the
 * `amenity_category` enum ever changes.
 */
import type { Component } from 'svelte';
import WifiIcon from '@lucide/svelte/icons/wifi';
import ThermometerSunIcon from '@lucide/svelte/icons/thermometer-sun';
import BathIcon from '@lucide/svelte/icons/bath';
import TvIcon from '@lucide/svelte/icons/tv';
import UtensilsCrossedIcon from '@lucide/svelte/icons/utensils-crossed';
import TreesIcon from '@lucide/svelte/icons/trees';
import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
import AccessibilityIcon from '@lucide/svelte/icons/accessibility';
import ConciergeBellIcon from '@lucide/svelte/icons/concierge-bell';
import PawPrintIcon from '@lucide/svelte/icons/paw-print';

export const AMENITY_CATEGORY_LABELS: Record<string, string> = {
	connectivity: 'Connectivity',
	comfort: 'Comfort',
	bathroom: 'Bathroom',
	entertainment: 'Entertainment',
	kitchen: 'Kitchen & Food',
	outdoor_view: 'Outdoor & View',
	safety: 'Safety',
	accessibility: 'Accessibility',
	services: 'Services',
	general: 'General'
};

export const AMENITY_CATEGORY_ORDER = Object.keys(AMENITY_CATEGORY_LABELS);

/** One representative icon per category, for the storefront's Amenities card
    badges — a category-level mark, distinct from each item's own `amenities.icon`. */
export const AMENITY_CATEGORY_ICONS: Record<string, Component> = {
	connectivity: WifiIcon,
	comfort: ThermometerSunIcon,
	bathroom: BathIcon,
	entertainment: TvIcon,
	kitchen: UtensilsCrossedIcon,
	outdoor_view: TreesIcon,
	safety: ShieldCheckIcon,
	accessibility: AccessibilityIcon,
	services: ConciergeBellIcon,
	general: PawPrintIcon
};
