<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import * as Accordion from '$lib/components/ui/accordion/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import SearchIcon from '@lucide/svelte/icons/search';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import BanknoteIcon from '@lucide/svelte/icons/banknote';
	import PartyPopperIcon from '@lucide/svelte/icons/party-popper';
	import ReceiptIcon from '@lucide/svelte/icons/receipt';
	import PaymentFields from '$lib/components/staff/payment-fields.svelte';
	import WalkinPaymentFields from '$lib/components/staff/walkin-payment-fields.svelte';
	import IdCameraCapture from '$lib/components/staff/id-camera-capture.svelte';
	import AvailabilityCalendarSheet, {
		type AvailabilityTarget
	} from '$lib/components/staff/availability-calendar-sheet.svelte';
	import CalendarRangeIcon from '@lucide/svelte/icons/calendar-range';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import XIcon from '@lucide/svelte/icons/x';
	import CheckIcon from '@lucide/svelte/icons/check';
	import MousePointerClickIcon from '@lucide/svelte/icons/mouse-pointer-click';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import type { ActionData, PageData } from './$types';
	import type {
		HallGridCell,
		RoomGridCell,
		WalkInAvailabilityCheckResult
	} from '$lib/server/front-desk';
	import type { HallPriceBreakdown } from '$lib/server/pricing';
	import type { AvailableRatePlan, AvailableRoomType } from '$lib/server/availability';
	import type { PriceBreakdown } from '$lib/server/pricing';
	import { MAX_ROOMS_PER_LINE, addFlatFeeCentavos, scaleRoomPrice } from '$lib/pricing-utils';
	import { resolveOccupancyPlan } from '$lib/occupancy';
	import { suggestedExtensionHours } from '$lib/extension-hours';
	import { AMENITY_CATEGORY_LABELS, AMENITY_CATEGORY_ORDER } from '$lib/amenity-categories';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}`);
	/** Staff-app links from this page (finance, reservations, settings, its own API) — as
	    opposed to `base`, still used bare for the print routes and the one guest-facing
	    room-detail link, neither of which live under `/management`. */
	const staffBase = $derived(`${base}/management`);
	const peso = (centavos: number) => `₱${(centavos / 100).toFixed(2)}`;
	const canChargeCityLedger = $derived(data.role?.slug === 'hotel_admin');

	const formOk = $derived(form && 'ok' in form ? form.ok : undefined);
	const formError = $derived(form && 'error' in form ? form.error : undefined);
	const formPaymentOk = $derived(form && 'paymentOk' in form ? form.paymentOk : undefined);
	const formShiftError = $derived(form && 'shiftError' in form ? form.shiftError : undefined);
	const formWalkInError = $derived(form && 'walkInError' in form ? form.walkInError : undefined);
	const formWalkInSearch = $derived(form && 'walkInSearch' in form ? form.walkInSearch : undefined);
	const formAvailableRoomTypes = $derived(
		form && 'availableRoomTypes' in form ? form.availableRoomTypes : undefined
	);
	const formUnpaidHolds = $derived(
		form && 'unpaidHolds' in form ? (form.unpaidHolds ?? []) : []
	);
	const holdTime = (iso: string) =>
		new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
	const formSuggestedRoomCount = $derived(
		form && 'suggestedRoomCount' in form ? form.suggestedRoomCount : null
	);
	const formWalkInPreview = $derived(
		form && 'walkInPreview' in form ? form.walkInPreview : undefined
	);
	const formWalkInPreviewError = $derived(
		form && 'walkInPreviewError' in form ? form.walkInPreviewError : undefined
	);
	const formRoomDetail = $derived(form && 'roomDetail' in form ? form.roomDetail : undefined);
	const formRoomTypeDetail = $derived(
		form && 'roomTypeDetail' in form ? form.roomTypeDetail : undefined
	);
	const formFolio = $derived(form && 'folio' in form ? form.folio : undefined);
	const formFolioError = $derived(form && 'folioError' in form ? form.folioError : undefined);
	const formSecurityDeposit = $derived(
		form && 'securityDeposit' in form ? form.securityDeposit : undefined
	);
	const formDepositOk = $derived(form && 'depositOk' in form ? form.depositOk : undefined);
	/** Part of the folio's payments that is really the security deposit kept for damage (a
	 *  `security_deposit`-method row) — shown as its own line, not folded into "Paid". */
	const depositAppliedCentavos = $derived(
		(formRoomDetail?.payments ?? [])
			.filter((p: { method: string; status: string; voidedAt: unknown }) => p.method === 'security_deposit' && p.status === 'paid' && !p.voidedAt)
			.reduce((sum: number, p: { amountCentavos: number }) => sum + p.amountCentavos, 0)
	);
	const formHallBookingDetail = $derived(
		form && 'hallBookingDetail' in form ? form.hallBookingDetail : undefined
	);
	const formHallFolio = $derived(form && 'hallFolio' in form ? form.hallFolio : undefined);
	const formHallWalkInError = $derived(
		form && 'hallWalkInError' in form ? form.hallWalkInError : undefined
	);
	const formHallWalkInOk = $derived(form && 'hallWalkInOk' in form ? form.hallWalkInOk : undefined);
	const formIdPhotoOk = $derived(form && 'idPhotoOk' in form ? form.idPhotoOk : undefined);
	const formIdPhotoError = $derived(form && 'idPhotoError' in form ? form.idPhotoError : undefined);

	$effect(() => {
		if (formOk) toast.success(formOk);
		if (formError) toast.error(formError);
		if (formPaymentOk) {
			toast.success(formPaymentOk);
			roomPayOpen = false;
			roomRefundOpen = false;
			hallPayOpen = false;
			hallRefundOpen = false;
		}
		if (formShiftError) toast.error(formShiftError);
		if (formWalkInError) toast.error(formWalkInError);
		if (formWalkInPreviewError) toast.error(formWalkInPreviewError);
		if (formFolioError) toast.error(formFolioError);
		if (formHallWalkInError) toast.error(formHallWalkInError);
		if (formHallWalkInOk) {
			toast.success(formHallWalkInOk);
			hallWalkInOpen = false;
		}
		if (formIdPhotoOk) {
			toast.success('ID photo saved.');
			idCaptureOpen = false;
		}
		if (formDepositOk) toast.success(formDepositOk);
		if (formIdPhotoError) toast.error(formIdPhotoError);
		// Check-out ends the in-house view — deselect the room instead of leaving the
		// rail showing a folio for a booking that's no longer checked in.
		if (form && 'checkedOut' in form) {
			checkoutCityLedger = false;
			selectedRoomId = null;
		}
	});

	// Folio/payments/history for the selected occupied room now render inline in the
	// right rail (no more "Full details" dialog) — fetched automatically the moment a
	// new room is selected, via a hidden form posting the same `?/roomDetail` action
	// every folio/payment mutation already returns fresh data from.
	let roomDetailFormEl = $state<HTMLFormElement>();
	let roomDetailBookingId = $state('');
	let loadedRoomDetailFor = $state<string | null>(null);
	$effect(() => {
		const bookingId = selectedRoom?.occupant?.bookingId ?? null;
		if (!bookingId) {
			loadedRoomDetailFor = null;
			return;
		}
		// Also refetch when the last action handed back ANOTHER booking's folio (e.g. charging a
		// damage report filed against an earlier stay in this room) — otherwise the panel waits
		// forever on "Loading folio…" because the selection itself never changed.
		const shownFor = formRoomDetail?.booking.id ?? null;
		if (bookingId !== loadedRoomDetailFor || (shownFor !== null && shownFor !== bookingId)) {
			loadedRoomDetailFor = bookingId;
			roomDetailBookingId = bookingId;
			idCaptureOpen = false;
			tick().then(() => roomDetailFormEl?.requestSubmit());
		}
	});

	// Folio payment / refund panels (room + hall dialogs), and the checkout city-ledger form.
	let roomPayOpen = $state(false);
	let roomRefundOpen = $state(false);
	let idCaptureOpen = $state(false);
	let hallPayOpen = $state(false);
	let hallRefundOpen = $state(false);
	let checkoutCityLedger = $state(false);
	let shiftFloat = $state('');
	let shiftDrawer = $state('');

	let hallDetailDialogOpen = $state(false);
	$effect(() => {
		if (formHallBookingDetail) hallDetailDialogOpen = true;
	});

	// --- Room-type detail dialog (click a room's name to view its full spec/gallery) ---
	let roomTypeDetailOpen = $state(false);
	let roomTypeDetailFormEl = $state<HTMLFormElement>();
	let roomTypeDetailRoomTypeId = $state('');
	let roomTypeDetailActivePhoto = $state(0);
	$effect(() => {
		if (formRoomTypeDetail) {
			roomTypeDetailOpen = true;
			roomTypeDetailActivePhoto = 0;
		}
	});
	function openRoomTypeDetail(roomTypeId: string) {
		roomTypeDetailRoomTypeId = roomTypeId;
		tick().then(() => roomTypeDetailFormEl?.requestSubmit());
	}

	// --- Room grid filtering ---
	let search = $state('');
	let typeFilter = $state('all');
	// Arriving from a just-completed check-in (see the reservation detail page's `checkIn`
	// action) lands here with the assigned room pre-selected, so staff see it immediately
	// instead of having to find it again in the grid.
	let selectedRoomId = $state<string | null>(page.url.searchParams.get('roomId'));
	let railTab = $state<'arrivals' | 'departures'>('arrivals');

	// Drives the occupied-room panel's overdue flag (whether `checkoutAtIso` has
	// already passed) — ticks once a minute, which is all that flag needs.
	let nowMs = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (nowMs = Date.now()), 60_000);
		return () => clearInterval(timer);
	});

	/** The actual checkout deadline (date + time, in the hotel's own timezone —
	 *  not the staff device's), plus whether it's already passed. A duration
	 *  countdown ("28:15") reads ambiguously past 24h; the deadline itself doesn't. */
	function checkoutDeadline(checkoutAtIso: string, now: number, timezone: string) {
		const date = new Date(checkoutAtIso);
		const overdue = now > date.getTime();
		const label = new Intl.DateTimeFormat('en-US', {
			timeZone: timezone,
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(date);
		return { label, overdue };
	}

	const roomTypeOptions = $derived.by(() => {
		const map = new Map<string, { id: string; name: string; color: string | null }>();
		for (const c of data.cells) {
			map.set(c.roomTypeId, { id: c.roomTypeId, name: c.roomTypeName, color: c.roomTypeColor });
		}
		return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
	});

	// --- Availability calendar sheet ---
	let calendarOpen = $state(false);
	let calendarTarget = $state<AvailabilityTarget | null>(null);
	function openAvailability(kind: AvailabilityTarget['kind'], id: string, name: string) {
		calendarTarget = { kind, id, name };
		calendarOpen = true;
	}

	const filteredCells = $derived(
		data.cells.filter((c) => {
			if (typeFilter !== 'all' && c.roomTypeName !== typeFilter) return false;
			if (!search.trim()) return true;
			const q = search.trim().toLowerCase();
			return (
				c.roomNumber.toLowerCase().includes(q) ||
				c.roomTypeName.toLowerCase().includes(q) ||
				(c.occupant?.guestName ?? '').toLowerCase().includes(q)
			);
		})
	);

	const floorGroups = $derived.by(() => {
		const map = new Map<string, RoomGridCell[]>();
		for (const c of filteredCells) {
			const key = c.floor ?? 'Unassigned floor';
			const list = map.get(key) ?? [];
			list.push(c);
			map.set(key, list);
		}
		return [...map.entries()];
	});

	const selectedRoom = $derived(data.cells.find((c) => c.roomId === selectedRoomId) ?? null);

	// Late checkout / early check-in fee hours, pre-filled from the clock but always editable.
	// Late = checkout deadline → now (live); early = actual check-in → check-in time (fixed).
	// Filled once per selected stay — never re-written under staff as the clock ticks; the
	// "use Nh (clock)" link re-applies the live figure on demand.
	const selectedOccupant = $derived(selectedRoom?.occupant ?? null);
	const lateHoursFromClock = $derived(
		selectedOccupant ? suggestedExtensionHours(Date.parse(selectedOccupant.checkoutAtIso), nowMs) : 0
	);
	const earlyHoursFromClock = $derived(
		selectedOccupant?.checkedInAtIso
			? suggestedExtensionHours(
					Date.parse(selectedOccupant.checkedInAtIso),
					Date.parse(selectedOccupant.checkInDueIso)
				)
			: 0
	);
	let lateFeeHours = $state<number>(1);
	let earlyFeeHours = $state<number>(1);
	let feeHoursFilledFor = $state<string | null>(null);
	$effect(() => {
		const bookingId = selectedOccupant?.bookingId ?? null;
		if (!bookingId || bookingId === feeHoursFilledFor) return;
		feeHoursFilledFor = bookingId;
		untrack(() => {
			lateFeeHours = lateHoursFromClock || 1;
			earlyFeeHours = earlyHoursFromClock || 1;
		});
	});

	/** Cleanliness status + pending damage reports per room — only rooms ever flagged for
	 *  housekeeping appear here (see `getRoomHousekeepingOverlay`); a room absent from this
	 *  map has never been flagged and shows no housekeeping icon or note anywhere below. */
	const housekeepingByRoom = $derived(
		new Map(data.housekeeping.map((h) => [h.roomId, h]))
	);
	const selectedHousekeeping = $derived(
		selectedRoom ? (housekeepingByRoom.get(selectedRoom.roomId) ?? null) : null
	);

	/** The form result is whatever action ran last (possibly another room's), so deposit state is only
	 *  trusted for the SELECTED room once ITS detail has loaded and the deposit row belongs to it —
	 *  otherwise settling one room made every other room's panel look settled. */
	const selectedBookingId = $derived(selectedRoom?.occupant?.bookingId ?? null);
	const roomDetailReady = $derived(
		!!selectedBookingId && formRoomDetail?.booking.id === selectedBookingId
	);
	const roomDeposit = $derived(
		roomDetailReady && formSecurityDeposit && formSecurityDeposit.bookingId === selectedBookingId
			? formSecurityDeposit
			: undefined
	);

	function statusCardClass(status: string): string {
		switch (status) {
			case 'occupied':
			case 'departing':
				return 'border-ok/40 bg-ok/10';
			case 'reserved':
				return 'border-dashed border-brand/50';
			case 'ooo':
				return 'border-danger/30 bg-danger/10 opacity-80';
			default:
				return 'border-border';
		}
	}
	function statusPillClass(status: string): string {
		switch (status) {
			case 'occupied':
			case 'departing':
				return 'border-transparent bg-ok/15 text-ok';
			case 'reserved':
				return 'border-transparent bg-brand/15 text-brand';
			case 'ooo':
				return 'border-transparent bg-danger/15 text-danger';
			default:
				return 'border-border bg-surface-2 text-ink-muted';
		}
	}
	const statusLabel: Record<string, string> = {
		vacant: 'Vacant',
		occupied: 'Occupied',
		departing: 'Occupied',
		reserved: 'Reserved',
		ooo: 'Out of order'
	};
	function channelLabel(channel: string): string {
		return channel === 'cash' ? 'Walk-in' : 'Booked online';
	}
	function humanize(s: string): string {
		return s.replace(/_/g, ' ');
	}

	// --- Walk-in drawer ---
	type WalkInCartLine = {
		id: string;
		roomTypeId: string;
		ratePlanId: string;
		roomTypeName: string;
		ratePlanName: string;
		checkIn: string;
		checkOut: string;
		occupancy: number;
		roomCount: number;
		/** Snapshotted at add-time — caps the qty stepper without re-querying. */
		availableRooms: number;
		perRoomPrice: PriceBreakdown;
		extraBedsNeeded: number;
		extraBedFeeCentavos: number | null;
		/** Only set for a line built from the grid's pick mode, where a room *type* is
		 *  picked before any rate plan — lets the cart line offer every rate plan the
		 *  availability check found, instead of just the one it defaulted to. A line
		 *  added from the date-search results list already has its one chosen plan and
		 *  carries no options here, so no selector renders for it. */
		ratePlanOptions?: Array<{
			id: string;
			name: string;
			price: PriceBreakdown;
			extraBedFeeCentavos: number | null;
		}>;
		/** Set only for a line built from the grid's pick mode — the exact physical
		 *  room staff clicked, pre-assigned to the booking the moment it's created
		 *  (not deferred to check-in). Always `roomCount === 1` and no qty stepper:
		 *  "add one more" means picking another specific tile, not bumping a count.
		 *  A date-search line carries neither field — no specific room is known until
		 *  check-in for those. */
		roomId?: string;
		roomNumber?: string;
	};
	let walkInOpen = $state(false);
	let walkInCart = $state<WalkInCartLine[]>([]);
	// Which entry point built the current cart — lets the sheet hide the date-search
	// form/results-list entirely when the cart came from picking rooms on the grid
	// (availability was already checked there, so re-showing an unrelated search
	// block on top of it is redundant and its date fields don't apply to anything
	// already added). Null only before either flow has opened the sheet.
	let walkInFlow = $state<'search' | 'pick' | null>(null);
	let walkInSearchFormEl = $state<HTMLFormElement>();
	// Bound (not just echoed from the last search result) so results stay reactive to
	// typing — changing Guests/Rooms (or the dates) re-runs the search automatically,
	// instead of leaving stale results on screen that no longer match what's entered
	// (a real report: staff bumped Guests from 2 to 3 without re-clicking "Check
	// availability" and the extra-bed offer/price shown was still for the old count).
	// Also lets the "Use N rooms" suggestion button update the field and resubmit in
	// one step.
	let wiCheckIn = $state(data.businessDate);
	let wiCheckOut = $state(todayPlus(1));
	let wiOccupancy = $state(1);
	let wiRoomCount = $state(1);
	$effect(() => {
		if (formWalkInSearch?.checkIn != null) wiCheckIn = formWalkInSearch.checkIn;
		if (formWalkInSearch?.checkOut != null) wiCheckOut = formWalkInSearch.checkOut;
		if (formWalkInSearch?.occupancy != null) wiOccupancy = formWalkInSearch.occupancy;
		if (formWalkInSearch?.roomCount != null) wiRoomCount = formWalkInSearch.roomCount;
	});

	/** Scales a cart line's own per-room quote by its own quantity and adds the
	 *  extra-bed fee if needed — same math `createWalkInBooking` actually charges,
	 *  so the cart's displayed total never understates what's about to be charged. */
	function walkInCartLineTotal(line: WalkInCartLine): number {
		let price = scaleRoomPrice(line.perRoomPrice, line.roomCount);
		if (line.extraBedsNeeded > 0 && line.extraBedFeeCentavos) {
			price = addFlatFeeCentavos(
				price,
				`Extra bed × ${line.extraBedsNeeded}`,
				line.extraBedsNeeded * line.extraBedFeeCentavos,
				data.vatRateBps
			);
		}
		return price.totalCentavos;
	}
	const walkInCartGrandTotal = $derived(
		walkInCart.reduce((sum, line) => sum + walkInCartLineTotal(line), 0)
	);

	/** Adds a room type/rate plan to the walk-in cart, merging into an existing line
	 *  (bumping its quantity) if that same combination is already there. */
	function addToWalkInCart(rt: AvailableRoomType, plan: AvailableRatePlan) {
		if (!formWalkInSearch) return;
		const existing = walkInCart.find((l) => l.roomTypeId === rt.id && l.ratePlanId === plan.id);
		if (existing) {
			existing.roomCount = Math.min(MAX_ROOMS_PER_LINE, rt.availableRooms, existing.roomCount + 1);
			return;
		}
		walkInCart.push({
			id: crypto.randomUUID(),
			roomTypeId: rt.id,
			ratePlanId: plan.id,
			roomTypeName: rt.name,
			ratePlanName: plan.name,
			checkIn: formWalkInSearch.checkIn,
			checkOut: formWalkInSearch.checkOut,
			occupancy: formWalkInSearch.occupancy,
			roomCount: Math.min(MAX_ROOMS_PER_LINE, rt.availableRooms, formWalkInSearch.roomCount),
			availableRooms: rt.availableRooms,
			perRoomPrice: plan.price,
			extraBedsNeeded: rt.extraBedsNeeded,
			extraBedFeeCentavos: plan.extraBedFeeCentavos
		});
	}

	function bumpWalkInCartQty(id: string, delta: number) {
		const line = walkInCart.find((l) => l.id === id);
		if (!line) return;
		line.roomCount = Math.max(
			1,
			Math.min(MAX_ROOMS_PER_LINE, line.availableRooms, line.roomCount + delta)
		);
	}

	function removeFromWalkInCart(id: string) {
		walkInCart = walkInCart.filter((l) => l.id !== id);
	}

	/** Switches a pick-mode cart line to a different rate plan the same availability
	 *  check already found for it — no re-check needed, just swap the already-fetched
	 *  price/name in from `line.ratePlanOptions`. */
	function setWalkInCartLineRatePlan(id: string, ratePlanId: string) {
		const line = walkInCart.find((l) => l.id === id);
		const plan = line?.ratePlanOptions?.find((p) => p.id === ratePlanId);
		if (!line || !plan) return;
		line.ratePlanId = plan.id;
		line.ratePlanName = plan.name;
		line.perRoomPrice = plan.price;
		line.extraBedFeeCentavos = plan.extraBedFeeCentavos;
	}

	// --- Front-desk grid pick mode: build a walk-in cart by clicking vacant room
	// tiles directly, instead of only via the date-search results list below. ---
	type PickedTile = {
		roomId: string;
		roomNumber: string;
		roomTypeId: string;
		roomTypeName: string;
		checkIn: string;
		checkOut: string;
		occupancy: number;
		/** Staff's explicit sign-off on adding the extra bed(s) this occupancy needs —
		 *  not just a silent automatic charge. Meaningless (never checked) until an
		 *  extra bed is actually needed; reset whenever that stops being true. */
		extraBedConfirmed: boolean;
	};
	let pickMode = $state(false);
	let pickedTiles = $state<PickedTile[]>([]);
	let pickPreviewLoading = $state(false);

	function pickedTileFor(c: RoomGridCell): PickedTile {
		return {
			roomId: c.roomId,
			roomNumber: c.roomNumber,
			roomTypeId: c.roomTypeId,
			roomTypeName: c.roomTypeName,
			checkIn: data.businessDate,
			checkOut: todayPlus(1),
			occupancy: 1,
			extraBedConfirmed: false
		};
	}

	/** Enters pick mode, optionally pre-seeded with one tile (the room detail rail's
	 *  "Select for walk-in" button, so a staff member who already clicked a specific
	 *  vacant room doesn't have to find and click it again). Deliberately leaves
	 *  `walkInCart` untouched — closing the sheet (the X, Escape, or clicking
	 *  outside it) never discards an in-progress walk-in, so picking more rooms
	 *  afterward adds to that same booking instead of silently starting over.
	 *  `walkInFlow` still resets to `null` so the sheet doesn't reopen mid-add
	 *  showing stale search-flow UI before a fresh "Check availability" runs. */
	function startPickMode(seed?: RoomGridCell) {
		pickMode = true;
		selectedRoomId = null;
		walkInFlow = null;
		pickedTiles = seed ? [pickedTileFor(seed)] : [];
	}

	function cancelPickMode() {
		pickMode = false;
		pickedTiles = [];
	}

	/** Whether this room is already claimed by a line already sitting in the walk-in
	 *  cart (from an earlier "Check availability" pass this same pick session) — the
	 *  grid itself won't reflect that until the booking is actually created, so this
	 *  is the only thing stopping staff from picking (and pre-assigning) the same
	 *  physical room twice in one sale. */
	function isAlreadyInCart(roomId: string): boolean {
		return walkInCart.some((l) => l.roomId === roomId);
	}

	function toggleTilePick(c: RoomGridCell) {
		if (c.status !== 'vacant' || isAlreadyInCart(c.roomId)) return;
		const idx = pickedTiles.findIndex((t) => t.roomId === c.roomId);
		if (idx !== -1) {
			pickedTiles.splice(idx, 1);
		} else {
			pickedTiles.push(pickedTileFor(c));
		}
	}

	function removePickedTile(roomId: string) {
		pickedTiles = pickedTiles.filter((t) => t.roomId !== roomId);
	}

	function disabledTileReason(status: string, roomId: string): string {
		if (isAlreadyInCart(roomId)) return 'Already selected for this walk-in';
		switch (status) {
			case 'occupied':
			case 'departing':
				return 'Occupied — check out first';
			case 'reserved':
				return 'Reserved for an upcoming arrival';
			case 'ooo':
				return 'Out of order';
			default:
				return '';
		}
	}

	/** Static capacity facts for a room type — max occupancy and the extra-bed policy
	 *  — shown on the room cards so staff know the ceiling before they even type a
	 *  guest count, instead of only discovering it via the occupancy hint above. */
	function roomTypeCapacityLabel(roomTypeId: string): string | null {
		const policy = data.roomTypePolicies[roomTypeId];
		if (!policy) return null;
		const maxPart = `Max ${policy.maxOccupancy} guest${policy.maxOccupancy === 1 ? '' : 's'}`;
		if (!policy.extraBedAllowed) return `${maxPart} · No extra bed`;
		const perBed = `+${policy.extraBedCapacity} guest${policy.extraBedCapacity === 1 ? '' : 's'}/bed`;
		const upTo = policy.maxExtraBeds > 0 ? `, up to ${policy.maxExtraBeds}` : '';
		return `${maxPart} · Extra bed allowed (${perBed}${upTo})`;
	}

	/** Live, client-side occupancy check for one picked tile — no round trip, same
	 *  pure solver `searchAvailability` runs server-side (`$lib/occupancy`). Settles
	 *  the extra-bed question right here, at picking time, instead of only finding
	 *  out after "Check availability" comes back with a bare "no longer available"
	 *  error, and instead of just silently billing an extra bed nobody was asked
	 *  about: staff explicitly check a box to include it (`needs-confirmation` until
	 *  they do), or add another room of the same type to avoid it entirely.
	 *
	 *  `blocked` covers two different reasons for the same UI treatment (Check
	 *  availability disabled, no checkbox to show): the party doesn't fit even with
	 *  every extra bed the room type allows, or it *would* fit but staff haven't
	 *  confirmed the extra bed yet. */
	function pickTileOccupancyHint(tile: PickedTile): {
		kind: 'blocked' | 'confirmed';
		message: string;
		extraBedsNeeded: number;
		suggestedRoomCount: number | null;
	} | null {
		const policy = data.roomTypePolicies[tile.roomTypeId];
		if (!policy || !tile.occupancy) return null;
		const plan = resolveOccupancyPlan(policy, tile.occupancy, 1);
		if (!plan.fits) {
			return {
				kind: 'blocked',
				message: plan.blockingReason!,
				extraBedsNeeded: 0,
				suggestedRoomCount: plan.suggestedRoomCount
			};
		}
		if (!plan.fitsBase) {
			const bedWord = plan.extraBedsNeeded === 1 ? 'bed' : 'beds';
			if (!tile.extraBedConfirmed) {
				return {
					kind: 'blocked',
					message: `Needs ${plan.extraBedsNeeded} extra ${bedWord} for ${tile.occupancy} guests — check the box below to add ${plan.extraBedsNeeded === 1 ? 'it' : 'them'}.`,
					extraBedsNeeded: plan.extraBedsNeeded,
					suggestedRoomCount: plan.suggestedRoomCount
				};
			}
			return {
				kind: 'confirmed',
				message: `${plan.extraBedsNeeded} extra ${bedWord} will be added for ${tile.occupancy} guests.`,
				extraBedsNeeded: plan.extraBedsNeeded,
				suggestedRoomCount: plan.suggestedRoomCount
			};
		}
		return null;
	}

	/** Whether a *different*, still-unpicked vacant room of the same type exists on
	 *  today's grid — the precondition for offering "add another room instead" as a
	 *  real action rather than text describing a room that isn't actually there. */
	function hasAnotherVacantRoomOfType(tile: PickedTile): boolean {
		return data.cells.some(
			(c) =>
				c.roomTypeId === tile.roomTypeId &&
				c.status === 'vacant' &&
				!pickedTiles.some((t) => t.roomId === c.roomId) &&
				!isAlreadyInCart(c.roomId)
		);
	}

	/** Adds one more real, currently-vacant room of the same type — the concrete
	 *  version of a hint's "add another room instead" suggestion. Guest counts are
	 *  left for staff to rebalance across the now-multiple rooms themselves (the
	 *  Guests field on each is already editable), rather than guessed here. */
	function addAnotherRoomOfSameType(tile: PickedTile) {
		const cell = data.cells.find(
			(c) =>
				c.roomTypeId === tile.roomTypeId &&
				c.status === 'vacant' &&
				!pickedTiles.some((t) => t.roomId === c.roomId) &&
				!isAlreadyInCart(c.roomId)
		);
		if (cell) pickedTiles.push(pickedTileFor(cell));
	}

	const pickHasBlockedTile = $derived(
		pickedTiles.some((t) => pickTileOccupancyHint(t)?.kind === 'blocked')
	);

	const pickPreviewItemsJson = $derived(
		JSON.stringify(
			pickedTiles.map((t) => ({
				key: t.roomId,
				roomTypeId: t.roomTypeId,
				checkIn: t.checkIn,
				checkOut: t.checkOut,
				occupancy: t.occupancy,
				roomCount: 1
			}))
		)
	);

	// Turns a successful availability-check response back into cart lines: every
	// checked tile becomes its own line, carrying its specific `roomId` — picking a
	// physical room pre-assigns that exact room to the booking (see
	// `createWalkInBooking`), so two tiles of the same room type never merge into one
	// "type × 2" line the way a date-search line still can; each stays "Room 101" /
	// "Room 102" on its own, with no qty stepper.
	$effect(() => {
		const preview = formWalkInPreview as WalkInAvailabilityCheckResult[] | undefined;
		const tiles = pickedTiles;
		if (!preview) return;
		// Everything below only ever *reads* `preview`/`tiles` (captured above, where
		// they're the effect's real, intentional dependencies) and touches `walkInCart`
		// purely as an imperative side effect — reading it too would make this effect
		// re-run every time it writes to `walkInCart` itself, replaying the same stale
		// `preview` again on every pass. `untrack` keeps `walkInCart` write-only here.
		untrack(() => {
			const newLines: WalkInCartLine[] = [];
			let successCount = 0;
			let problems = 0;
			for (const result of preview) {
				const tile = tiles.find((t) => t.roomId === result.key);
				if (!tile) continue;
				if (!result.available || !result.ratePlans || result.ratePlans.length === 0) {
					problems += 1;
					continue;
				}
				successCount += 1;
				const plan = result.ratePlans[0]!;
				newLines.push({
					id: crypto.randomUUID(),
					roomTypeId: tile.roomTypeId,
					ratePlanId: plan.id,
					roomTypeName: result.roomTypeName ?? tile.roomTypeName,
					ratePlanName: plan.name,
					checkIn: tile.checkIn,
					checkOut: tile.checkOut,
					occupancy: tile.occupancy,
					roomCount: 1,
					availableRooms: result.availableRooms ?? 1,
					perRoomPrice: plan.price,
					extraBedsNeeded: result.extraBedsNeeded ?? 0,
					extraBedFeeCentavos: plan.extraBedFeeCentavos,
					ratePlanOptions: result.ratePlans,
					roomId: tile.roomId,
					roomNumber: tile.roomNumber
				});
			}
			if (problems > 0) {
				toast.error(
					`${problems} selected room${problems === 1 ? '' : 's'} ${problems === 1 ? 'is' : 'are'} no longer available for those dates.`
				);
			}
			if (newLines.length > 0) walkInCart.push(...newLines);
			if (successCount > 0) {
				// Pick mode itself stays on — "Select rooms" is a toggle, not a
				// one-shot action, so closing the sheet afterward (the X, Escape, or
				// clicking outside it) lands staff back on the grid still able to
				// click more vacant tiles immediately, instead of reverting to
				// single-room browsing and forcing a second "Select rooms" click to
				// add anything else to the same walk-in. The tiles that were just
				// checked are done with, though — clear them so the panel is ready
				// for a fresh pick rather than showing already-added rooms.
				pickedTiles = [];
				walkInFlow = 'pick';
				walkInOpen = true;
			}
		});
	});

	let walkInSearchTimer: ReturnType<typeof setTimeout> | undefined;
	function scheduleWalkInSearch() {
		clearTimeout(walkInSearchTimer);
		walkInSearchTimer = setTimeout(() => walkInSearchFormEl?.requestSubmit(), 400);
	}

	function useSuggestedRoomCount(n: number) {
		wiRoomCount = n;
		tick().then(() => walkInSearchFormEl?.requestSubmit());
	}

	/** Scales the per-room quote by the searched room count and adds the extra-bed fee if
	 *  needed — same math `createWalkInBooking` actually charges, so this row's displayed
	 *  price never understates what the guest is about to be charged. */
	function walkInLineTotal(rt: AvailableRoomType, plan: AvailableRatePlan): number {
		let price = scaleRoomPrice(plan.price, formWalkInSearch?.roomCount ?? 1);
		if (rt.extraBedsNeeded > 0 && plan.extraBedFeeCentavos) {
			price = addFlatFeeCentavos(
				price,
				`Extra bed × ${rt.extraBedsNeeded}`,
				rt.extraBedsNeeded * plan.extraBedFeeCentavos,
				data.vatRateBps
			);
		}
		return price.totalCentavos;
	}

	function todayPlus(days: number): string {
		const d = new Date(`${data.businessDate}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() + days);
		return d.toISOString().slice(0, 10);
	}

	/** The "Walk-in" header button — opens the sheet on the date-search fallback
	 *  when nothing is in progress, or just resumes whatever's already there
	 *  (its own cart, and the right "Selected from the room grid" / "From your
	 *  search" label) when a walk-in built via either entry point is already
	 *  under way. Forcing `walkInFlow` to `'search'` unconditionally here was a
	 *  real bug: reopening a grid-picked cart through this button relabelled it
	 *  "From your search" and reshowed the unrelated search form on top of it. */
	function openWalkIn() {
		if (walkInFlow === null) walkInFlow = 'search';
		walkInOpen = true;
	}

	/** Clears the whole cart and lands back on an empty "first section" — the pick
	 *  panel (still toggled on) or the blank date-search form — instead of just
	 *  closing the sheet and leaving staff to click "Select rooms"/"Walk-in" again
	 *  themselves. Neither flow's own date fields can be edited once a cart line
	 *  already exists from them, so this is the actual "start over" escape hatch,
	 *  not just a close. */
	function resetWalkInFlow() {
		const wasPick = walkInFlow === 'pick';
		walkInOpen = false;
		walkInCart = [];
		walkInFlow = null;
		if (wasPick) {
			pickMode = true;
			pickedTiles = [];
			selectedRoomId = null;
		} else {
			openWalkIn();
		}
	}

	// --- Function hall walk-in drawer ---
	let hallWalkInOpen = $state(false);
	let hallWalkInHall = $state<HallGridCell | null>(null);
	let heEventDate = $state(data.businessDate);
	let heStartTime = $state('09:00');
	let heEndTime = $state('11:00');
	let hallQuote = $state<HallPriceBreakdown | null>(null);
	let hallQuoteError = $state<string | null>(null);
	let hallQuoteLoading = $state(false);

	/** Same wraparound-safe hour math the storefront's hall mini-form already uses. */
	function addHours(time: string, hours: number): string {
		const [h, m] = time.split(':').map(Number);
		const total = (((h! * 60 + m! + hours * 60) % (24 * 60)) + 24 * 60) % (24 * 60);
		return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
	}

	function openHallWalkIn(hall: HallGridCell) {
		hallWalkInHall = hall;
		heEventDate = data.businessDate;
		heStartTime = '09:00';
		heEndTime = addHours('09:00', hall.baseHours);
		hallQuote = null;
		hallQuoteError = null;
		hallWalkInOpen = true;
		fetchHallQuote();
	}

	/** Live price quote as the front desk adjusts date/time — same `/api/hall-quote`
	 *  endpoint the guest-facing storefront's own hall mini-form calls; hourly math never
	 *  happens client-side, so what's quoted here can never drift from what actually gets charged. */
	async function fetchHallQuote() {
		if (!hallWalkInHall) return;
		if (heStartTime >= heEndTime) {
			hallQuote = null;
			hallQuoteError = 'End time must be after start time.';
			return;
		}
		hallQuoteLoading = true;
		hallQuoteError = null;
		try {
			const res = await fetch(`${staffBase}/front-desk/api/hall-quote`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					functionHallId: hallWalkInHall.functionHallId,
					eventDate: heEventDate,
					startTime: heStartTime,
					endTime: heEndTime
				})
			});
			if (!res.ok) {
				hallQuote = null;
				hallQuoteError =
					((await res.json().catch(() => null)) as { message?: string } | null)?.message ??
					'Could not price that booking.';
				return;
			}
			const result = (await res.json()) as { available: boolean; price?: HallPriceBreakdown };
			if (!result.available) {
				hallQuote = null;
				hallQuoteError = 'This hall is already booked for that time — pick a different slot.';
				return;
			}
			hallQuote = result.price ?? null;
		} catch {
			hallQuote = null;
			hallQuoteError = 'Could not reach the server. Try again.';
		} finally {
			hallQuoteLoading = false;
		}
	}

	function statusPillClassGeneric(status: string): string {
		if (status === 'confirmed' || status === 'completed')
			return 'border-transparent bg-ok/15 text-ok';
		if (status === 'cancelled') return 'border-transparent bg-danger/15 text-danger';
		return 'border-border bg-surface-2 text-ink-muted';
	}

	const methodLabels: Record<string, string> = {
		cash: 'Cash',
		card: 'Card',
		gcash: 'GCash',
		maya: 'Maya',
		bank_transfer: 'Bank transfer',
		cheque: 'Cheque',
		paymongo: 'Online',
		house_use: 'City ledger',
		security_deposit: 'Security deposit'
	};
