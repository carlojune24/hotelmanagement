/**
 * Light/dark choice for the public storefront (not the booking wizard, not the staff app).
 * `system` follows the OS via CSS (`prefers-color-scheme`, see woven-ledger.css), so nothing flashes on
 * load; an explicit choice is stored in a cookie so the server can render the right mode straight away.
 */
export type StorefrontMode = 'system' | 'light' | 'dark';

export const STOREFRONT_MODE_COOKIE = 'sf-mode';

export function parseStorefrontMode(raw: string | undefined | null): StorefrontMode {
	return raw === 'light' || raw === 'dark' ? raw : 'system';
}

export class StorefrontTheme {
	mode = $state<StorefrontMode>('system');

	constructor(initial: StorefrontMode) {
		this.mode = initial;
	}

	/** Flip to the opposite of what the guest is currently looking at, and remember it. */
	toggle() {
		const dark =
			this.mode === 'system'
				? window.matchMedia('(prefers-color-scheme: dark)').matches
				: this.mode === 'dark';
		this.mode = dark ? 'light' : 'dark';
		try {
			document.cookie = `${STOREFRONT_MODE_COOKIE}=${this.mode}; path=/; max-age=31536000; samesite=lax`;
		} catch {
			// Cookies blocked: the choice still holds for this page view.
		}
	}
}
