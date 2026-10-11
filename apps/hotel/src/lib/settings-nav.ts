/**
 * The Settings area's navigation: one table of every configuration page, grouped, each entry gated
 * by the SAME capability the destination page already enforces. The nav is only a view of existing
 * permissions — pages keep their own `requireCap`. Pure helpers, safe on client and server.
 *
 * An entry is either a page under `/settings` or a **link-out** to a page that still lives in its own
 * module (Dining, Kitchen, Finance, HR). `href` is relative to `/{slug}/management`.
 */
import { roleCan } from '$lib/authz';
import type { Component } from 'svelte';
import BedIcon from '@lucide/svelte/icons/bed';
import WalletIcon from '@lucide/svelte/icons/wallet';
import SparklesIcon from '@lucide/svelte/icons/sparkles';
import PaletteIcon from '@lucide/svelte/icons/palette';
import PartyPopperIcon from '@lucide/svelte/icons/party-popper';
import ClockIcon from '@lucide/svelte/icons/clock';
import CreditCardIcon from '@lucide/svelte/icons/credit-card';
import GemIcon from '@lucide/svelte/icons/gem';
import ZapIcon from '@lucide/svelte/icons/zap';
import UsersIcon from '@lucide/svelte/icons/users';
import CalendarOffIcon from '@lucide/svelte/icons/calendar-off';
import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
import StoreIcon from '@lucide/svelte/icons/store';
import UtensilsIcon from '@lucide/svelte/icons/utensils';
import CirclePlusIcon from '@lucide/svelte/icons/circle-plus';
import QrCodeIcon from '@lucide/svelte/icons/qr-code';
import ChefHatIcon from '@lucide/svelte/icons/chef-hat';
import SlidersIcon from '@lucide/svelte/icons/sliders-horizontal';
import FileTextIcon from '@lucide/svelte/icons/file-text';
import BookOpenIcon from '@lucide/svelte/icons/book-open';
import KeyRoundIcon from '@lucide/svelte/icons/key-round';
import UploadIcon from '@lucide/svelte/icons/upload';
import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
import SearchIcon from '@lucide/svelte/icons/search';

export type SettingsGroupId = 'property' | 'rates' | 'dining' | 'finance' | 'people' | 'system';

export const SETTINGS_GROUPS: { id: SettingsGroupId; label: string }[] = [
	{ id: 'property', label: 'Property' },
	{ id: 'rates', label: 'Rates & sales' },
	{ id: 'dining', label: 'Dining & kitchen' },
	{ id: 'finance', label: 'Finance & tax' },
	{ id: 'people', label: 'People' },
	{ id: 'system', label: 'System' }
];

export interface SettingsEntry {
	id: string;
	group: SettingsGroupId;
	label: string;
	desc: string;
	/** Relative to `/{slug}/management`. */
	href: string;
	icon: Component<{ class?: string }>;
	/** Capabilities that reveal this entry; holding ANY one is enough (mirrors the page's own guard). */
	anyOf: string[];
	/** The page lives in another module for now; the nav shows an "opens in its module" marker. */
	linkOut?: boolean;
	/**
	 * A shortcut, not configuration the person manages from here: it is listed once they are in
	 * Settings, but never on its own gives them the "Settings" sidebar item (e.g. the read-only
	 * BIR setup view that every finance reader may open).
	 */
	passive?: boolean;
}

const ADMIN = 'hotel:admin';

