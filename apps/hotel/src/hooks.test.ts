import { describe, expect, it, vi } from 'vitest';
import { reroute } from './hooks';

const slugs: Record<string, string> = { 'booking.example': 'mmhotel' };
const fetch = vi.fn(async (input: string) => {
	const host = new URL(input, 'http://x').searchParams.get('host') ?? '';
	return new Response(JSON.stringify({ slug: slugs[host] ?? null }));
}) as unknown as typeof globalThis.fetch;
const run = (u: string) => reroute({ url: new URL(u), fetch });

describe('reroute', () => {
	it('maps a custom domain onto its hotel slug', async () => {
		expect(await run('https://booking.example/')).toBe('/mmhotel');
		expect(await run('https://booking.example/rooms')).toBe('/mmhotel/rooms');
	});
	it('leaves already-prefixed and reserved paths alone', async () => {
		expect(await run('https://booking.example/mmhotel/rooms')).toBe('/mmhotel/rooms');
		expect(await run('https://booking.example/api/hotel-domain')).toBe('/api/hotel-domain');
	});
	it('leaves an unmapped host untouched', async () => {
		expect(await run('https://platform.example/')).toBe('/');
	});
});
