import { env } from '$env/dynamic/private';

/** The platform's own public origin. `APP_ORIGIN` is for production, where `ORIGIN` must stay unset so
 *  adapter-node takes the host from the request (a custom domain needs that); dev/staging may keep `ORIGIN`. */
export function platformOrigin(): string {
	return (env.APP_ORIGIN || env.ORIGIN || '').replace(/\/$/, '');
}

/** Public origin for links sent to guests: the hotel's own domain when it has one, else the platform origin. */
export function hotelOrigin(hotel: { customDomain: string | null }): string {
	return hotel.customDomain ? `https://${hotel.customDomain}` : platformOrigin();
}
