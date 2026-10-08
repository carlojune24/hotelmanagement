import QRCode from 'qrcode';
import { env } from '$env/dynamic/private';

/** The address a table's QR code points at. On a hotel's own domain the slug is implied. */
export function tableQrUrl(args: { requestOrigin: string; slug: string; token: string; customDomain: boolean }): string {
	const origin = (env.ORIGIN || args.requestOrigin).replace(/\/$/, '');
	return `${origin}${args.customDomain ? '' : `/${args.slug}`}/dining/t/${args.token}`;
}

/** An SVG QR code with a quiet zone, sized by the caller's CSS. Medium error correction survives a scuffed tent card. */
export function qrSvg(text: string): Promise<string> {
	return QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } });
}
