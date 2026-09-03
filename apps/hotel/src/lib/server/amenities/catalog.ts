import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../db/schema/index';
import { amenities } from '../db/schema/index';

type Category = (typeof schema.amenityCategory.enumValues)[number];
type Scope = (typeof schema.amenityScope.enumValues)[number];

export interface StandardAmenity {
	slug: string;
	name: string;
	icon: string;
	category: Category;
	scope: Scope;
}

/**
 * The default amenity list every hotel starts with. Seeded on hotel creation
 * and re-applied idempotently (match on `slug`), so adding a row here rolls it
 * out to hotels that don't already have that slug. Informational only — see the
 * note on the `amenities` table.
 */
export const STANDARD_AMENITIES: StandardAmenity[] = [
	// Connectivity
	{ slug: 'free-wifi', name: 'Free WiFi', icon: 'wifi', category: 'connectivity', scope: 'both' },
	{
		slug: 'wired-internet',
		name: 'Wired Internet',
		icon: 'ethernet-port',
		category: 'connectivity',
		scope: 'room_type'
	},

	// Comfort
	{
		slug: 'air-conditioning',
		name: 'Air Conditioning',
		icon: 'air-vent',
		category: 'comfort',
		scope: 'room_type'
	},
	{
		slug: 'heating',
		name: 'Heating',
		icon: 'thermometer-sun',
		category: 'comfort',
		scope: 'room_type'
	},
	{
		slug: 'ceiling-fan',
		name: 'Ceiling Fan',
		icon: 'fan',
		category: 'comfort',
		scope: 'room_type'
	},
	{
		slug: 'blackout-curtains',
		name: 'Blackout Curtains',
		icon: 'blinds',
		category: 'comfort',
		scope: 'room_type'
	},
	{
		slug: 'soundproofing',
		name: 'Soundproofing',
		icon: 'ear-off',
		category: 'comfort',
		scope: 'room_type'
	},
	{
		slug: 'work-desk',
		name: 'Work Desk',
		icon: 'lamp-desk',
		category: 'comfort',
		scope: 'room_type'
	},

	// Bathroom
	{
		slug: 'private-bathroom',
		name: 'Private Bathroom',
		icon: 'door-closed',
		category: 'bathroom',
		scope: 'room_type'
	},
	{ slug: 'bathtub', name: 'Bathtub', icon: 'bath', category: 'bathroom', scope: 'room_type' },
	{ slug: 'shower', name: 'Shower', icon: 'shower-head', category: 'bathroom', scope: 'room_type' },
	{ slug: 'hot-water', name: 'Hot Water', icon: 'flame', category: 'bathroom', scope: 'both' },
	{
		slug: 'hair-dryer',
		name: 'Hair Dryer',
		icon: 'wind',
		category: 'bathroom',
		scope: 'room_type'
	},
	{
		slug: 'free-toiletries',
		name: 'Free Toiletries',
		icon: 'droplets',
		category: 'bathroom',
		scope: 'room_type'
	},
	{ slug: 'bathrobes', name: 'Bathrobes', icon: 'shirt', category: 'bathroom', scope: 'room_type' },

	// Entertainment
	{
		slug: 'flat-screen-tv',
		name: 'Flat-screen TV',
		icon: 'tv',
		category: 'entertainment',
		scope: 'room_type'
	},
	{
		slug: 'cable-channels',
		name: 'Cable Channels',
		icon: 'tv-minimal',
		category: 'entertainment',
		scope: 'room_type'
	},
	{
		slug: 'streaming-services',
		name: 'Streaming Services',
		icon: 'play',
		category: 'entertainment',
		scope: 'room_type'
	},

	// Kitchen / Food
	{ slug: 'minibar', name: 'Minibar', icon: 'wine', category: 'kitchen', scope: 'room_type' },
	{
		slug: 'coffee-tea-maker',
		name: 'Coffee / Tea Maker',
		icon: 'coffee',
		category: 'kitchen',
		scope: 'room_type'
	},
	{
		slug: 'electric-kettle',
		name: 'Electric Kettle',
		icon: 'cooking-pot',
		category: 'kitchen',
		scope: 'room_type'
	},
	{
		slug: 'refrigerator',
		name: 'Refrigerator',
		icon: 'refrigerator',
		category: 'kitchen',
		scope: 'room_type'
	},
	{
		slug: 'kitchenette',
		name: 'Kitchenette',
		icon: 'utensils-crossed',
		category: 'kitchen',
		scope: 'room_type'
	},

	// Outdoor / View
	{
		slug: 'balcony',
		name: 'Balcony',
		icon: 'door-open',
		category: 'outdoor_view',
		scope: 'room_type'
	},
	{ slug: 'terrace', name: 'Terrace', icon: 'sun', category: 'outdoor_view', scope: 'room_type' },
	{
		slug: 'sea-view',
		name: 'Sea View',
		icon: 'waves',
		category: 'outdoor_view',
		scope: 'room_type'
	},
	{
		slug: 'city-view',
		name: 'City View',
		icon: 'building-2',
		category: 'outdoor_view',
		scope: 'room_type'
	},
	{
		slug: 'garden-view',
		name: 'Garden View',
		icon: 'trees',
		category: 'outdoor_view',
		scope: 'room_type'
	},
	{
		slug: 'swimming-pool',
		name: 'Swimming Pool',
		icon: 'waves',
		category: 'outdoor_view',
		scope: 'hotel'
	},
	{ slug: 'garden', name: 'Garden', icon: 'trees', category: 'outdoor_view', scope: 'hotel' },

	// Safety
	{
		slug: 'in-room-safe',
		name: 'In-room Safe',
		icon: 'lock',
		category: 'safety',
		scope: 'room_type'
	},
	{
		slug: 'smoke-detector',
		name: 'Smoke Detector',
		icon: 'alarm-smoke',
		category: 'safety',
		scope: 'both'
	},
	{
		slug: 'fire-extinguisher',
		name: 'Fire Extinguisher',
		icon: 'fire-extinguisher',
		category: 'safety',
		scope: 'both'
	},
	{
		slug: 'security-24h',
		name: '24-hour Security',
		icon: 'shield-check',
		category: 'safety',
		scope: 'hotel'
	},
	{ slug: 'cctv', name: 'CCTV in Common Areas', icon: 'cctv', category: 'safety', scope: 'hotel' },

	// Accessibility
	{
		slug: 'elevator',
		name: 'Elevator',
		icon: 'arrow-up-down',
		category: 'accessibility',
		scope: 'hotel'
	},
	{
		slug: 'step-free-access',
		name: 'Step-free Access',
		icon: 'accessibility',
		category: 'accessibility',
		scope: 'both'
	},

	// Services
	{
		slug: 'front-desk-24h',
		name: '24-hour Front Desk',
		icon: 'bell-ring',
		category: 'services',
		scope: 'hotel'
	},
	{
		slug: 'daily-housekeeping',
		name: 'Daily Housekeeping',
		icon: 'sparkles',
		category: 'services',
		scope: 'hotel'
	},
	{
		slug: 'parking',
		name: 'Parking',
		icon: 'circle-parking',
		category: 'services',
		scope: 'hotel'
	},
	{
		slug: 'airport-shuttle',
		name: 'Airport Shuttle',
		icon: 'bus-front',
		category: 'services',
		scope: 'hotel'
	},
	{
		slug: 'laundry-service',
		name: 'Laundry Service',
		icon: 'washing-machine',
		category: 'services',
		scope: 'hotel'
	},
	{
		slug: 'restaurant',
		name: 'On-site Restaurant',
		icon: 'utensils',
		category: 'services',
		scope: 'hotel'
	},
	{
		slug: 'room-service',
		name: 'Room Service',
		icon: 'concierge-bell',
		category: 'services',
		scope: 'hotel'
	},
	{
		slug: 'fitness-center',
		name: 'Fitness Center',
		icon: 'dumbbell',
		category: 'services',
		scope: 'hotel'
	},

	// General
	{
		slug: 'non-smoking-room',
		name: 'Non-smoking Room',
		icon: 'cigarette-off',
		category: 'general',
		scope: 'room_type'
	},
	{
		slug: 'family-rooms',
		name: 'Family Rooms',
		icon: 'users',
		category: 'general',
		scope: 'hotel'
	},
	{
		slug: 'pet-friendly',
		name: 'Pet Friendly',
		icon: 'paw-print',
		category: 'general',
		scope: 'hotel'
	}
];

/**
 * Insert any standard amenities the hotel is missing (matched on `slug`).
 * Idempotent — safe to call on every hotel creation and to re-run after the
 * catalogue grows. Existing rows (including hotel-customised ones) are untouched.
 */
export async function seedHotelAmenities(
	db: PostgresJsDatabase<typeof schema>,
	hotelId: string
): Promise<void> {
	await db
		.insert(amenities)
		.values(
			STANDARD_AMENITIES.map((a, i) => ({
				hotelId,
				slug: a.slug,
				name: a.name,
				icon: a.icon,
				category: a.category,
				scope: a.scope,
				sortOrder: i
			}))
		)
		.onConflictDoNothing({ target: [amenities.hotelId, amenities.slug] });
}

/** Human labels for the category enum, in display order. */
export const AMENITY_CATEGORY_LABELS: Record<Category, string> = {
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

export const AMENITY_CATEGORY_ORDER = Object.keys(AMENITY_CATEGORY_LABELS) as Category[];

/** Slugify a free-text amenity label for the CSV → master backfill and ad-hoc adds. */
export function amenitySlug(name: string): string {
	return (
		name
			.toLowerCase()
			.trim()
			.replace(/&/g, ' and ')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'amenity'
	);
}
