/** "Sep 24" from a `YYYY-MM-DD` business date (calendar label — no timezone shift). */
function dayLabel(businessDate: string): string {
	return new Date(`${businessDate}T00:00:00Z`).toLocaleDateString('en-PH', {
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC'
	});
}

const peso = (c: number) =>
	`₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

/** One plain sentence per business date an overnight shift's cash spilled onto.
 *
 *  The drawer count includes that cash, but each day's Z-reading only covers its own date — so
 *  a cashier reconciling the count against a Z-reading isn't left wondering where it went. */
export function otherDaysNotes(
	otherDays: { businessDate: string; cashInCentavos: number; cashOutCentavos: number }[],
	shiftBusinessDate: string
): string[] {
	return otherDays.map((d) => {
		const parts = [`${peso(d.cashInCentavos)} taken`];
		if (d.cashOutCentavos > 0) parts.push(`${peso(d.cashOutCentavos)} paid out`);
		return `${parts.join(', ')} on ${dayLabel(d.businessDate)} (after midnight). It's in this drawer count, but belongs to ${dayLabel(d.businessDate)}'s Z-reading, not ${dayLabel(shiftBusinessDate)}'s.`;
	});
}