</script>

{#snippet paymentRow(p: any, kind: 'room' | 'hall', id: string)}
	<div class="flex items-start justify-between gap-2 text-sm {p.voidedAt ? 'opacity-50' : ''}">
		<div class="min-w-0">
			<div class="flex flex-wrap items-center gap-1.5">
				<span class="font-medium text-ink {p.voidedAt ? 'line-through' : ''}">
					{methodLabels[p.method] ?? p.method}
				</span>
				{#if p.purpose === 'deposit'}<Badge
						variant="outline"
						class="border-border bg-surface-2 text-ink-muted">deposit</Badge
					>{/if}
				{#if p.purpose === 'refund'}<Badge
						variant="outline"
						class="border-transparent bg-danger/15 text-danger">refund</Badge
					>{/if}
				{#if p.voidedAt}<span class="text-xs text-danger"
						>voided{#if p.voidReason}
							— {p.voidReason}{/if}</span
					>{/if}
			</div>
			<div class="text-xs text-ink-muted">
				{#if p.referenceNo}Ref {p.referenceNo}{/if}
				{#if p.tenderedCentavos != null && p.method === 'cash'}
					{p.referenceNo ? ' · ' : ''}tendered {peso(p.tenderedCentavos)}, change {peso(
						p.changeCentavos
					)}
				{/if}
			</div>
			<div class="mt-1 flex items-center gap-1.5">
				{#if !p.voidedAt && p.amountCentavos > 0}
					<Button variant="outline" size="xs" href="{base}/print/receipt/{p.id}" target="_blank">
						Receipt
					</Button>
				{/if}
				{#if !p.voidedAt && p.status === 'paid' && p.provider !== 'paymongo' && p.method !== 'house_use' && p.method !== 'security_deposit'}
					<form method="POST" action="?/voidPayment" use:enhance>
						<input type="hidden" name="kind" value={kind} />
						<input type="hidden" name="id" value={id} />
						<input type="hidden" name="paymentId" value={p.id} />
						<input type="hidden" name="reason" value="Voided at front desk" />
						<Button type="submit" variant="outline" size="xs" class="text-danger hover:text-danger">
							Void payment
						</Button>
					</form>
				{/if}
			</div>
		</div>
		<span class="shrink-0 text-ink {p.voidedAt ? 'line-through' : ''}">
			{p.amountCentavos < 0 ? '−' : ''}{peso(Math.abs(p.amountCentavos))}
		</span>
	</div>
{/snippet}

<div class="flex h-[calc(100dvh-1px)] flex-col">
	<div class="flex items-center justify-between gap-4 border-b border-border px-6 py-3.5">
		<div>
			<h1 class="text-base font-semibold tracking-tight text-ink">Front desk</h1>
			<p class="text-xs text-ink-muted">{data.businessDate}</p>
		</div>
		<div class="flex items-center gap-3">
			{#if data.cashier.openShift}
				<a
					href="{staffBase}/finance/shifts"
					class="flex items-center gap-1.5 rounded-md border border-ok/40 bg-ok/10 px-2.5 py-1.5 text-xs font-medium text-ok"
				>
					<BanknoteIcon class="size-3.5" />
					Shift open · float {peso(data.cashier.openShift.openingFloatCentavos)}
				</a>
			{:else if data.cashier.hasDrawerAccount}
				<form method="POST" action="?/openShift" use:enhance class="flex items-center gap-1.5">
					{#if data.cashier.drawers.length > 1}
						<select
							name="cashAccountId"
							bind:value={shiftDrawer}
							class="rounded-md border border-input bg-transparent px-2 py-1.5 text-xs"
						>
							<option value="" disabled selected>Drawer…</option>
							{#each data.cashier.drawers as d (d.id)}
								<option value={d.id}>{d.name}</option>
							{/each}
						</select>
					{:else if data.cashier.drawers[0]}
						<input type="hidden" name="cashAccountId" value={data.cashier.drawers[0].id} />
					{/if}
					<input
						name="openingFloat"
						type="number"
						min="0"
						step="0.01"
						bind:value={shiftFloat}
						placeholder="Float ₱"
						class="w-24 rounded-md border border-input bg-transparent px-2 py-1.5 text-xs"
						required
					/>
					<Button type="submit" size="sm" variant="outline">
						<ClockIcon class="size-3.5" />
						Open shift
					</Button>
				</form>
			{:else}
				<a
					href="{staffBase}/finance/settings"
					class="text-xs text-ink-muted underline underline-offset-2"
				>
					Set up a cash drawer →
				</a>
			{/if}
			{#if pickMode}
				<Button variant="outline" onclick={cancelPickMode}>
					<XIcon />
					Cancel selection
				</Button>
			{:else}
				<Button variant="outline" onclick={() => startPickMode()}>
					<MousePointerClickIcon />
					Select rooms
				</Button>
			{/if}
			<Button onclick={() => openWalkIn()}>
				<UserPlusIcon />
				Walk-in
				{#if walkInCart.length > 0}
					<Badge variant="outline" class="border-transparent bg-white/20 px-1.5 text-white">
						{walkInCart.length}
					</Badge>
				{/if}
			</Button>
		</div>
	</div>

	<div
		class="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-2 px-6 py-2.5"
	>
		<div class="flex flex-wrap items-center gap-4 text-xs text-ink-muted">
			<div class="flex items-center gap-1.5">
				<span class="size-3 rounded border border-border"></span>Vacant
			</div>
			<div class="flex items-center gap-1.5">
				<span class="size-3 rounded border border-ok/40 bg-ok/15"></span>Occupied
			</div>
			<div class="flex items-center gap-1.5">
				<span class="relative size-3 rounded border border-ok/40 bg-ok/15">
					<LogOutIcon class="absolute -top-1 -right-1 size-2.5 text-ok" />
				</span>Departing today
			</div>
			<div class="flex items-center gap-1.5">
				<span class="size-3 rounded border border-dashed border-brand/50"></span>Reserved
			</div>
			<div class="flex items-center gap-1.5">
				<span class="size-3 rounded border border-danger/30 bg-danger/15"></span>Out of order
			</div>
		</div>
		<div class="flex items-center gap-2">
			<div class="relative">
				<SearchIcon class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
				<Input placeholder="Find a room or guest…" bind:value={search} class="w-56 pl-8" />
			</div>
		</div>
	</div>

	<div class="flex min-h-0 flex-1">
		<div class="min-w-0 flex-1 overflow-y-auto p-6">
			{#if roomTypeOptions.length > 0}
				<div class="mb-3 flex flex-wrap items-center gap-2">
					<span class="text-xs font-medium text-ink-muted">Filter:</span>
					<button
						type="button"
						onclick={() => (typeFilter = 'all')}
						class="rounded-full border px-2.5 py-1 text-xs transition {typeFilter === 'all'
							? 'border-brand bg-brand/10 font-medium text-ink'
							: 'border-border text-ink-muted hover:border-brand/50 hover:text-ink'}"
					>
						All room types
					</button>
					{#each roomTypeOptions as rt (rt.id)}
						<button
							type="button"
							onclick={() => (typeFilter = rt.name)}
							class="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition {typeFilter ===
							rt.name
								? 'border-brand bg-brand/10 font-medium text-ink'
								: 'border-border text-ink-muted hover:border-brand/50 hover:text-ink'}"
						>
							{#if rt.color}
								<span class="size-2 rounded-full" style="background-color: {rt.color}"></span>
							{/if}
							{rt.name}
						</button>
					{/each}
				</div>
				<div class="mb-5 flex flex-wrap items-center gap-2">
					<span class="text-xs font-medium text-ink-muted">Check availability:</span>
					{#each roomTypeOptions as rt (rt.id)}
						<button
							type="button"
							onclick={() => openAvailability('roomType', rt.id, rt.name)}
							class="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-ink-muted transition hover:border-brand/50 hover:text-ink"
						>
							<CalendarRangeIcon class="size-3" />
							{rt.name}
						</button>
					{/each}
				</div>
			{/if}
			{#if pickMode}
				<div
					class="mb-4 rounded-lg border border-dashed border-brand/50 bg-brand/5 px-3 py-2 text-xs text-ink"
				>
					<span class="font-medium">Selecting rooms for a walk-in.</span>
					Click a vacant room to add it — occupied, reserved, and out-of-order rooms can't be picked.
				</div>
			{/if}
			{#if floorGroups.length === 0}
				<p class="text-sm text-ink-muted">No rooms match this filter.</p>
			{:else}
				{#each floorGroups as [floor, cells] (floor)}
					<div class="mb-7 last:mb-0">
						<div class="mb-2 flex items-baseline gap-2">
							<h2 class="text-xs font-bold tracking-wide text-ink-muted uppercase">
								Floor {floor}
							</h2>
							<span class="text-xs text-ink-muted"
								>{cells.length} room{cells.length === 1 ? '' : 's'}</span
							>
						</div>
						<div class="grid grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-2.5">
							{#each cells as c (c.roomId)}
								{@const picked = pickMode && pickedTiles.some((t) => t.roomId === c.roomId)}
								{@const pickDisabled =
									pickMode && (c.status !== 'vacant' || isAlreadyInCart(c.roomId))}
								<button
									type="button"
									disabled={pickDisabled}
									title={pickDisabled ? disabledTileReason(c.status, c.roomId) : undefined}
									onclick={() => (pickMode ? toggleTilePick(c) : (selectedRoomId = c.roomId))}
									class="relative rounded-lg border p-2.5 text-left transition {statusCardClass(
										c.status
									)} {pickDisabled
										? 'cursor-not-allowed opacity-40'
										: 'hover:-translate-y-0.5 hover:shadow-sm'} {picked
										? 'ring-2 ring-brand ring-offset-1'
										: !pickMode && selectedRoomId === c.roomId
											? 'ring-2 ring-brand'
											: ''}"
								>
									{#if picked}
										<span
											class="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-brand text-white"
										>
											<CheckIcon class="size-2.5" />
										</span>
									{:else if c.status === 'departing'}
										<LogOutIcon class="absolute top-1.5 right-1.5 size-3 text-ok" />
									{:else if c.status === 'reserved'}
										<span class="absolute top-2 right-2 size-1.5 rounded-full bg-brand"></span>
									{/if}
									{#if housekeepingByRoom.get(c.roomId)?.status === 'dirty' || housekeepingByRoom.get(c.roomId)?.status === 'in_progress'}
										<SparklesIcon
											class="absolute right-1.5 bottom-1.5 size-3 text-danger"
										/>
									{:else if housekeepingByRoom.get(c.roomId)?.status === 'clean' && c.status === 'vacant'}
										<CheckIcon class="absolute right-1.5 bottom-1.5 size-3 text-ok" />
									{/if}
									<div
										class="text-base font-bold tabular-nums {c.roomTypeColor ? '' : 'text-ink'}"
										style={c.roomTypeColor ? `color: ${c.roomTypeColor}` : undefined}
									>
										{c.roomNumber}
									</div>
									<div class="truncate text-[11px] text-ink-muted">{c.roomTypeName}</div>
								</button>
							{/each}
						</div>
					</div>
				{/each}
			{/if}

			{#if data.hallGrid.length > 0}
				<div class="mt-8 border-t border-border pt-6">
					<h2 class="mb-3 text-xs font-bold tracking-wide text-ink-muted uppercase">
						Function halls
					</h2>
					<div class="space-y-3">
						{#each data.hallGrid as hall (hall.functionHallId)}
							<div class="rounded-lg border border-border p-4">
								<div class="mb-3 flex items-center justify-between gap-3">
									<div class="flex items-center gap-2">
										<PartyPopperIcon class="size-4 text-ink-muted" />
										<div>
											<div class="text-sm font-semibold text-ink">{hall.hallName}</div>
											<div class="text-xs text-ink-muted">Capacity {hall.capacity}</div>
										</div>
									</div>
									<div class="flex items-center gap-2">
										<Button
											size="sm"
											variant="outline"
											onclick={() => openAvailability('hall', hall.functionHallId, hall.hallName)}
										>
											<CalendarRangeIcon class="size-3.5" />
											Availability
										</Button>
										<Button size="sm" onclick={() => openHallWalkIn(hall)}>
											<UserPlusIcon class="size-3.5" />
											Walk-in event
										</Button>
									</div>
								</div>
								{#if hall.events.length === 0}
									<p class="text-sm text-ink-muted">No events today.</p>
								{:else}
									<div class="divide-y divide-border rounded-md border border-border">
										{#each hall.events as e (e.hallBookingId)}
											<div class="flex items-center justify-between gap-3 px-3 py-2.5">
												<div>
													<div class="text-sm font-medium text-ink">
														{e.guestName} · {e.eventType}
													</div>
													<div class="text-xs text-ink-muted">
														{e.startTime.slice(0, 5)}–{e.endTime.slice(0, 5)} · {e.guestCount} guests
														· {channelLabel(e.channel)} · {peso(e.totalCentavos)}
													</div>
												</div>
												<div class="flex items-center gap-2">
													<Badge variant="outline" class={statusPillClassGeneric(e.status)}>
														{humanize(e.status)}
													</Badge>
													{#if e.status === 'confirmed'}
														<form method="POST" action="?/completeHall" use:enhance>
															<input type="hidden" name="hallBookingId" value={e.hallBookingId} />
															<Button type="submit" size="sm" variant="outline"
																>Mark completed</Button
															>
														</form>
													{/if}
													<form method="POST" action="?/hallDetail" use:enhance>
														<input type="hidden" name="hallBookingId" value={e.hallBookingId} />
														<Button type="submit" size="sm" variant="outline">Full details</Button>
													</form>
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<div class="hidden w-120 shrink-0 overflow-y-auto border-l border-border lg:block">
			{#if pickMode}
				<div class="p-4">
					<div class="mb-3 flex items-center justify-between">
						<h3 class="text-lg font-bold text-ink">Select rooms</h3>
						<button
							type="button"
							onclick={cancelPickMode}
							class="text-xs font-semibold text-ink-muted hover:text-ink"
						>
							Cancel
						</button>
					</div>
					{#if pickedTiles.length === 0}
						<p class="text-sm text-ink-muted">
							Click any vacant room on the grid to add it here. Occupied, reserved, and out-of-order
							rooms can't be picked.
						</p>
					{:else}
						<div class="mb-4 space-y-3">
							{#each pickedTiles as tile (tile.roomId)}
								<div class="rounded-lg border border-border p-3">
									<div class="mb-2 flex items-center justify-between gap-2">
										<div class="min-w-0">
											<div class="text-sm font-semibold text-ink">Room {tile.roomNumber}</div>
											<div class="truncate text-xs text-ink-muted">{tile.roomTypeName}</div>
											{#if roomTypeCapacityLabel(tile.roomTypeId)}
												<div class="mt-0.5 text-[11px] text-ink-muted">
													{roomTypeCapacityLabel(tile.roomTypeId)}
												</div>
											{/if}
										</div>
										<button
											type="button"
											onclick={() => removePickedTile(tile.roomId)}
											class="shrink-0 text-ink-muted hover:text-danger"
										>
											<XIcon class="size-3.5" />
										</button>
									</div>
									<div class="grid grid-cols-3 gap-2">
										<div>
											<Label for="pick-ci-{tile.roomId}" class="text-[10px]">Check-in</Label>
											<Input
												id="pick-ci-{tile.roomId}"
												type="date"
												bind:value={tile.checkIn}
												class="h-8 text-xs"
											/>
										</div>
										<div>
											<Label for="pick-co-{tile.roomId}" class="text-[10px]">Check-out</Label>
											<Input
												id="pick-co-{tile.roomId}"
												type="date"
												bind:value={tile.checkOut}
												class="h-8 text-xs"
											/>
										</div>
										<div>
											<Label for="pick-occ-{tile.roomId}" class="text-[10px]">Guests</Label>
											<Input
												id="pick-occ-{tile.roomId}"
												type="number"
												min="1"
												max="20"
												bind:value={tile.occupancy}
												class="h-8 text-xs"
											/>
										</div>
									</div>
									{#if pickTileOccupancyHint(tile)}
										{@const hint = pickTileOccupancyHint(tile)!}
										<p
											class="mt-2 text-[11px] {hint.kind === 'blocked'
												? 'text-danger'
												: 'text-ink-muted'}"
										>
											{hint.message}
										</p>
										{#if hint.extraBedsNeeded > 0}
											<label class="mt-1 flex items-center gap-1.5 text-[11px] text-ink">
												<input
													type="checkbox"
													class="size-3"
													checked={tile.extraBedConfirmed}
													onchange={(e) => (tile.extraBedConfirmed = e.currentTarget.checked)}
												/>
												Add {hint.extraBedsNeeded} extra bed{hint.extraBedsNeeded === 1 ? '' : 's'}
											</label>
										{/if}
										{#if hint.kind === 'blocked' && hasAnotherVacantRoomOfType(tile)}
											<button
												type="button"
												onclick={() => addAnotherRoomOfSameType(tile)}
												class="mt-1 text-[11px] text-ink-muted underline underline-offset-2 hover:text-ink"
											>
												Add another {tile.roomTypeName} room instead
											</button>
										{/if}
									{/if}
								</div>
							{/each}
						</div>
						<form
							method="POST"
							action="?/previewWalkIn"
							use:enhance={() => {
								pickPreviewLoading = true;
								return async ({ update }) => {
									pickPreviewLoading = false;
									await update({ reset: false });
								};
							}}
						>
							<input type="hidden" name="itemsJson" value={pickPreviewItemsJson} />
							<Button
								type="submit"
								class="w-full"
								disabled={pickPreviewLoading || pickHasBlockedTile}
								title={pickHasBlockedTile
									? "Fix the room that doesn't fit before checking availability."
									: undefined}
							>
								{pickPreviewLoading
									? 'Checking…'
									: `Check availability — ${pickedTiles.length} room${pickedTiles.length === 1 ? '' : 's'}`}
							</Button>
						</form>
					{/if}
				</div>
			{:else if selectedRoom}
				<div class="p-4">
					<button
						type="button"
						onclick={() => (selectedRoomId = null)}
						class="mb-3 flex items-center gap-1 text-xs font-semibold text-ink-muted hover:text-ink"
					>
						<ChevronLeftIcon class="size-3.5" />
						Back to today's list
					</button>
					<button
						type="button"
						onclick={() => openRoomTypeDetail(selectedRoom.roomTypeId)}
						class="text-lg font-bold text-ink tabular-nums underline-offset-4 hover:underline"
						title="View this room's full details, spec, and gallery"
					>
						Room {selectedRoom.roomNumber}
					</button>
					<p class="mb-2 text-xs text-ink-muted">
						<a
							href="{base}/rooms/{selectedRoom.roomTypeId}"
							target="_blank"
							class="underline-offset-2 hover:text-ink hover:underline"
							title="View this room type's photos and details (guest-facing page)"
						>
							{selectedRoom.roomTypeName}
						</a>
						· Floor {selectedRoom.floor ?? '—'}
					</p>
					<div class="mb-4 flex flex-wrap items-center gap-2">
						<Badge variant="outline" class={statusPillClass(selectedRoom.status)}>
							{statusLabel[selectedRoom.status]}
						</Badge>
						{#if selectedRoom.occupant}
							<Badge variant="outline" class="gap-1 border-border bg-surface-2 text-ink-muted">
								{#if selectedRoom.occupant.channel === 'cash'}
									<BanknoteIcon class="size-3" />
								{:else}
									<GlobeIcon class="size-3" />
								{/if}
								{channelLabel(selectedRoom.occupant.channel)}
							</Badge>
							{#if selectedRoom.occupant.balanceCentavos > 0}
								<Badge variant="outline" class="border-danger/30 bg-danger/10 text-danger">
									Room balance {peso(selectedRoom.occupant.balanceCentavos)}
								</Badge>
							{/if}
						{/if}
					</div>

					{#if selectedHousekeeping && selectedHousekeeping.pendingDamageReports.length > 0}
						<div class="mb-4 space-y-2">
							<h4 class="text-xs font-semibold tracking-wide text-ink-muted uppercase">
								Housekeeping-reported damage
							</h4>
							{#each selectedHousekeeping.pendingDamageReports as r (r.id)}
								<div class="rounded-md border border-danger/30 bg-danger/5 p-3">
									<img
										src={r.photoUrl}
										alt="Reported damage"
										class="mb-2 max-h-32 rounded-md object-cover"
									/>
									<p class="text-sm text-ink">{r.description}</p>
									{#if r.bookingId && selectedBookingId && r.bookingId !== selectedBookingId}
										<p class="mt-1 text-xs text-danger">
											Reported against an earlier stay in this room, not the current guest — charging
											posts to that stay's folio.
										</p>
									{/if}
									{#if r.bookingId}
										<form
											method="POST"
											action="?/resolveHousekeepingDamage"
											use:enhance
											class="mt-2 flex items-end gap-2"
										>
											<input type="hidden" name="damageReportId" value={r.id} />
											<input type="hidden" name="bookingId" value={r.bookingId} />
											<Input
												name="amount"
												type="number"
												min="0.01"
												step="0.01"
												placeholder="₱ amount"
												required
												class="h-8 w-28 text-sm"
											/>
											<Button type="submit" size="sm" variant="outline">Charge damage</Button>
										</form>
									{:else}
										<p class="mt-2 text-xs text-ink-muted">
											No booking on file for this room — charge it manually elsewhere if needed.
										</p>
									{/if}
									<form
										method="POST"
										action="?/dismissHousekeepingDamage"
										use:enhance
										class="mt-1"
									>
										<input type="hidden" name="damageReportId" value={r.id} />
										<input type="hidden" name="bookingId" value={r.bookingId ?? ''} />
										<button
											type="submit"
											class="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
										>
											Dismiss — not chargeable
										</button>
									</form>
								</div>
							{/each}
						</div>
					{/if}

					{#if selectedRoom.occupant}
						{@const o = selectedRoom.occupant}
						{@const deadline = checkoutDeadline(o.checkoutAtIso, nowMs, data.timezone)}
						<Accordion.Root type="single" value="guest-details" class="mb-4">
							<Accordion.Item value="guest-details" class="rounded-lg border border-border">
								<Accordion.Trigger class="px-3 py-2 text-sm font-semibold text-ink hover:no-underline"
									>Guest & stay details</Accordion.Trigger
								>
								<Accordion.Content class="pb-0">
									<dl class="divide-y divide-border border-t border-border text-sm">
										<div class="flex items-center justify-between gap-3 px-3 py-1.5">
											<dt class="text-ink-muted">Guest</dt>
											<dd class="text-right font-medium text-ink">{o.guestName}</dd>
										</div>
										<div class="flex items-center justify-between gap-3 px-3 py-1.5">
											<dt class="text-ink-muted">Email</dt>
											<dd class="truncate text-right text-ink">{o.guestEmail}</dd>
										</div>
										{#if o.guestPhone}
											<div class="flex items-center justify-between gap-3 px-3 py-1.5">
												<dt class="text-ink-muted">Phone</dt>
												<dd class="text-right text-ink">{o.guestPhone}</dd>
											</div>
										{/if}
										<div class="flex items-center justify-between gap-3 px-3 py-1.5">
											<dt class="text-ink-muted">Check-in</dt>
											<dd class="text-right text-ink">{o.checkIn}</dd>
										</div>
										<div class="flex items-center justify-between gap-3 px-3 py-1.5">
											<dt class="text-ink-muted">Check-out</dt>
											<dd class="text-right text-ink">{o.checkOut}</dd>
										</div>
										<div class="flex items-center justify-between gap-3 px-3 py-1.5">
											<dt class="flex items-center gap-1 text-ink-muted">
												<ClockIcon class="size-3.5" />
												{deadline.overdue ? 'Overdue since' : 'Checkout due'}
											</dt>
											<dd
												class="text-right font-medium {deadline.overdue ? 'text-danger' : 'text-ink'}"
											>
												{deadline.label}
											</dd>
										</div>
										<div class="flex items-center justify-between gap-3 px-3 py-1.5">
											<dt class="text-ink-muted">Occupancy</dt>
											<dd class="text-right text-ink">{o.occupancy} guests</dd>
										</div>
										<div class="flex items-center justify-between gap-3 px-3 py-1.5">
											<dt class="text-ink-muted">Rate plan</dt>
											<dd class="text-right text-ink">{o.ratePlanName}</dd>
										</div>
										<div class="flex items-center justify-between gap-3 px-3 py-1.5">
											<dt class="text-ink-muted">Total</dt>
											<dd class="text-right font-semibold text-ink">{peso(o.totalCentavos)}</dd>
										</div>
									</dl>
								</Accordion.Content>
							</Accordion.Item>
						</Accordion.Root>
						{#if o.specialRequests}
							<p class="mb-4 text-xs text-ink-muted">
								<strong class="text-ink">Special requests:</strong>
								{o.specialRequests}
							</p>
						{/if}
						{#if selectedRoom.status === 'departing' && o.checkOut < data.businessDate}
							<p class="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
								<strong>Overdue</strong> — was due out {o.checkOut} at {data.checkOutTime.slice(0, 5)} and
								never checked out. The room stays blocked until you check this guest out.
								{#if data.lateCheckoutFeePerHourCentavos > 0}
									Add the late checkout fee ({peso(data.lateCheckoutFeePerHourCentavos)}/hour) to the
									folio below first.
								{/if}
							</p>
						{:else if selectedRoom.status === 'departing' && data.lateCheckoutFeePerHourCentavos > 0}
							<p class="mb-3 rounded-md bg-surface-2 px-3 py-2 text-xs text-ink-muted">
								Wants to keep the room past {data.checkOutTime.slice(0, 5)}? Late checkout fee:
								<strong class="text-ink">{peso(data.lateCheckoutFeePerHourCentavos)}/hour</strong> — add
								it to the folio below before checking out.
							</p>
						{/if}
						{#if roomDeposit?.status === 'held' && (selectedRoom.status === 'departing' || selectedRoom.status === 'occupied')}
							<p class="mb-2 text-xs text-danger">
								Settle the ₱{(roomDeposit.amountCentavos / 100).toFixed(
									2
								)} security deposit below before checking out.
							</p>
						{/if}
						{#if selectedRoom.status === 'departing' && (selectedHousekeeping?.status === 'dirty' || selectedHousekeeping?.status === 'in_progress')}
							<p class="mb-2 text-xs text-ink-muted">
								This room wasn't marked clean by Housekeeping before this stay — checking out
								anyway.
							</p>
						{/if}
						<div class="flex gap-2">
							{#if selectedRoom.status === 'departing' || selectedRoom.status === 'occupied'}
								<form method="POST" action="?/checkOut" use:enhance class="flex-1">
									<input type="hidden" name="bookingId" value={o.bookingId} />
									<Button
										type="submit"
										class="w-full"
										disabled={!roomDetailReady || roomDeposit?.status === 'held'}
									>
										{selectedRoom.status === 'departing' ? 'Check out' : 'Check out early'}
									</Button>
								</form>
							{/if}
							<Button
								variant="outline"
								class="flex-1"
								href="{base}/print/invoice/for/booking/{o.bookingId}"
								target="_blank"
							>
								Print invoice
							</Button>
						</div>
						<div class="mt-2 flex gap-2">
							<Button
								variant="outline"
								size="sm"
								class="flex-1"
								href="{base}/print/registration/{o.bookingId}"
								target="_blank"
							>
								Registration card
							</Button>
							<Button
								variant="outline"
								size="sm"
								class="flex-1"
								href="{staffBase}/reservations/room/{o.bookingId}?from=front-desk&roomId={selectedRoomId}"
							>
								View full details
							</Button>
						</div>
						{#if selectedRoom.status === 'occupied'}
							<form method="POST" action="?/flagForHousekeeping" use:enhance class="mt-2">
								<input type="hidden" name="bookingId" value={o.bookingId} />
								<input type="hidden" name="roomId" value={selectedRoomId} />
								<Button type="submit" variant="outline" size="sm" class="w-full gap-1.5">
									<SparklesIcon class="size-3.5" />
									Flag for housekeeping
								</Button>
							</form>
						{/if}

						<!-- Fetches automatically whenever a new occupied room is selected — see the
						     $effect above. Never shown to the staff; it just keeps `formRoomDetail`/
						     `formFolio` current for the inline sections below. -->
						<form
							method="POST"
							action="?/roomDetail"
							use:enhance
							bind:this={roomDetailFormEl}
							class="hidden"
						>
							<input type="hidden" name="bookingId" value={roomDetailBookingId} />
						</form>

						{#if formRoomDetail && formFolio && formRoomDetail.booking.id === o.bookingId}
							<div class="mt-4 rounded-lg border border-border p-3">
								<div class="mb-2 flex items-center justify-between">
									<h4 class="text-sm font-semibold text-ink">Guest ID</h4>
									{#if formRoomDetail.booking.guestIdPhotoUrl && !idCaptureOpen}
										<button
											type="button"
											onclick={() => (idCaptureOpen = true)}
											class="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
										>
											Retake
										</button>
									{/if}
								</div>
								{#if formRoomDetail.booking.guestIdPhotoUrl && !idCaptureOpen}
									<a href={formRoomDetail.booking.guestIdPhotoUrl} target="_blank" class="block">
										<img
											src={formRoomDetail.booking.guestIdPhotoUrl}
											alt="Captured guest ID"
											class="max-h-32 rounded-md border border-border"
										/>
									</a>
								{:else if idCaptureOpen}
									<form
										method="POST"
										action="?/captureIdPhoto"
										use:enhance
										enctype="multipart/form-data"
										class="space-y-2"
									>
										<input type="hidden" name="bookingId" value={o.bookingId} />
										<IdCameraCapture />
										<div class="flex gap-2">
											<Button type="submit" size="sm">Save ID photo</Button>
											<button
												type="button"
												onclick={() => (idCaptureOpen = false)}
												class="text-xs text-ink-muted underline underline-offset-2"
											>
												Cancel
											</button>
										</div>
									</form>
								{:else}
									<Button
										type="button"
										variant="outline"
										size="sm"
										onclick={() => (idCaptureOpen = true)}
									>
										Capture ID photo
									</Button>
								{/if}
							</div>

							<div class="mt-4 rounded-lg border border-border p-3">
								<div class="mb-2 flex items-center justify-between">
									<h4 class="text-sm font-semibold text-ink">Folio</h4>
									<Badge
										variant="outline"
										class={formFolio.balanceCentavos > 0
											? 'border-transparent bg-danger/15 text-danger'
											: 'border-transparent bg-ok/15 text-ok'}
									>
										{formFolio.balanceCentavos > 0
											? `Room balance due ${peso(formFolio.balanceCentavos)}`
											: 'Settled'}
									</Badge>
								</div>

								<div class="divide-y divide-border text-sm">
									{#each formFolio.charges as c (c.id)}
										<div class="flex items-start justify-between gap-2 py-1.5">
											<div class="min-w-0 {c.voidedAt ? 'opacity-50' : ''}">
												<span class="{c.voidedAt ? 'line-through' : ''} text-ink-muted">
													{c.description}{#if c.quantity > 1}
														<span class="text-xs">× {c.quantity}</span>
													{/if}
												</span>
												{#if c.voidedAt}
													<div class="text-xs text-danger">
														Voided{#if c.voidReason}
															— {c.voidReason}{/if}
													</div>
												{:else if !c.isBaseCharge}
													<form method="POST" action="?/voidCharge" use:enhance>
														<input type="hidden" name="bookingId" value={o.bookingId} />
														<input type="hidden" name="chargeId" value={c.id} />
														<button
															type="submit"
															class="text-xs text-ink-muted underline underline-offset-2 hover:text-danger"
														>
															Void
														</button>
													</form>
												{/if}
											</div>
											<span
												class="shrink-0 text-right text-ink {c.voidedAt
													? 'line-through opacity-50'
													: ''}"
											>
												{peso(c.totalCentavos)}
											</span>
										</div>
									{/each}
									<div class="flex items-center justify-between gap-2 py-1.5">
										<span class="text-ink-muted">Paid on this room</span>
										<span class="shrink-0 text-ink"
											>−{peso(formFolio.paidTotalCentavos - depositAppliedCentavos)}</span
										>
									</div>
									{#if depositAppliedCentavos > 0}
										<div class="flex items-center justify-between gap-2 py-1.5">
											<span class="text-ink-muted">Security deposit applied to damage</span>
											<span class="shrink-0 text-ink">−{peso(depositAppliedCentavos)}</span>
										</div>
									{/if}
									<div class="flex items-center justify-between gap-2 py-1.5 font-semibold">
										<span class="text-ink">Room balance</span>
										<span class="shrink-0 text-ink">{peso(formFolio.balanceCentavos)}</span>
									</div>
									{#if formRoomDetail}
										<div class="py-1.5">
											<a
												href="{staffBase}/transactions/{formRoomDetail.order.id}?roomId={selectedRoomId ?? ''}"
												class="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
											>
												Open booking transaction →
											</a>
										</div>
									{/if}
								</div>

								{#if formFolio.balanceCentavos > 0}
									<div class="mt-3">
										{#if roomPayOpen}
											<PaymentFields
												action="?/recordPayment"
												kind="room"
												id={o.bookingId}
												balanceCentavos={formFolio.balanceCentavos}
												cashier={data.cashier}
												onDone={() => (roomPayOpen = false)}
											/>
											<button
												type="button"
												onclick={() => (roomPayOpen = false)}
												class="mt-1 text-xs text-ink-muted underline underline-offset-2"
											>
												Cancel
											</button>
										{:else}
											<Button size="sm" class="w-full" onclick={() => (roomPayOpen = true)}>
												Take payment ({peso(formFolio.balanceCentavos)} due)
											</Button>
										{/if}
									</div>
								{:else if formFolio.balanceCentavos < 0}
									<div class="mt-3">
										{#if roomRefundOpen}
											<PaymentFields
												action="?/refundPayment"
												kind="room"
												id={o.bookingId}
												balanceCentavos={-formFolio.balanceCentavos}
												cashier={data.cashier}
												mode="refund"
												onDone={() => (roomRefundOpen = false)}
											/>
											<button
												type="button"
												onclick={() => (roomRefundOpen = false)}
												class="mt-1 text-xs text-ink-muted underline underline-offset-2"
											>
												Cancel
											</button>
										{:else}
											<Button
												size="sm"
												variant="outline"
												class="w-full"
												onclick={() => (roomRefundOpen = true)}
											>
												Refund credit ({peso(-formFolio.balanceCentavos)})
											</Button>
										{/if}
									</div>
								{/if}

								{#if formFolio.balanceCentavos > 0 && canChargeCityLedger && formRoomDetail.booking.status === 'checked_in'}
									<div class="mt-3 rounded-lg border border-dashed border-border p-3">
										{#if checkoutCityLedger}
											<form method="POST" action="?/checkOut" use:enhance class="space-y-2">
												<input type="hidden" name="bookingId" value={o.bookingId} />
												<input type="hidden" name="cityLedger" value="1" />
												<p class="text-xs text-ink-muted">
													Move the {peso(formFolio.balanceCentavos)} balance to the Finance city ledger
													and check the guest out.
												</p>
												<Input
													name="billToName"
													placeholder="Bill to (name)"
													required
													class="h-8 text-sm"
												/>
												<Input
													name="billToCompany"
													placeholder="Company (optional)"
													class="h-8 text-sm"
												/>
												<Input
													name="billReference"
													placeholder="PO / reference (optional)"
													class="h-8 text-sm"
												/>
												<Input name="billNotes" placeholder="Note (optional)" class="h-8 text-sm" />
												<div class="flex gap-2">
													<Button type="submit" size="sm" variant="outline" class="flex-1"
														>Charge & check out</Button
													>
													<button
														type="button"
														onclick={() => (checkoutCityLedger = false)}
														class="text-xs text-ink-muted underline underline-offset-2"
													>
														Cancel
													</button>
												</div>
											</form>
										{:else}
											<button
												type="button"
												onclick={() => (checkoutCityLedger = true)}
												class="text-xs font-medium text-ink-muted underline underline-offset-2 hover:text-ink"
											>
												Check out with balance → charge to city ledger
											</button>
										{/if}
									</div>
								{/if}

								{#if roomDeposit?.status === 'held'}
									<div class="mt-4 border-t border-border pt-3">
										<h4 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
											Security deposit
										</h4>
										<p class="text-sm text-ink">
											Held: {peso(roomDeposit.amountCentavos)}
										</p>
										<form
											method="POST"
											action="?/addDamageCharge"
											use:enhance
											class="mt-2 flex items-end gap-2"
										>
											<input type="hidden" name="bookingId" value={o.bookingId} />
											<Input
												name="description"
												placeholder="Damage description"
												required
												class="h-8 flex-1 text-sm"
											/>
											<Input
												name="amount"
												type="number"
												min="0.01"
												step="0.01"
												placeholder="₱ amount"
												required
												class="h-8 w-28 text-sm"
											/>
											<Button type="submit" size="sm" variant="outline">Add damage charge</Button>
										</form>
										{#if !selectedHousekeeping || selectedHousekeeping.pendingDamageReports.length === 0}
											<p class="mt-1 text-xs text-ink-muted">
												Charging directly — no Housekeeping report on file for this.
											</p>
										{/if}
										<p class="mt-2 text-xs text-ink-muted">
											Leave a damage charge unpaid — "Settle deposit" applies it from the hold and
											refunds the rest. Taking payment for it separately first means there's
											nothing left to forfeit, so the full deposit gets refunded.
										</p>
										<form method="POST" action="?/settleDeposit" use:enhance class="mt-2">
											<input type="hidden" name="bookingId" value={o.bookingId} />
											<Button type="submit" size="sm" class="w-full">Settle deposit</Button>
										</form>
									</div>
								{:else if roomDeposit?.status === 'settled'}
									<div class="mt-4 border-t border-border pt-3">
										<h4 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
											Security deposit
										</h4>
										<p class="text-sm text-ink-muted">
											Settled — {roomDeposit.forfeitedCentavos
												? `₱${(roomDeposit.forfeitedCentavos / 100).toFixed(2)} kept for damage, `
												: ''}₱{((roomDeposit.refundedCentavos ?? 0) / 100).toFixed(2)} refunded.
											{#if roomDeposit.forfeitedCentavos && formFolio && formFolio.balanceCentavos > 0}
												<span class="font-medium text-danger"
													>₱{(formFolio.balanceCentavos / 100).toFixed(2)} of the damage is still due.</span
												>
											{/if}
										</p>
									</div>
								{/if}

								<div class="mt-4 border-t border-border pt-3">
									<h4 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
										Add quicksale charge
									</h4>
									{#if data.amenityItemOptions.length > 0}
										<form
											method="POST"
											action="?/addItemCharge"
											use:enhance
											class="flex items-end gap-2"
										>
											<input type="hidden" name="bookingId" value={o.bookingId} />
											<select
												name="amenityItemId"
												required
												class="w-full min-w-0 flex-1 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
											>
												<option value="" disabled selected>Select an item…</option>
												{#each data.amenityItemOptions as item (item.id)}
													<option value={item.id}>{item.name} — {peso(item.priceCentavos)}</option>
												{/each}
											</select>
											<Input name="quantity" type="number" min="1" value="1" class="w-16" />
											<Button type="submit" size="sm">Add</Button>
										</form>
									{:else}
										<p class="text-xs text-ink-muted">
											No sellable items set up yet — add some in
											<a href="{staffBase}/settings/amenity-items" class="underline underline-offset-2">
												Settings → Sellable items
											</a>.
										</p>
									{/if}

									{#if data.lateCheckoutFeePerHourCentavos > 0 || data.earlyCheckInFeePerHourCentavos > 0}
										<div class="mt-3 flex flex-wrap gap-2">
											{#if data.lateCheckoutFeePerHourCentavos > 0}
												<form
													method="POST"
													action="?/addExtensionCharge"
													use:enhance
													class="flex items-center gap-1.5"
												>
													<input type="hidden" name="bookingId" value={o.bookingId} />
													<input type="hidden" name="kind" value="late_checkout" />
													<Input
														name="hours"
														type="number"
														min="0.5"
														step="0.5"
														bind:value={lateFeeHours}
														class="w-16"
													/>
													<Button type="submit" size="sm" variant="outline"
														>+ Late checkout fee</Button
													>
													{#if lateHoursFromClock > 0 && lateHoursFromClock !== lateFeeHours}
														<button
															type="button"
															class="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
															onclick={() => (lateFeeHours = lateHoursFromClock)}
															>use {lateHoursFromClock}h (clock)</button
														>
													{/if}
												</form>
											{/if}
											{#if data.earlyCheckInFeePerHourCentavos > 0}
												<form
													method="POST"
													action="?/addExtensionCharge"
													use:enhance
													class="flex items-center gap-1.5"
												>
													<input type="hidden" name="bookingId" value={o.bookingId} />
													<input type="hidden" name="kind" value="early_check_in" />
													<Input
														name="hours"
														type="number"
														min="0.5"
														step="0.5"
														bind:value={earlyFeeHours}
														class="w-16"
													/>
													<Button type="submit" size="sm" variant="outline"
														>+ Early check-in fee</Button
													>
													{#if earlyHoursFromClock > 0 && earlyHoursFromClock !== earlyFeeHours}
														<button
															type="button"
															class="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
															onclick={() => (earlyFeeHours = earlyHoursFromClock)}
															>use {earlyHoursFromClock}h (clock)</button
														>
													{/if}
												</form>
											{/if}
										</div>
									{/if}
								</div>
							</div>

							<div class="mt-4 rounded-lg border border-border p-3">
								<h4 class="mb-2 text-sm font-semibold text-ink">Payments</h4>
								{#if formRoomDetail.payments.length === 0}
									<p class="text-sm text-ink-muted">No payment recorded yet.</p>
								{:else}
									<div class="space-y-2">
										{#each formRoomDetail.payments as p (p.id)}
											{@render paymentRow(p, 'room', o.bookingId)}
										{/each}
									</div>
								{/if}
							</div>

							{#if formRoomDetail.history.length > 0}
								<div class="mt-4 rounded-lg border border-border p-3">
									<h4 class="mb-2 text-sm font-semibold text-ink">Status history</h4>
									<div class="space-y-1.5">
										{#each formRoomDetail.history as h (h.id)}
											<div class="text-xs">
												<span class="text-ink-muted"
													>{h.fromStatus ? humanize(h.fromStatus) : 'created'} →</span
												>
												<span class="text-ink">{humanize(h.toStatus)}</span>
												{#if h.note}<span class="text-ink-muted"> — {h.note}</span>{/if}
											</div>
										{/each}
									</div>
								</div>
							{/if}
						{:else}
							<p class="mt-4 text-xs text-ink-muted">Loading folio…</p>
						{/if}
					{:else if selectedRoom.status === 'reserved'}
						<div class="mb-3 text-xs font-bold tracking-wide text-ink-muted uppercase">
							Expected today · {selectedRoom.expectedArrivals.length} arrival{selectedRoom
								.expectedArrivals.length > 1
								? 's'
								: ''}
						</div>
						<div class="mb-4 divide-y divide-border rounded-lg border border-border">
							{#each selectedRoom.expectedArrivals as a (a.bookingId)}
								<div class="flex items-center justify-between px-3 py-2.5">
									<div>
										<div class="text-sm font-medium text-ink">{a.guestName}</div>
										<div class="text-xs text-ink-muted">
											{channelLabel(a.channel)}
											{#if a.balanceCentavos > 0}
												<span class="font-medium text-danger">· Room balance {peso(a.balanceCentavos)}</span>
											{/if}
											<span class="mx-1 text-ink-muted/40">·</span>
											<a
												href="{staffBase}/reservations/room/{a.bookingId}?from=front-desk&roomId={selectedRoomId}"
												class="underline-offset-2 hover:text-ink hover:underline"
											>
												Check in
											</a>
											<span class="mx-1 text-ink-muted/40">·</span>
											<a
												href="{staffBase}/reservations/room/{a.bookingId}?action=cancel&from=front-desk&roomId={selectedRoomId}"
												class="underline-offset-2 hover:text-danger hover:underline"
											>
												Cancel
											</a>
										</div>
									</div>
									<Badge variant="outline" class="border-transparent bg-ok/15 text-ok">
										from {data.checkInTime.slice(0, 5)}
									</Badge>
								</div>
							{/each}
						</div>
						<p class="mb-3 text-xs text-ink-muted">
							This room is vacant right now — {selectedRoom.expectedArrivals.length > 1
								? 'these are'
								: 'this is'} confirmed {selectedRoom.roomTypeName} booking{selectedRoom
								.expectedArrivals.length > 1
								? 's'
								: ''} arriving today, not yet assigned to a specific room. Assign one at check-in from
							the booking's own page.
						</p>
						{#if data.earlyCheckInFeePerHourCentavos > 0}
							<p class="mb-4 rounded-md bg-surface-2 px-3 py-2 text-xs text-ink-muted">
								Wants to move in before {data.checkInTime.slice(0, 5)}? Early check-in fee:
								<strong class="text-ink">{peso(data.earlyCheckInFeePerHourCentavos)}/hour</strong> — add
								it to the folio once they've checked in.
							</p>
						{/if}
						<Button variant="outline" class="w-full" href="{staffBase}/reservations">
							View today's {selectedRoom.roomTypeName} arrivals →
						</Button>
					{:else if selectedRoom.status === 'vacant'}
						<p class="text-sm text-ink-muted">No booking for this room right now.</p>
						<p class="mb-4 text-xs text-ink-muted">
							{roomTypeCapacityLabel(selectedRoom.roomTypeId) ?? ''}
						</p>
						<Button class="w-full" onclick={() => startPickMode(selectedRoom)}>
							<MousePointerClickIcon class="size-3.5" />
							Select for walk-in
						</Button>
					{:else if selectedRoom.status === 'ooo'}
						<p class="text-sm text-ink-muted">{selectedRoom.notes ?? 'Marked out of order.'}</p>
					{/if}
				</div>
			{:else}
				<div class="p-4">
					<div class="mb-3 flex gap-1 rounded-lg bg-surface-2 p-1">
						<button
							type="button"
							class="flex-1 rounded-md px-2 py-1.5 text-xs font-semibold {railTab === 'arrivals'
								? 'bg-surface text-ink shadow-sm'
								: 'text-ink-muted'}"
							onclick={() => (railTab = 'arrivals')}
						>
							Arrivals · {data.arrivals.length}
						</button>
						<button
							type="button"
							class="flex-1 rounded-md px-2 py-1.5 text-xs font-semibold {railTab === 'departures'
								? 'bg-surface text-ink shadow-sm'
								: 'text-ink-muted'}"
							onclick={() => (railTab = 'departures')}
						>
							Departures · {data.departures.length}
						</button>
					</div>
					{#if railTab === 'arrivals'}
						{#if data.arrivals.length === 0}
							<p class="text-sm text-ink-muted">No arrivals expected today.</p>
						{:else}
							<div class="divide-y divide-border">
								{#each data.arrivals as a (a.bookingId)}
									<div class="flex items-center justify-between py-2.5">
										<div>
											<div class="text-sm font-medium text-ink">{a.guestName}</div>
											<div class="text-xs text-ink-muted">
												{a.roomTypeName} · {channelLabel(a.channel)}
												{#if a.balanceCentavos > 0}
													<span class="font-medium text-danger">· Room balance {peso(a.balanceCentavos)}</span>
												{/if}
												<span class="mx-1 text-ink-muted/40">·</span>
												<a
													href="{staffBase}/reservations/room/{a.bookingId}?from=front-desk"
													class="underline-offset-2 hover:text-ink hover:underline"
												>
													Check in
												</a>
												<span class="mx-1 text-ink-muted/40">·</span>
												<a
													href="{staffBase}/reservations/room/{a.bookingId}?action=cancel&from=front-desk"
													class="underline-offset-2 hover:text-danger hover:underline"
												>
													Cancel
												</a>
											</div>
										</div>
										<Badge variant="outline" class="border-transparent bg-ok/15 text-ok">
											from {data.checkInTime.slice(0, 5)}
										</Badge>
									</div>
								{/each}
							</div>
						{/if}
					{:else if data.departures.length === 0}
						<p class="text-sm text-ink-muted">No departures expected today.</p>
					{:else}
						<div class="divide-y divide-border">
							{#each data.departures as d (d.bookingId)}
								<button
									type="button"
									class="flex w-full items-center justify-between py-2.5 text-left hover:opacity-80"
									onclick={() => (selectedRoomId = d.roomId)}
								>
									<div>
										<div class="text-sm font-medium text-ink">{d.guestName}</div>
										<div class="text-xs text-ink-muted">Room {d.roomNumber} · {d.roomTypeName}</div>
									</div>
									<Badge variant="outline" class="border-transparent bg-ok/15 text-ok">
										by {data.checkOutTime.slice(0, 5)}
									</Badge>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>

<Sheet.Root bind:open={walkInOpen}>
	<Sheet.Content side="right" class="w-full overflow-y-auto sm:max-w-md">
		<Sheet.Header>
			<Sheet.Title>Walk-in booking</Sheet.Title>
		</Sheet.Header>
		<div class="px-4 pb-6">
			{#if walkInFlow === 'search'}
				<form
					method="POST"
					action="?/walkInSearch"
					bind:this={walkInSearchFormEl}
					use:enhance={() => {
						return async ({ update }) => {
							await update({ reset: false });
						};
					}}
					class="space-y-3"
				>
					<div class="grid grid-cols-2 gap-3">
						<div>
							<Label for="wiCheckIn">Check-in</Label>
							<Input
								id="wiCheckIn"
								type="date"
								name="checkIn"
								bind:value={wiCheckIn}
								onchange={scheduleWalkInSearch}
							/>
						</div>
						<div>
							<Label for="wiCheckOut">Check-out</Label>
							<Input
								id="wiCheckOut"
								type="date"
								name="checkOut"
								bind:value={wiCheckOut}
								onchange={scheduleWalkInSearch}
							/>
						</div>
						<div>
							<Label for="wiOccupancy">Guests</Label>
							<Input
								id="wiOccupancy"
								type="number"
								min="1"
								max="20"
								name="occupancy"
								bind:value={wiOccupancy}
								oninput={scheduleWalkInSearch}
							/>
						</div>
						<div>
							<Label for="wiRoomCount">Rooms</Label>
							<Input
								id="wiRoomCount"
								type="number"
								min="1"
								max="8"
								name="roomCount"
								oninput={scheduleWalkInSearch}
								bind:value={wiRoomCount}
							/>
						</div>
					</div>
					<Button type="submit" variant="outline" class="w-full">Check availability</Button>
				</form>

				{#if formAvailableRoomTypes}
					{#if formAvailableRoomTypes.length === 0}
						<div class="mt-4 rounded-lg border border-dashed border-border p-3">
							<p class="text-sm text-ink-muted">No rooms available for these dates/occupancy.</p>
							{#if formUnpaidHolds.length > 0}
								<div class="mt-2 rounded-md bg-surface-2 px-3 py-2 text-xs text-ink-muted">
									<p class="font-medium text-ink">
										Held by an online booking waiting for payment:
									</p>
									<ul class="mt-1 space-y-0.5">
										{#each formUnpaidHolds as h, i (i)}
											<li>
												{h.rooms} × {h.roomTypeName}, {h.checkIn} → {h.checkOut} — released
												automatically at {holdTime(h.expiresAtIso)} if not paid.
											</li>
										{/each}
									</ul>
								</div>
							{/if}
							{#if formSuggestedRoomCount}
								<p class="mt-1.5 text-xs text-ink-muted">
									No room type fits {formWalkInSearch?.occupancy} guests in {formWalkInSearch?.roomCount}
									room{formWalkInSearch?.roomCount === 1 ? '' : 's'}, even with extra beds.
								</p>
								<Button
									type="button"
									size="sm"
									variant="outline"
									class="mt-2"
									onclick={() => useSuggestedRoomCount(formSuggestedRoomCount!)}
								>
									Try {formSuggestedRoomCount} rooms instead
								</Button>
							{/if}
						</div>
					{:else}
						<div class="mt-4 divide-y divide-border rounded-lg border border-border">
							{#each formAvailableRoomTypes as rt (rt.id)}
								{#each rt.ratePlans as plan (plan.id)}
									<div
										class="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-surface-2"
									>
										<div>
											<div class="text-sm font-medium text-ink">{rt.name}</div>
											<div class="text-xs text-ink-muted">
												{plan.name} · {rt.availableRooms} free
												{#if rt.extraBedsNeeded > 0}
													<span
														class="ml-1 rounded border border-border px-1 py-0.5 text-[10px] font-medium text-ink"
													>
														+{rt.extraBedsNeeded} extra bed{rt.extraBedsNeeded === 1 ? '' : 's'}
														{#if plan.extraBedFeeCentavos}
															({peso(rt.extraBedsNeeded * plan.extraBedFeeCentavos)})
														{/if}
													</span>
												{/if}
											</div>
											{#if rt.extraBedsNeeded > 0 && rt.suggestedRoomCount}
												<button
													type="button"
													onclick={(e) => {
														e.preventDefault();
														useSuggestedRoomCount(rt.suggestedRoomCount!);
													}}
													class="mt-0.5 text-[11px] text-ink-muted underline underline-offset-2 hover:text-ink"
												>
													or use {rt.suggestedRoomCount} rooms instead, no extra bed
												</button>
											{/if}
										</div>
										<div class="flex items-center gap-3">
											<div class="text-sm font-medium text-ink">
												{peso(walkInLineTotal(rt, plan))}
											</div>
											<Button type="button" size="sm" onclick={() => addToWalkInCart(rt, plan)}>
												Add
											</Button>
										</div>
									</div>
								{/each}
							{/each}
						</div>
					{/if}
				{/if}
			{/if}

			{#if walkInCart.length > 0}
				<div class="mt-4 mb-2 flex items-center justify-between">
					<span class="text-xs font-medium text-ink-muted">
						{walkInFlow === 'pick' ? 'Selected from the room grid' : 'From your search'}
					</span>
					<button
						type="button"
						onclick={resetWalkInFlow}
						class="text-xs font-semibold text-ink-muted hover:text-ink"
					>
						Start over
					</button>
				</div>
				<div class="divide-y divide-border rounded-lg border border-border">
					{#each walkInCart as line (line.id)}
						<div class="flex items-center justify-between gap-3 px-3 py-2.5">
							<div class="min-w-0">
								<div class="truncate text-sm font-medium text-ink">
									{#if line.roomId}
										Room {line.roomNumber} · {line.roomTypeName}
									{:else}
										{line.roomTypeName}
									{/if}
								</div>
								{#if line.ratePlanOptions && line.ratePlanOptions.length > 1}
									<select
										class="mt-0.5 rounded-md border border-input bg-transparent px-1.5 py-0.5 text-xs text-ink-muted"
										value={line.ratePlanId}
										onchange={(e) => setWalkInCartLineRatePlan(line.id, e.currentTarget.value)}
									>
										{#each line.ratePlanOptions as opt (opt.id)}
											<option value={opt.id}>{opt.name}</option>
										{/each}
									</select>
								{:else}
									<div class="text-xs text-ink-muted">{line.ratePlanName}</div>
								{/if}
								<div class="text-[11px] text-ink-muted">{line.checkIn} → {line.checkOut}</div>
								{#if line.extraBedsNeeded > 0}
									<span
										class="mt-1 inline-block rounded border border-border px-1 py-0.5 text-[10px] font-medium text-ink"
									>
										+{line.extraBedsNeeded} extra bed{line.extraBedsNeeded === 1 ? '' : 's'}
										{#if line.extraBedFeeCentavos}
											({peso(line.extraBedsNeeded * line.extraBedFeeCentavos)})
										{/if}
									</span>
								{/if}
							</div>
							<div class="flex items-center gap-1">
								{#if line.roomId}
									<span class="px-1 text-xs text-ink-muted">1 room</span>
								{:else}
									<Button
										type="button"
										size="icon"
										variant="outline"
										class="size-7"
										disabled={line.roomCount <= 1}
										onclick={() => bumpWalkInCartQty(line.id, -1)}
									>
										<MinusIcon class="size-3.5" />
									</Button>
									<span class="w-5 text-center text-sm tabular-nums">{line.roomCount}</span>
									<Button
										type="button"
										size="icon"
										variant="outline"
										class="size-7"
										disabled={line.roomCount >= Math.min(MAX_ROOMS_PER_LINE, line.availableRooms)}
										onclick={() => bumpWalkInCartQty(line.id, 1)}
									>
										<PlusIcon class="size-3.5" />
									</Button>
								{/if}
							</div>
							<div class="w-20 text-right text-sm font-medium text-ink">
								{peso(walkInCartLineTotal(line))}
							</div>
							<Button
								type="button"
								size="icon"
								variant="ghost"
								class="size-7"
								onclick={() => removeFromWalkInCart(line.id)}
							>
								<XIcon class="size-3.5" />
							</Button>
						</div>
					{/each}
					<div class="flex items-center justify-between px-3 py-2.5">
						<span class="text-sm font-medium text-ink">Total</span>
						<span class="text-sm font-semibold text-ink">{peso(walkInCartGrandTotal)}</span>
					</div>
				</div>
			{/if}

			{#if walkInCart.length > 0}
				<form
						method="POST"
						action="?/walkInCreate"
						use:enhance
						class="mt-4 space-y-3 border-t border-border pt-4"
							>
						<input
							type="hidden"
							name="itemsJson"
							value={JSON.stringify(
								walkInCart.map((l) => ({
									roomTypeId: l.roomTypeId,
									ratePlanId: l.ratePlanId,
									checkIn: l.checkIn,
									checkOut: l.checkOut,
									occupancy: l.occupancy,
									roomCount: l.roomCount,
									...(l.roomId ? { roomIds: [l.roomId] } : {})
								}))
							)}
						/>
						<input type="hidden" name="originRoomId" value={selectedRoomId ?? ''} />
						<div>
							<Label for="wiFullName">Full name</Label>
							<Input id="wiFullName" name="fullName" required maxlength={160} />
						</div>
						<div class="grid grid-cols-2 gap-3">
							<div>
								<Label for="wiEmail">Email</Label>
								<Input id="wiEmail" name="email" type="email" required />
							</div>
							<div>
								<Label for="wiPhone">Phone</Label>
								<Input id="wiPhone" name="phone" maxlength={40} />
							</div>
						</div>
						<div>
							<Label for="wiSpecialRequests">Special requests</Label>
							<textarea
								id="wiSpecialRequests"
								name="specialRequests"
								maxlength={1000}
								rows="2"
								class="w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
							></textarea>
						</div>
						<WalkinPaymentFields
						totalCentavos={walkInCartGrandTotal}
						cashier={data.cashier}
						rooms={walkInCart.map((l) => ({
							label: `${l.roomNumber ? `Room ${l.roomNumber} · ` : ''}${l.roomTypeName}${l.roomCount > 1 ? ` × ${l.roomCount}` : ''}`,
							totalCentavos: walkInCartLineTotal(l)
						}))}
					/>
						<Button type="submit" class="w-full">Create booking &amp; record payment</Button>
							</form>
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>

<Dialog.Root bind:open={hallDetailDialogOpen}>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-lg">
		{#if formHallBookingDetail}
			<Dialog.Header>
				<Dialog.Title
					>{formHallBookingDetail.hall.name} — {formHallBookingDetail.guest.fullName}</Dialog.Title
				>
				<Dialog.Description>{formHallBookingDetail.hallBooking.eventType}</Dialog.Description>
			</Dialog.Header>

			<div class="space-y-4">
				<div class="rounded-lg border border-border p-4">
					<h3 class="mb-2 text-sm font-semibold text-ink">Guest</h3>
					<div class="text-sm text-ink">{formHallBookingDetail.guest.fullName}</div>
					<div class="text-sm text-ink-muted">{formHallBookingDetail.guest.email}</div>
					{#if formHallBookingDetail.guest.phone}
						<div class="text-sm text-ink-muted">{formHallBookingDetail.guest.phone}</div>
					{/if}
					{#if formHallBookingDetail.guest.specialRequests}
						<p class="mt-2 text-xs text-ink-muted">
							Special requests: {formHallBookingDetail.guest.specialRequests}
						</p>
					{/if}
				</div>

				<div class="rounded-lg border border-border p-4">
					<h3 class="mb-2 text-sm font-semibold text-ink">Event</h3>
					<div class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
						<div>
							<div class="text-xs text-ink-muted">Event date</div>
							<div class="text-ink">{formHallBookingDetail.hallBooking.eventDate}</div>
						</div>
						<div>
							<div class="text-xs text-ink-muted">Time</div>
							<div class="text-ink">
								{formHallBookingDetail.hallBooking.startTime}–{formHallBookingDetail.hallBooking
									.endTime}
							</div>
						</div>
						<div>
							<div class="text-xs text-ink-muted">Guests</div>
							<div class="text-ink">{formHallBookingDetail.hallBooking.guestCount}</div>
						</div>
					</div>
				</div>

				<div class="rounded-lg border border-border p-4">
					<div class="mb-2 flex items-center justify-between">
						<h3 class="text-sm font-semibold text-ink">Folio</h3>
						{#if formHallFolio}
							<Badge
								variant="outline"
								class={formHallFolio.balanceCentavos > 0
									? 'border-transparent bg-danger/15 text-danger'
									: 'border-transparent bg-ok/15 text-ok'}
							>
								{formHallFolio.balanceCentavos > 0
									? `Balance due ${peso(formHallFolio.balanceCentavos)}`
									: 'Settled'}
							</Badge>
						{/if}
					</div>

					{#if formHallFolio}
						<Table.Root>
							<Table.Body>
								{#each formHallFolio.charges as c (c.id)}
									<Table.Row class={c.voidedAt ? 'opacity-50' : ''}>
										<Table.Cell class="text-ink-muted">
											<span class={c.voidedAt ? 'line-through' : ''}>
												{c.description}{#if c.quantity > 1}<span class="text-xs">
														× {c.quantity}</span
													>{/if}
											</span>
											{#if c.voidedAt}
												<span class="ml-1.5 text-xs text-danger"
													>Voided{#if c.voidReason}
														— {c.voidReason}{/if}</span
												>
											{/if}
										</Table.Cell>
										<Table.Cell class="text-right text-ink">
											<span class={c.voidedAt ? 'line-through' : ''}>{peso(c.totalCentavos)}</span>
										</Table.Cell>
										<Table.Cell class="w-8 text-right">
											{#if !c.isBaseCharge && !c.voidedAt}
												<form method="POST" action="?/voidHallCharge" use:enhance>
													<input
														type="hidden"
														name="hallBookingId"
														value={formHallBookingDetail.hallBooking.id}
													/>
													<input type="hidden" name="chargeId" value={c.id} />
													<button
														type="submit"
														class="text-xs text-ink-muted underline underline-offset-2 hover:text-danger"
													>
														Void
													</button>
												</form>
											{/if}
										</Table.Cell>
									</Table.Row>
								{/each}
								<Table.Row>
									<Table.Cell class="text-ink-muted">Paid</Table.Cell>
									<Table.Cell class="text-right text-ink"
										>−{peso(formHallFolio.paidTotalCentavos)}</Table.Cell
									>
									<Table.Cell></Table.Cell>
								</Table.Row>
								<Table.Row>
									<Table.Cell class="font-semibold text-ink">Balance</Table.Cell>
									<Table.Cell class="text-right font-semibold text-ink"
										>{peso(formHallFolio.balanceCentavos)}</Table.Cell
									>
									<Table.Cell></Table.Cell>
								</Table.Row>
							</Table.Body>
						</Table.Root>

						{#if formHallFolio.balanceCentavos > 0}
							<div class="mt-3">
								{#if hallPayOpen}
									<PaymentFields
										action="?/recordPayment"
										kind="hall"
										id={formHallBookingDetail.hallBooking.id}
										balanceCentavos={formHallFolio.balanceCentavos}
										cashier={data.cashier}
										onDone={() => (hallPayOpen = false)}
									/>
									<button
										type="button"
										onclick={() => (hallPayOpen = false)}
										class="mt-1 text-xs text-ink-muted underline underline-offset-2"
									>
										Cancel
									</button>
								{:else}
									<Button size="sm" class="w-full" onclick={() => (hallPayOpen = true)}>
										Take payment ({peso(formHallFolio.balanceCentavos)} due)
									</Button>
								{/if}
							</div>
						{:else if formHallFolio.balanceCentavos < 0}
							<div class="mt-3">
								{#if hallRefundOpen}
									<PaymentFields
										action="?/refundPayment"
										kind="hall"
										id={formHallBookingDetail.hallBooking.id}
										balanceCentavos={-formHallFolio.balanceCentavos}
										cashier={data.cashier}
										mode="refund"
										onDone={() => (hallRefundOpen = false)}
									/>
									<button
										type="button"
										onclick={() => (hallRefundOpen = false)}
										class="mt-1 text-xs text-ink-muted underline underline-offset-2"
									>
										Cancel
									</button>
								{:else}
									<Button
										size="sm"
										variant="outline"
										class="w-full"
										onclick={() => (hallRefundOpen = true)}
									>
										Refund credit ({peso(-formHallFolio.balanceCentavos)})
									</Button>
								{/if}
							</div>
						{/if}

						<div class="mt-4 border-t border-border pt-3">
							<h4 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
								Add quicksale charge
							</h4>
							{#if data.amenityItemOptions.length > 0}
								<form
									method="POST"
									action="?/addHallItemCharge"
									use:enhance
									class="flex items-end gap-2"
								>
									<input
										type="hidden"
										name="hallBookingId"
										value={formHallBookingDetail.hallBooking.id}
									/>
									<select
										name="amenityItemId"
										required
										class="w-full min-w-0 flex-1 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
									>
										<option value="" disabled selected>Select an item…</option>
										{#each data.amenityItemOptions as item (item.id)}
											<option value={item.id}>{item.name} — {peso(item.priceCentavos)}</option>
										{/each}
									</select>
									<Input name="quantity" type="number" min="1" value="1" class="w-16" />
									<Button type="submit" size="sm">Add</Button>
								</form>
							{:else}
								<p class="text-xs text-ink-muted">
									No sellable items set up yet — add some in
									<a href="{staffBase}/settings/amenity-items" class="underline underline-offset-2">
										Settings → Sellable items
									</a>.
								</p>
							{/if}
						</div>
					{/if}
				</div>

				<div class="rounded-lg border border-border p-4">
					<h3 class="mb-2 text-sm font-semibold text-ink">Payments</h3>
					{#if formHallBookingDetail.payments.length === 0}
						<p class="text-sm text-ink-muted">No payment recorded yet.</p>
					{:else}
						<div class="space-y-2">
							{#each formHallBookingDetail.payments as p (p.id)}
								{@render paymentRow(p, 'hall', formHallBookingDetail.hallBooking.id)}
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Sheet.Root bind:open={hallWalkInOpen}>
	<Sheet.Content side="right" class="w-full overflow-y-auto sm:max-w-md">
		<Sheet.Header>
			<Sheet.Title>Walk-in event — {hallWalkInHall?.hallName ?? ''}</Sheet.Title>
		</Sheet.Header>
		<div class="px-4 pb-6">
			<form method="POST" action="?/hallWalkInCreate" use:enhance class="space-y-3">
				<input type="hidden" name="functionHallId" value={hallWalkInHall?.functionHallId ?? ''} />
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="heEventDate">Event date</Label>
						<Input
							id="heEventDate"
							type="date"
							name="eventDate"
							bind:value={heEventDate}
							onchange={fetchHallQuote}
							required
						/>
					</div>
					<div>
						<Label for="heEventType">Event type</Label>
						<Input
							id="heEventType"
							name="eventType"
							placeholder="Birthday"
							required
							maxlength={80}
						/>
					</div>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="heStartTime">Start time</Label>
						<Input
							id="heStartTime"
							type="time"
							name="startTime"
							bind:value={heStartTime}
							onchange={fetchHallQuote}
							required
						/>
					</div>
					<div>
						<Label for="heEndTime">End time</Label>
						<Input
							id="heEndTime"
							type="time"
							name="endTime"
							bind:value={heEndTime}
							onchange={fetchHallQuote}
							required
						/>
					</div>
				</div>
				<div>
					<Label for="heGuestCount">Guest count</Label>
					<Input id="heGuestCount" type="number" min="1" name="guestCount" value="1" required />
				</div>

				<div class="rounded-lg border border-border p-3">
					<h3 class="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
						<ReceiptIcon class="size-4" />
						Rate
					</h3>
					{#if hallQuoteLoading}
						<p class="text-xs text-ink-muted">Pricing…</p>
					{:else if hallQuoteError}
						<p class="text-xs text-danger">{hallQuoteError}</p>
					{:else if hallQuote}
						<div class="space-y-1.5 text-sm">
							<div class="flex justify-between">
								<span class="text-ink-muted">Base ({hallQuote.baseHours}h included)</span>
								<span class="text-ink">{peso(hallQuote.basePriceCentavos)}</span>
							</div>
							{#if hallQuote.extraHours > 0}
								<div class="flex justify-between">
									<span class="text-ink-muted">
										Extra {hallQuote.extraHours}h × {peso(hallQuote.extraHourFeeCentavos)}
									</span>
									<span class="text-ink">{peso(hallQuote.extraHoursCostCentavos)}</span>
								</div>
							{/if}
							{#each hallQuote.fees as fee (fee.name)}
								<div class="flex justify-between">
									<span class="text-ink-muted">{fee.name}</span>
									<span class="text-ink">{peso(fee.amountCentavos)}</span>
								</div>
							{/each}
							<div class="flex justify-between">
								<span class="text-ink-muted">VAT</span>
								<span class="text-ink">{peso(hallQuote.vatCentavos)}</span>
							</div>
							<div class="flex justify-between border-t border-border pt-1.5 font-semibold">
								<span class="text-ink">Total</span>
								<span class="text-ink">{peso(hallQuote.totalCentavos)}</span>
							</div>
						</div>
					{/if}
				</div>

				<div class="border-t border-border pt-3">
					<Label for="heFullName">Full name</Label>
					<Input id="heFullName" name="fullName" required maxlength={160} class="mt-1" />
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="heEmail">Email</Label>
						<Input id="heEmail" name="email" type="email" required />
					</div>
					<div>
						<Label for="hePhone">Phone</Label>
						<Input id="hePhone" name="phone" maxlength={40} />
					</div>
				</div>
				<div>
					<Label for="heSpecialRequests">Special requests</Label>
					<textarea
						id="heSpecialRequests"
						name="specialRequests"
						maxlength={1000}
						rows="2"
						class="w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
					></textarea>
				</div>
				<WalkinPaymentFields
					totalCentavos={hallQuote?.totalCentavos ?? null}
					cashier={data.cashier}
				/>
				<Button type="submit" class="w-full" disabled={!hallQuote || hallQuoteLoading}>
					Create &amp; settle booking
				</Button>
			</form>
		</div>
	</Sheet.Content>
</Sheet.Root>

<AvailabilityCalendarSheet
	bind:open={calendarOpen}
	target={calendarTarget}
	base={staffBase}
	businessDate={data.businessDate}
/>

<!-- Fetches on demand when a room's name is clicked — see openRoomTypeDetail. Kept
     unconditionally rendered (not nested under any status branch) so it's always
     available regardless of which room/rail state is currently showing. -->
<form
	method="POST"
	action="?/roomTypeDetail"
	use:enhance
	bind:this={roomTypeDetailFormEl}
	class="hidden"
>
	<input type="hidden" name="roomTypeId" value={roomTypeDetailRoomTypeId} />
</form>

<Dialog.Root bind:open={roomTypeDetailOpen}>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
		{#if formRoomTypeDetail}
			{@const rt = formRoomTypeDetail}
			{@const photos = rt.photos}
			<Dialog.Header>
				<Dialog.Title>{rt.name}</Dialog.Title>
				{#if rt.category}
					<Dialog.Description class="capitalize">{rt.category}</Dialog.Description>
				{/if}
			</Dialog.Header>

			<div class="space-y-4">
				{#if photos.length > 0}
					<div class="space-y-2">
						<div class="aspect-video overflow-hidden rounded-lg bg-surface-2">
							<img
								src={photos[roomTypeDetailActivePhoto]?.url}
								alt={rt.name}
								class="size-full object-cover"
							/>
						</div>
						{#if photos.length > 1}
							<div class="flex gap-2 overflow-x-auto pb-1">
								{#each photos as p, i (p.url + i)}
									<button
										type="button"
										onclick={() => (roomTypeDetailActivePhoto = i)}
										class="size-14 shrink-0 overflow-hidden rounded-md border-2 {i ===
										roomTypeDetailActivePhoto
											? 'border-brand'
											: 'border-transparent'}"
									>
										<img src={p.url} alt="" class="size-full object-cover" />
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				<div class="flex flex-wrap gap-2">
					<Badge variant="outline" class="border-border text-ink-muted">
						{rt.baseOccupancy}–{rt.maxOccupancy} guests
					</Badge>
					{#if rt.sizeSqm}
						<Badge variant="outline" class="border-border text-ink-muted">{rt.sizeSqm} m²</Badge>
					{/if}
					{#if rt.bedConfiguration.length > 0}
						<Badge variant="outline" class="border-border text-ink-muted">
							{rt.bedConfiguration.map((b) => `${b.quantity} ${b.type}`).join(', ')}
							{#if rt.bedFlexible}(flexible){/if}
						</Badge>
					{/if}
					{#if rt.viewType}
						<Badge variant="outline" class="border-border text-ink-muted capitalize"
							>{rt.viewType.replace(/_/g, ' ')}</Badge
						>
					{/if}
					<Badge variant="outline" class="border-border text-ink-muted capitalize">
						{rt.smokingPolicy.replace(/_/g, ' ')}
					</Badge>
					{#if rt.wheelchairAccessible}
						<Badge variant="outline" class="border-border text-ink-muted"
							>Wheelchair accessible</Badge
						>
					{/if}
					{#if rt.rollInShower}
						<Badge variant="outline" class="border-border text-ink-muted">Roll-in shower</Badge>
					{/if}
					{#if rt.grabBars}
						<Badge variant="outline" class="border-border text-ink-muted">Grab bars</Badge>
					{/if}
				</div>

				{#if rt.flexibilityNote}
					<p class="text-xs text-ink-muted">{rt.flexibilityNote}</p>
				{/if}

				{#if rt.description}
					<p class="text-sm text-ink">{rt.description}</p>
				{/if}

				{#if rt.amenities.length > 0}
					<div>
						<h3 class="mb-2 text-sm font-semibold text-ink">Amenities</h3>
						<div class="grid gap-3 sm:grid-cols-2">
							{#each AMENITY_CATEGORY_ORDER as category (category)}
								{@const items = rt.amenities.filter((a) => a.category === category)}
								{#if items.length > 0}
									<div>
										<div class="mb-1 text-xs font-semibold text-ink-muted uppercase">
											{AMENITY_CATEGORY_LABELS[category]}
										</div>
										<ul class="space-y-0.5 text-sm text-ink">
											{#each items as item (item.name)}
												<li>{item.name}</li>
											{/each}
										</ul>
									</div>
								{/if}
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
