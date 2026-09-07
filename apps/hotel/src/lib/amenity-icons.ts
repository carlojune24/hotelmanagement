/**
 * Maps an `amenities.icon` value (a Lucide icon name, e.g. "wifi" — see
 * `lib/server/amenities/catalog.ts`) to its Svelte component, for the
 * storefront's amenity chips. Covers every icon in `STANDARD_AMENITIES`;
 * an admin-entered custom icon name that isn't in this map falls back to
 * `FallbackAmenityIcon` rather than breaking the render.
 */
import type { Component } from 'svelte';
import AccessibilityIcon from '@lucide/svelte/icons/accessibility';
import AirVentIcon from '@lucide/svelte/icons/air-vent';
import AlarmSmokeIcon from '@lucide/svelte/icons/alarm-smoke';
import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
import BathIcon from '@lucide/svelte/icons/bath';
import BellRingIcon from '@lucide/svelte/icons/bell-ring';
import BlindsIcon from '@lucide/svelte/icons/blinds';
import Building2Icon from '@lucide/svelte/icons/building-2';
import BusFrontIcon from '@lucide/svelte/icons/bus-front';
import CctvIcon from '@lucide/svelte/icons/cctv';
import CigaretteOffIcon from '@lucide/svelte/icons/cigarette-off';
import CircleParkingIcon from '@lucide/svelte/icons/circle-parking';
import CoffeeIcon from '@lucide/svelte/icons/coffee';
import ConciergeBellIcon from '@lucide/svelte/icons/concierge-bell';
import CookingPotIcon from '@lucide/svelte/icons/cooking-pot';
import DoorClosedIcon from '@lucide/svelte/icons/door-closed';
import DoorOpenIcon from '@lucide/svelte/icons/door-open';
import DropletsIcon from '@lucide/svelte/icons/droplets';
import DumbbellIcon from '@lucide/svelte/icons/dumbbell';
import EarOffIcon from '@lucide/svelte/icons/ear-off';
import EthernetPortIcon from '@lucide/svelte/icons/ethernet-port';
import FanIcon from '@lucide/svelte/icons/fan';
import FireExtinguisherIcon from '@lucide/svelte/icons/fire-extinguisher';
import FlameIcon from '@lucide/svelte/icons/flame';
import LampDeskIcon from '@lucide/svelte/icons/lamp-desk';
import LockIcon from '@lucide/svelte/icons/lock';
import PawPrintIcon from '@lucide/svelte/icons/paw-print';
import PlayIcon from '@lucide/svelte/icons/play';
import RefrigeratorIcon from '@lucide/svelte/icons/refrigerator';
import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
import ShirtIcon from '@lucide/svelte/icons/shirt';
import ShowerHeadIcon from '@lucide/svelte/icons/shower-head';
import SparklesIcon from '@lucide/svelte/icons/sparkles';
import SunIcon from '@lucide/svelte/icons/sun';
import ThermometerSunIcon from '@lucide/svelte/icons/thermometer-sun';
import TreesIcon from '@lucide/svelte/icons/trees';
import TvIcon from '@lucide/svelte/icons/tv';
import TvMinimalIcon from '@lucide/svelte/icons/tv-minimal';
import UsersIcon from '@lucide/svelte/icons/users';
import UtensilsIcon from '@lucide/svelte/icons/utensils';
import UtensilsCrossedIcon from '@lucide/svelte/icons/utensils-crossed';
import WashingMachineIcon from '@lucide/svelte/icons/washing-machine';
import WavesIcon from '@lucide/svelte/icons/waves';
import WifiIcon from '@lucide/svelte/icons/wifi';
import WindIcon from '@lucide/svelte/icons/wind';
import WineIcon from '@lucide/svelte/icons/wine';

export const FallbackAmenityIcon: Component = SparklesIcon;

export const AMENITY_ICONS: Record<string, Component> = {
	wifi: WifiIcon,
	'ethernet-port': EthernetPortIcon,
	'air-vent': AirVentIcon,
	'thermometer-sun': ThermometerSunIcon,
	fan: FanIcon,
	blinds: BlindsIcon,
	'ear-off': EarOffIcon,
	'lamp-desk': LampDeskIcon,
	'door-closed': DoorClosedIcon,
	bath: BathIcon,
	'shower-head': ShowerHeadIcon,
	flame: FlameIcon,
	wind: WindIcon,
	droplets: DropletsIcon,
	shirt: ShirtIcon,
	tv: TvIcon,
	'tv-minimal': TvMinimalIcon,
	play: PlayIcon,
	wine: WineIcon,
	coffee: CoffeeIcon,
	'cooking-pot': CookingPotIcon,
	refrigerator: RefrigeratorIcon,
	'utensils-crossed': UtensilsCrossedIcon,
	'door-open': DoorOpenIcon,
	sun: SunIcon,
	waves: WavesIcon,
	'building-2': Building2Icon,
	trees: TreesIcon,
	lock: LockIcon,
	'alarm-smoke': AlarmSmokeIcon,
	'fire-extinguisher': FireExtinguisherIcon,
	'shield-check': ShieldCheckIcon,
	cctv: CctvIcon,
	'arrow-up-down': ArrowUpDownIcon,
	accessibility: AccessibilityIcon,
	'bell-ring': BellRingIcon,
	sparkles: SparklesIcon,
	'circle-parking': CircleParkingIcon,
	'bus-front': BusFrontIcon,
	'washing-machine': WashingMachineIcon,
	utensils: UtensilsIcon,
	'concierge-bell': ConciergeBellIcon,
	dumbbell: DumbbellIcon,
	'cigarette-off': CigaretteOffIcon,
	users: UsersIcon,
	'paw-print': PawPrintIcon
};

export function amenityIcon(icon: string | null | undefined): Component {
	return (icon && AMENITY_ICONS[icon]) || FallbackAmenityIcon;
}