export const SETTINGS_ENTRIES: SettingsEntry[] = [
	// ---- Property ----
	{
		id: 'branding',
		group: 'property',
		label: 'Branding & website',
		desc: 'Logo, accent color, hero image, and tagline for your public booking page.',
		href: 'settings/branding',
		icon: PaletteIcon,
		anyOf: [ADMIN]
	},
	{
		id: 'check-in-out',
		group: 'property',
		label: 'Check-in & check-out',
		desc: 'Standard times and extension fees your front desk works from.',
		href: 'settings/check-in-out',
		icon: ClockIcon,
		anyOf: [ADMIN]
	},
	{
		id: 'rooms',
		group: 'property',
		label: 'Room types & rooms',
		desc: 'The room types you sell and the physical rooms behind them.',
		href: 'settings/rooms',
		icon: BedIcon,
		anyOf: [ADMIN]
	},
	{
		id: 'amenities',
		group: 'property',
		label: 'Amenities',
		desc: 'The master list of features shown on your hotel page and room listings.',
		href: 'settings/amenities',
		icon: SparklesIcon,
		anyOf: [ADMIN]
	},
	{
		id: 'function-halls',
		group: 'property',
		label: 'Function hall',
		desc: 'The event space you rent by the hour, its pricing, and included services.',
		href: 'settings/function-halls',
		icon: PartyPopperIcon,
		anyOf: [ADMIN]
	},

	// ---- Rates & sales ----
	{
		id: 'rates',
		group: 'rates',
		label: 'Rates & policies',
		desc: 'Rate plans, seasonal price overrides, cancellation and deposit policies, promo codes.',
		href: 'settings/rates',
		icon: WalletIcon,
		anyOf: [ADMIN]
	},
	{
		id: 'amenity-items',
		group: 'rates',
		label: 'Sellable items',
		desc: 'Priced extras front desk can charge to a guest’s folio — minibar, spa, damages.',
		href: 'settings/amenity-items',
		icon: GemIcon,
		anyOf: [ADMIN]
	},

	// ---- Dining & kitchen ----
	{
		id: 'dining-venues',
		group: 'dining',
		label: 'Venues & page',
		desc: 'Restaurants and bars, online ordering, delivery fee, order-ahead days, reservations.',
		href: 'dining/settings',
		icon: StoreIcon,
		anyOf: [ADMIN],
		linkOut: true
	},
	{
		id: 'dining-menu',
		group: 'dining',
		label: 'Menu',
		desc: 'Dishes, prices, categories, and the kitchen station each one is made at.',
		href: 'dining/menu',
		icon: UtensilsIcon,
		anyOf: [ADMIN, 'dining:manage'],
		linkOut: true
	},
	{
		id: 'dining-addons',
		group: 'dining',
		label: 'Add-ons',
		desc: 'Extras guests can add to a dish — sizes, sides, upgrades.',
		href: 'dining/addons',
		icon: CirclePlusIcon,
		anyOf: [ADMIN, 'dining:manage'],
		linkOut: true
	},
	{
		id: 'dining-floor-qr',
		group: 'dining',
		label: 'Floor layout & QR codes',
		desc: 'Areas, tables, and the QR code for each table.',
		href: 'dining/floor/qr',
		icon: QrCodeIcon,
		anyOf: [ADMIN, 'dining:manage'],
		linkOut: true
	},
	{
		id: 'kitchen-stations',
		group: 'dining',
		label: 'Kitchen stations',
		desc: 'The stations dishes are cooked at, such as Hot section or Bar.',
		href: 'kitchen/stations',
		icon: ChefHatIcon,
		anyOf: [ADMIN, 'kitchen:manage'],
		linkOut: true
	},

	// ---- Finance & tax ----
	{
		id: 'finance-settings',
		group: 'finance',
		label: 'Finance preferences',
		desc: 'Hotel details and VAT, cash accounts, expense categories, vendors, API keys.',
		href: 'finance/settings',
		icon: SlidersIcon,
		anyOf: [ADMIN],
		linkOut: true
	},
	{
		id: 'payments-email',
		group: 'finance',
		label: 'Payments & email',
		desc: 'Your PayMongo account for online payment, and the mailbox guest email comes from.',
		href: 'settings/payments-email',
		icon: CreditCardIcon,
		anyOf: [ADMIN]
	},
	{
		id: 'bir-setup',
		group: 'finance',
		label: 'BIR setup & series',
		desc: 'Registered tax identity and the official receipt / invoice number series.',
		href: 'finance/bir/setup',
		icon: FileTextIcon,
		anyOf: ['finance:read'],
		linkOut: true,
		passive: true
	},
	{
		id: 'chart-of-accounts',
		group: 'finance',
		label: 'Chart of accounts',
		desc: 'The accounts finance reports are grouped by (view only).',
		href: 'finance/accounts',
		icon: BookOpenIcon,
		anyOf: ['finance:read'],
		linkOut: true,
		passive: true
	},

	// ---- People ----
	{
		id: 'team',
		group: 'people',
		label: 'Team',
		desc: 'Invite staff to this hotel and manage their roles.',
		href: 'settings/team',
		icon: UsersIcon,
		anyOf: ['team:*']
	},
	{
		id: 'team-roles',
		group: 'people',
		label: 'Roles & permissions',
		desc: 'What each role can see and do in this hotel.',
		href: 'settings/team/roles',
		icon: KeyRoundIcon,
		anyOf: ['team:*']
	},
	{
		id: 'leave',
		group: 'people',
		label: 'Leave & holidays',
		desc: 'Leave types and their rules, plus the holiday and memorandum calendar.',
		href: 'settings/leave',
		icon: CalendarOffIcon,
		anyOf: ['leave:*']
	},
	{
		id: 'hr-shifts',
		group: 'people',
		label: 'Shift templates',
		desc: 'The reusable shifts employee schedules are built from (on the Schedule page).',
		href: 'hr/schedule',
		icon: CalendarClockIcon,
		anyOf: ['schedule:*'],
		linkOut: true,
		passive: true
	},
	{
		id: 'hr-biometric',
		group: 'people',
		label: 'Biometric import',
		desc: 'Import templates for time-clock files (on the DTR page).',
		href: 'hr/dtr/biometric',
		icon: UploadIcon,
		anyOf: ['dtr:*'],
		linkOut: true,
		passive: true
	},

	// ---- System ----
	{
		id: 'automation',
		group: 'system',
		label: 'Automation',
		desc: 'Background jobs that run on a schedule instead of a manual button.',
		href: 'settings/automation',
		icon: ZapIcon,
		anyOf: [ADMIN]
	},
	{
		id: 'audit',
		group: 'system',
		label: 'Audit log',
		desc: 'Who changed what, and when, across the hotel.',
		href: 'settings/audit',
		icon: ShieldCheckIcon,
		anyOf: [ADMIN]
	},
	{
		id: 'lookup',
		group: 'system',
		label: 'Find by number',
		desc: 'Look up a booking, order, receipt or deposit by its number.',
		href: 'lookup',
		icon: SearchIcon,
		anyOf: ['booking:read', 'dining:read', 'finance:read'],
		linkOut: true,
		passive: true
	}
];

