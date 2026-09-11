import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		port: 5175,
		// Lets a dev tunnel host (a random *.trycloudflare.com or *.ngrok-free.app hostname
		// each run, via `pnpm dev:tunnel` / `dev:tunnel:ngrok`) reach the dev server — Vite's
		// DNS-rebinding host check otherwise blocks any request whose Host header isn't localhost.
		allowedHosts: true
	},
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	},
	optimizeDeps: {
		// Every `@lucide/svelte/icons/*` deep import used anywhere in the app (each is its
		// own dependency to Vite's optimizer). Without this, the first dev-mode visit to a
		// route that reaches a not-yet-seen icon triggers a "new dependency discovered" full
		// re-optimization + reload — the multi-second one-time pause on a route's first click.
		// Listing them here pre-bundles all of them at server startup instead.
		include: [
			'@lucide/svelte/icons/accessibility',
			'@lucide/svelte/icons/air-vent',
			'@lucide/svelte/icons/alarm-smoke',
			'@lucide/svelte/icons/arrow-right',
			'@lucide/svelte/icons/arrow-up-down',
			'@lucide/svelte/icons/banknote',
			'@lucide/svelte/icons/bath',
			'@lucide/svelte/icons/bed',
			'@lucide/svelte/icons/bell-ring',
			'@lucide/svelte/icons/blinds',
			'@lucide/svelte/icons/building-2',
			'@lucide/svelte/icons/bus-front',
			'@lucide/svelte/icons/calendar-check',
			'@lucide/svelte/icons/calendar-clock',
			'@lucide/svelte/icons/calendar-days',
			'@lucide/svelte/icons/calendar-range',
			'@lucide/svelte/icons/cctv',
			'@lucide/svelte/icons/chart-column',
			'@lucide/svelte/icons/check',
			'@lucide/svelte/icons/chevron-down',
			'@lucide/svelte/icons/chevron-left',
			'@lucide/svelte/icons/chevron-right',
			'@lucide/svelte/icons/chevron-up',
			'@lucide/svelte/icons/cigarette-off',
			'@lucide/svelte/icons/circle-check',
			'@lucide/svelte/icons/circle-dot',
			'@lucide/svelte/icons/circle-parking',
			'@lucide/svelte/icons/circle-x',
			'@lucide/svelte/icons/coffee',
			'@lucide/svelte/icons/concierge-bell',
			'@lucide/svelte/icons/cooking-pot',
			'@lucide/svelte/icons/door-closed',
			'@lucide/svelte/icons/door-open',
			'@lucide/svelte/icons/download',
			'@lucide/svelte/icons/droplets',
			'@lucide/svelte/icons/dumbbell',
			'@lucide/svelte/icons/ear-off',
			'@lucide/svelte/icons/ethernet-port',
			'@lucide/svelte/icons/eye',
			'@lucide/svelte/icons/fan',
			'@lucide/svelte/icons/fire-extinguisher',
			'@lucide/svelte/icons/flame',
			'@lucide/svelte/icons/gem',
			'@lucide/svelte/icons/image',
			'@lucide/svelte/icons/info',
			'@lucide/svelte/icons/lamp-desk',
			'@lucide/svelte/icons/layers',
			'@lucide/svelte/icons/layout-dashboard',
			'@lucide/svelte/icons/loader-2',
			'@lucide/svelte/icons/lock',
			'@lucide/svelte/icons/log-out',
			'@lucide/svelte/icons/mail',
			'@lucide/svelte/icons/map-pin',
			'@lucide/svelte/icons/minus',
			'@lucide/svelte/icons/moon',
			'@lucide/svelte/icons/octagon-x',
			'@lucide/svelte/icons/palette',
			'@lucide/svelte/icons/panel-left',
			'@lucide/svelte/icons/party-popper',
			'@lucide/svelte/icons/paw-print',
			'@lucide/svelte/icons/pencil',
			'@lucide/svelte/icons/phone',
			'@lucide/svelte/icons/play',
			'@lucide/svelte/icons/plus',
			'@lucide/svelte/icons/receipt',
			'@lucide/svelte/icons/refrigerator',
			'@lucide/svelte/icons/ruler',
			'@lucide/svelte/icons/search',
			'@lucide/svelte/icons/settings',
			'@lucide/svelte/icons/shield',
			'@lucide/svelte/icons/shield-check',
			'@lucide/svelte/icons/shirt',
			'@lucide/svelte/icons/shower-head',
			'@lucide/svelte/icons/sparkles',
			'@lucide/svelte/icons/star',
			'@lucide/svelte/icons/sun',
			'@lucide/svelte/icons/thermometer-sun',
			'@lucide/svelte/icons/trash-2',
			'@lucide/svelte/icons/trees',
			'@lucide/svelte/icons/triangle-alert',
			'@lucide/svelte/icons/tv',
			'@lucide/svelte/icons/tv-minimal',
			'@lucide/svelte/icons/user',
			'@lucide/svelte/icons/users',
			'@lucide/svelte/icons/utensils',
			'@lucide/svelte/icons/utensils-crossed',
			'@lucide/svelte/icons/wallet',
			'@lucide/svelte/icons/washing-machine',
			'@lucide/svelte/icons/waves',
			'@lucide/svelte/icons/wifi',
			'@lucide/svelte/icons/wind',
			'@lucide/svelte/icons/wine',
			'@lucide/svelte/icons/x'
		]
	}
});
