import { describe, expect, it } from 'vitest';
import { brandBothWays, brandName, canonicalUrl, homeTitle, hotelJsonLd, spacedName } from './seo';

const base = { origin: 'https://hotels.example.com', slug: 'mmhotel' };

describe('canonicalUrl', () => {
	it('drops the slug on a custom domain', () => {
		expect(canonicalUrl({ ...base, customDomain: 'booking.example', pathname: '/mmhotel' })).toBe('https://booking.example/');
		expect(canonicalUrl({ ...base, customDomain: 'booking.example', pathname: '/mmhotel/contact' })).toBe('https://booking.example/contact');
		expect(canonicalUrl({ ...base, customDomain: 'booking.example', pathname: '/contact' })).toBe('https://booking.example/contact');
	});
	it('keeps the platform URL without a custom domain', () => {
		expect(canonicalUrl({ ...base, customDomain: null, pathname: '/mmhotel/contact' })).toBe('https://hotels.example.com/mmhotel/contact');
	});
});

describe('brandName', () => {
	it('adds the city once', () => {
		expect(brandName('MMHotel', 'Tandag')).toBe('MMHotel Tandag');
		expect(brandName('MMHotel Tandag', 'Tandag')).toBe('MMHotel Tandag');
		expect(brandName('MMHotel', null)).toBe('MMHotel');
	});
});

describe('spacedName / brandBothWays', () => {
	it('splits a camel-cased name and keeps both spellings', () => {
		expect(spacedName('MMHotel')).toBe('MM Hotel');
		expect(spacedName('GrandPlaza')).toBe('Grand Plaza');
		expect(spacedName('Seaside')).toBeNull();
		expect(brandBothWays('MMHotel', 'Tandag')).toBe('MM Hotel Tandag (MMHotel)');
		expect(brandBothWays('Seaside', 'Tandag')).toBe('Seaside Tandag');
		expect(homeTitle('MMHotel', 'Tandag')).toBe('MM Hotel Tandag (MMHotel) — Official Website & Online Booking');
	});
});

describe('hotelJsonLd', () => {
	it('omits empty fields and cannot close the script tag', () => {
		const out = hotelJsonLd({ name: 'A</script>', url: 'https://x', city: 'Tandag', address: undefined, phone: undefined, email: undefined, image: undefined, lat: undefined, lng: undefined });
		expect(out).not.toContain('<');
		const ld = JSON.parse(out);
		expect(ld.address).toEqual({ '@type': 'PostalAddress', addressLocality: 'Tandag', addressCountry: 'PH' });
		expect(ld.telephone).toBeUndefined();
	});
});
