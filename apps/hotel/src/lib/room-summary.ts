/** Today's room figures for the staff dashboard, from the front-desk room grid's cells. Pure. */

export interface RoomSummaryCell {
	status: 'vacant' | 'occupied' | 'departing' | 'reserved' | 'ooo';
	occupant: { occupancy: number } | null;
}

export interface RoomSummary {
	/** Rooms with a checked-in guest (occupied or departing, overdue included). */
	occupiedRooms: number;
	/** Guests in those rooms. */
	inHouseGuests: number;
	/** Rooms that could be sold tonight — out-of-order rooms excluded. */
	sellableRooms: number;
	/** occupiedRooms / sellableRooms, whole percent; 0 when nothing is sellable. */
	occupancyPct: number;
}

export function summarizeRooms(cells: RoomSummaryCell[]): RoomSummary {
	let occupiedRooms = 0;
	let inHouseGuests = 0;
	let ooo = 0;
	for (const c of cells) {
		if (c.status === 'ooo') ooo++;
		if ((c.status === 'occupied' || c.status === 'departing') && c.occupant) {
			occupiedRooms++;
			inHouseGuests += c.occupant.occupancy;
		}
	}
	const sellableRooms = cells.length - ooo;
	return {
		occupiedRooms,
		inHouseGuests,
		sellableRooms,
		occupancyPct: sellableRooms > 0 ? Math.round((occupiedRooms / sellableRooms) * 100) : 0
	};
}
