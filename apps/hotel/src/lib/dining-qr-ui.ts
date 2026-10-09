/**
 * What a guest at a table is told about their orders: plain words per status, how far along each one is,
 * and the numbers on the top bar and the bill. Pure, so it is tested without the page.
 */

/** An order as the guest sees it (what `listMyQrOrders` returns, with dates as text). */
export interface TableOrder extends TableOrderLite {
	code: string;
	createdAt: string;
	cancelReason: string | null;
	items: { name: string; quantity: number; addons: string[] }[];
}

export const peso = (c: number) =>
	`₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface TableOrderLite {
	status: string;
	paymentStatus: string;
	totalCentavos: number;
}

// ---- the menu's categories -----------------------------------------------------------------

export interface MenuSection<T> {
	id: string;
	name: string;
	items: T[];
}

export const ALL_CATEGORIES = 'all';

/**
 * The menu split by category, in the order the restaurant set them, with any dish that has no category
 * gathered under "Also" (or no heading at all when nothing has a category). Empty categories are left out.
 */
export function buildMenuSections<T extends { categoryId: string | null }>(categories: { id: string; name: string }[], items: T[]): MenuSection<T>[] {
	const out: MenuSection<T>[] = categories.map((c) => ({ id: c.id, name: c.name, items: items.filter((i) => i.categoryId === c.id) }));
	const loose = items.filter((i) => !categories.some((c) => c.id === i.categoryId));
	if (loose.length) out.push({ id: 'other', name: out.length ? 'Also' : '', items: loose });
	return out.filter((s) => s.items.length > 0);
}

/** The chips: "All", then each named category. Nothing to choose between when there is only one section. */
export function categoryChips<T>(sections: MenuSection<T>[]): { id: string; name: string }[] {
	const named = sections.filter((s) => s.name);
	return named.length > 1 ? [{ id: ALL_CATEGORIES, name: 'All' }, ...named.map((s) => ({ id: s.id, name: s.name }))] : [];
}

/** Which category is really selected: the one asked for if it is still on the menu, otherwise All. */
export const effectiveCategory = <T>(sections: MenuSection<T>[], selected: string) =>
	selected !== ALL_CATEGORIES && sections.some((s) => s.id === selected) ? selected : ALL_CATEGORIES;

/** The sections to show for the selected category. */
export const visibleSections = <T>(sections: MenuSection<T>[], selected: string) => {
	const pick = effectiveCategory(sections, selected);
	return pick === ALL_CATEGORIES ? sections : sections.filter((s) => s.id === pick);
};

/** One sentence per status, from the guest's side of the table. */
export const STATUS_LABEL: Record<string, string> = {
	pending_acceptance: 'Waiting for the restaurant to confirm',
	new: 'Sent to the kitchen',
	accepted: 'Sent to the kitchen',
	preparing: 'Being prepared',
	ready: 'Ready, on its way to your table',
	served: 'Served',
	cancelled: 'Not accepted'
};
export const statusLabel = (status: string) => STATUS_LABEL[status] ?? status;

/** Which colour family and icon an order's status wears. Colour never stands alone: the label is always shown with it. */
export type StatusTone = 'sent' | 'preparing' | 'ready' | 'served' | 'bad';
export const statusTone = (status: string): StatusTone => {
	switch (status) {
		case 'pending_acceptance':
		case 'new':
		case 'accepted':
			return 'sent';
		case 'preparing':
			return 'preparing';
		case 'ready':
			return 'ready';
		case 'served':
			return 'served';
		default:
			return 'bad';
	}
};
/** The fixed status palette: text colour on its soft background. Mirrored in `(table)/table-ordering.css`. */
export const STATUS_COLORS: Record<StatusTone, { fg: string; bg: string }> = {
	sent: { fg: '#1d4ed8', bg: '#e6edff' },
	preparing: { fg: '#a84908', bg: '#fff0d9' },
	ready: { fg: '#13733a', bg: '#dcf5e5' },
	served: { fg: '#475569', bg: '#e9edf2' },
	bad: { fg: '#b91c1c', bg: '#fde6e6' }
};

/** Short pill text, one or two words. */
export const STATUS_SHORT: Record<string, string> = {
	pending_acceptance: 'Waiting to confirm',
	new: 'Sent',
	accepted: 'Sent',
	preparing: 'Preparing',
	ready: 'Ready',
	served: 'Served',
	cancelled: 'Not accepted'
};
export const statusShort = (status: string) => STATUS_SHORT[status] ?? status;

/** The four steps of an order's journey, in order. */
export const STEPS = ['Sent', 'Preparing', 'Ready', 'Served'] as const;

/** Which step an order is on (0–3), or −1 when it has left the journey (cancelled / not accepted). */
export function stepIndex(status: string): number {
	switch (status) {
		case 'pending_acceptance':
		case 'new':
		case 'accepted':
			return 0;
		case 'preparing':
			return 1;
		case 'ready':
			return 2;
		case 'served':
			return 3;
		default:
			return -1;
	}
}

/** Still on its way: not served and not cancelled. */
export const isLive = (status: string) => status !== 'served' && status !== 'cancelled';

export const liveCount = (orders: { status: string }[]) => orders.filter((o) => isLive(o.status)).length;

/** What the table still owes: orders that were not cancelled and are not yet paid. */
export const billTotal = (orders: TableOrderLite[]) =>
	orders.filter((o) => o.status !== 'cancelled' && o.paymentStatus === 'unpaid').reduce((s, o) => s + o.totalCentavos, 0);

/** "1 order in progress" / "3 orders in progress", for the badge's accessible name. */
export const inProgressLabel = (n: number) => `${n} ${n === 1 ? 'order' : 'orders'} in progress`;

/** The one line under "My orders": what is happening right now. */
export function summaryLine(orders: { status: string }[]): string {
	if (orders.length === 0) return '';
	const live = orders.filter((o) => isLive(o.status));
	if (live.length === 0) return 'Everything has been served';
	if (live.some((o) => o.status === 'ready')) return 'Your food is on its way';
	if (live.some((o) => o.status === 'preparing')) return live.length === 1 ? '1 order being prepared' : `${live.length} orders in progress`;
	if (live.every((o) => o.status === 'pending_acceptance')) return 'Waiting for the restaurant to confirm';
	return live.length === 1 ? '1 order sent to the kitchen' : `${live.length} orders in progress`;
}
