import { describe, expect, it } from 'vitest';
import { brandName, canonicalUrl, hotelJsonLd } from './seo';

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

describe('hotelJsonLd', () => {
	it('omits empty fields and cannot close the script tag', () => {
		const out = hotelJsonLd({ name: 'A</script>', url: 'https://x', city: 'Tandag', address: undefined, phone: undefined, email: undefined, image: undefined, lat: undefined, lng: undefined });
		expect(out).not.toContain('<');
		const ld = JSON.parse(out);
		expect(ld.address).toEqual({ '@type': 'PostalAddress', addressLocality: 'Tandag', addressCountry: 'PH' });
		expect(ld.telephone).toBeUndefined();
	});
});
