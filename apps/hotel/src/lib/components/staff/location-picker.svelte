<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { Map as LeafletMap, Marker } from 'leaflet';
	import 'leaflet/dist/leaflet.css';

	let { lat = $bindable(null), lng = $bindable(null) }: { lat: number | null; lng: number | null } =
		$props();

	// Davao City, PH — this project's own reference property is there; a reasonable
	// default center for a hotel that hasn't dropped a pin yet.
	const DEFAULT_CENTER: [number, number] = [7.0707, 125.6087];

	let container: HTMLDivElement | undefined = $state();
	let map: LeafletMap | undefined;
	let marker: Marker | undefined;

	onMount(async () => {
		const L = await import('leaflet');

		// Vite serves these as plain asset URLs — Leaflet's own CSS-relative default
		// icon paths don't survive bundling, so point it at the bundled files directly.
		const [iconRetinaUrl, iconUrl, shadowUrl] = await Promise.all([
			import('leaflet/dist/images/marker-icon-2x.png?url').then((m) => m.default as string),
			import('leaflet/dist/images/marker-icon.png?url').then((m) => m.default as string),
			import('leaflet/dist/images/marker-shadow.png?url').then((m) => m.default as string)
		]);
		L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });

		const center: [number, number] = lat != null && lng != null ? [lat, lng] : DEFAULT_CENTER;
		map = L.map(container!).setView(center, lat != null && lng != null ? 15 : 12);

		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			attribution: '© OpenStreetMap contributors',
			maxZoom: 19
		}).addTo(map);

		if (lat != null && lng != null) {
			marker = L.marker([lat, lng], { draggable: true }).addTo(map);
			marker.on('dragend', () => {
				const pos = marker!.getLatLng();
				lat = Math.round(pos.lat * 1e6) / 1e6;
				lng = Math.round(pos.lng * 1e6) / 1e6;
			});
		}

		map.on('click', (e: import('leaflet').LeafletMouseEvent) => {
			lat = Math.round(e.latlng.lat * 1e6) / 1e6;
			lng = Math.round(e.latlng.lng * 1e6) / 1e6;
			if (marker) {
				marker.setLatLng(e.latlng);
			} else {
				marker = L.marker(e.latlng, { draggable: true }).addTo(map!);
				marker.on('dragend', () => {
					const pos = marker!.getLatLng();
					lat = Math.round(pos.lat * 1e6) / 1e6;
					lng = Math.round(pos.lng * 1e6) / 1e6;
				});
			}
		});
	});

	onDestroy(() => {
		map?.remove();
	});

	function clearPin() {
		lat = null;
		lng = null;
		marker?.remove();
		marker = undefined;
	}
</script>

<div class="overflow-hidden rounded-md border border-border">
	<div bind:this={container} class="h-64 w-full"></div>
</div>
<div class="mt-2 flex items-center justify-between text-xs text-ink-muted">
	<span>
		{#if lat != null && lng != null}
			Pin at {lat.toFixed(6)}, {lng.toFixed(6)} — click the map to move it.
		{:else}
			Click the map to drop a pin for the exact location.
		{/if}
	</span>
	{#if lat != null && lng != null}
		<button type="button" onclick={clearPin} class="text-ink-muted underline hover:text-danger">
			Clear pin
		</button>
	{/if}
</div>
