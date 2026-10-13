export const money = (c: number) =>
	new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(c / 100);

/** A zero in a stacked column is a quiet dash; Basic, Gross and Net always show the amount. */
export const amt = (c: number) => (c === 0 ? '–' : money(c));
