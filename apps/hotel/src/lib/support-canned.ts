/**
 * Canned replies are stored with placeholders and filled in right before they go into the reply box,
 * from the real hotel / agent / guest values, so one reply works for every chat.
 */
export const CANNED_PLACEHOLDERS = [
	{ token: '{guest}', label: "Guest's name" },
	{ token: '{agent}', label: 'Your name' },
	{ token: '{hotel}', label: 'Hotel name' },
	{ token: '{checkin}', label: 'Check-in time' },
	{ token: '{checkout}', label: 'Check-out time' }
] as const;

export interface CannedContext {
	guest: string;
	agent: string;
	hotel: string;
	checkin: string;
	checkout: string;
}

export function fillCanned(body: string, ctx: CannedContext): string {
	return body
		.replaceAll('{guest}', ctx.guest)
		.replaceAll('{agent}', ctx.agent)
		.replaceAll('{hotel}', ctx.hotel)
		.replaceAll('{checkin}', ctx.checkin)
		.replaceAll('{checkout}', ctx.checkout);
}
