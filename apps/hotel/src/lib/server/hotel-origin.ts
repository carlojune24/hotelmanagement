import { env } from '$env/dynamic/private';

/** Public origin for links sent to guests: the hotel's own domain when it has one, else the platform `ORIGIN`. */
export function hotelOrigin(hotel: { customDomain: string | null }): string {
	if (hotel.customDomain) return `https://${hotel.customDomain}`;
	return (env.ORIGIN ?? '').replace(/\/$/, '');
}
