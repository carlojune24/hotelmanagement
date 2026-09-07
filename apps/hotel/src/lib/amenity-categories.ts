/**
 * Client-safe copy of the amenity category labels/order. The canonical list
 * lives in `lib/server/amenities/catalog.ts` (server-only — importing it from
 * a `.svelte` file breaks SvelteKit's client/server boundary, the same class
 * of bug fixed in `$lib/branding.ts`), so the storefront's grouped "About"
 * section gets its own copy here. Keep the two in sync by hand if the
 * `amenity_category` enum ever changes.
 */

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