function canSee(entry: SettingsEntry, caps: string[], isPlatformAdmin: boolean): boolean {
	return isPlatformAdmin || entry.anyOf.some((cap) => roleCan(caps, cap));
}

/** The entries this person may open, in table order. */
export function visibleSettingsEntries(
	caps: string[] | null | undefined,
	isPlatformAdmin = false
): SettingsEntry[] {
	if (!isPlatformAdmin && !caps) return [];
	return SETTINGS_ENTRIES.filter((e) => canSee(e, caps ?? [], isPlatformAdmin));
}

/**
 * Whether the person manages any configuration from Settings — the test for showing the "Settings"
 * sidebar item and for entering `/settings/**`. Passive shortcuts do not count, so a front-desk
 * account (which may read finance) does not get a Settings item that only holds links to read-only pages.
 */
export function canOpenSettings(caps: string[] | null | undefined, isPlatformAdmin = false): boolean {
	return visibleSettingsEntries(caps, isPlatformAdmin).some((e) => !e.passive);
}

/** Visible entries grouped for rendering; empty groups are dropped. */
export function groupSettingsEntries(entries: SettingsEntry[]) {
	return SETTINGS_GROUPS.map((g) => ({
		...g,
		entries: entries.filter((e) => e.group === g.id)
	})).filter((g) => g.entries.length > 0);
}
