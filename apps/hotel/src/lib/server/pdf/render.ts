import { chromium, type Browser } from 'playwright';
import { env } from '$env/dynamic/private';

/**
 * Server-side PDF rendering for the `/{slug}/print/*` routes. Rather than a second
 * PDF-library layout that would drift from the printed page, headless Chromium loads
 * the app's own print route and prints it — so a PDF is exactly what staff get from
 * Ctrl+P (same `@page` size/margins, same self-hosted fonts).
 *
 * Needs a Chromium build on the host: `pnpm exec playwright install chromium`.
 */

let browserPromise: Promise<Browser> | null = null;

/** One shared browser per process, launched on first use; a new context per render. */
function getBrowser(): Promise<Browser> {
	if (!browserPromise) {
		browserPromise = chromium.launch({ headless: true }).then((browser) => {
			// A crashed/closed browser must not poison every later render.
			browser.on('disconnected', () => {
				browserPromise = null;
			});
			return browser;
		});
		browserPromise.catch(() => {
			browserPromise = null;
		});
	}
	return browserPromise;
}

/**
 * The origin the server reaches *itself* on. Deliberately separate from `ORIGIN`
 * (the public URL, used for links in emails): in dev `ORIGIN` is often a tunnel
 * (ngrok's free tier puts an interstitial page in front of it), and in production
 * there's no reason to go out through the public edge and back.
 */
function renderOrigin(): string {
	const origin = env.PDF_RENDER_ORIGIN || env.ORIGIN;
	if (!origin) throw new Error('PDF_RENDER_ORIGIN (or ORIGIN) is not set');
	return origin.replace(/\/$/, '');
}

// Generous: a cold dev server compiles the print route on first hit (~20s observed).
const RENDER_TIMEOUT_MS = 45_000;

/**
 * Renders an app path (e.g. `/demo/print/receipt/<id>?t=<token>&format=a4`) to a PDF.
 * The path must be reachable without a session — i.e. carry a guest `?t=` token —
 * since the headless browser has no staff cookie. Throws on a non-2xx response, so a
 * 403/404 never gets mailed out as a PDF of an error page.
 */
export async function renderPdf(path: string): Promise<Buffer> {
	if (!path.startsWith('/')) throw new Error(`renderPdf expects an app path, got "${path}"`);

	const browser = await getBrowser();
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		const response = await page.goto(`${renderOrigin()}${path}`, {
			waitUntil: 'networkidle',
			timeout: RENDER_TIMEOUT_MS
		});
		if (!response || !response.ok()) {
			throw new Error(`print route returned ${response?.status() ?? 'no response'} for ${path}`);
		}
		await page.evaluate(() => document.fonts.ready);

		return await page.pdf({
			// Honour the print routes' own `@page { size: A4; margin: 10mm }`.
			preferCSSPageSize: true,
			printBackground: true
		});
	} finally {
		await context.close();
	}
}
