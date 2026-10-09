import { describe, expect, it } from 'vitest';
import { ROLE_CAPS } from '$lib/authz';

/**
 * What a kitchen-only account (kitchen@example.com) can and cannot open. These are the route guards
 * themselves with a hand-built session, so no database is needed.
 */
const hotel = { id: 'h1', slug: 'hotel1', name: 'Demo Hotel', timezone: 'Asia/Manila' };
const asRole = (caps: string[], isPlatformAdmin = false) =>
	({
		hotel,
		user: { id: 'u1', isPlatformAdmin },
		role: { id: 'r1', slug: 'r', name: 'R', isProtected: false, capabilities: caps }
	}) as never;

const cook = asRole(ROLE_CAPS.kitchen);
const thrown = async (fn: () => unknown) => {
	try {
		await fn();
	} catch (e) {
		return e as { status: number; location?: string };
	}
	return null;
};

describe('a kitchen-only account', () => {
	it('is sent from the Dashboard to the Kitchen', async () => {
		const { load } = await import('./dashboard/+page.server');
		const out = await thrown(() => load({ locals: cook } as never));
		expect(out).toMatchObject({ status: 302, location: '/hotel1/management/kitchen' });
	});

	it('can open the Kitchen', async () => {
		const { load } = await import('./kitchen/+layout.server');
		const out = (await load({ locals: cook } as never)) as { canManage: boolean; canWrite: boolean };
		// Start/Ready and sold-out toggles yes; station setup (kitchen:manage) no.
		expect(out).toEqual({ canManage: false, canWrite: true });
	});

	it("is shut out of the manager's areas with a 403", async () => {
		const dining = await import('./dining/+layout.server');
		const finance = await import('./finance/+layout.server');
		const hr = await import('./hr/+layout.server');
		for (const load of [dining.load, finance.load, hr.load]) {
			expect(await thrown(() => (load as (e: never) => unknown)({ locals: cook, depends: () => {} } as never))).toMatchObject({ status: 403 });
		}
	});

	it('is not mistaken for a cook when the manager or a platform admin signs in', async () => {
		const { load } = await import('./dashboard/+page.server');
		// A manager stays on the Dashboard (it would go on to load data, which needs a database), so
		// only the redirect decision is checked: it must not be the Kitchen redirect.
		for (const locals of [asRole(ROLE_CAPS.hotel_admin), asRole(ROLE_CAPS.kitchen, true)]) {
			const out = await thrown(() => load({ locals } as never));
			expect(out?.location ?? '').not.toBe('/hotel1/management/kitchen');
		}
	});
});

describe('a dining-only account', () => {
	const waiter = asRole(ROLE_CAPS.dining);

	it('is sent from the Dashboard to Dining', async () => {
		const { load } = await import('./dashboard/+page.server');
		const out = await thrown(() => load({ locals: waiter } as never));
		expect(out).toMatchObject({ status: 302, location: '/hotel1/management/dining' });
	});

	it('is shut out of the Kitchen, Finance and HR', async () => {
		const kitchen = await import('./kitchen/+layout.server');
		const finance = await import('./finance/+layout.server');
		const hr = await import('./hr/+layout.server');
		for (const load of [kitchen.load, finance.load, hr.load]) {
			expect(await thrown(() => (load as (e: never) => unknown)({ locals: waiter, depends: () => {} } as never))).toMatchObject({ status: 403 });
		}
	});
});
