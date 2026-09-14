<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import XIcon from '@lucide/svelte/icons/x';

	/** The `name` the resulting photo submits under when the surrounding `<form>` posts —
	 *  a live camera capture only, never a file picker (see the schema column's own
	 *  comment on `bookings.guestIdPhotoUrl`). Entirely optional: nothing here blocks
	 *  the surrounding form if the guest has no ID handy or the camera fails. */
	let { name = 'guestIdPhoto' }: { name?: string } = $props();

	let videoEl: HTMLVideoElement | undefined = $state();
	let fileInputEl: HTMLInputElement | undefined = $state();
	let stream: MediaStream | null = null;

	let phase = $state<'idle' | 'live' | 'captured'>('idle');
	let previewUrl = $state<string | null>(null);
	let error = $state<string | null>(null);

	function stopStream() {
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
	}

	async function startCamera() {
		error = null;
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'environment' },
				audio: false
			});
			phase = 'live';
			// The <video> only exists once `phase` flips, so wait for it to mount.
			await new Promise((r) => setTimeout(r, 0));
			if (videoEl) {
				videoEl.srcObject = stream;
				await videoEl.play();
			}
		} catch (e) {
			error =
				e instanceof DOMException && e.name === 'NotAllowedError'
					? 'Camera access was denied — allow it in the browser, or skip this step.'
					: 'Could not reach a camera on this device — skip this step if none is available.';
			stopStream();
			phase = 'idle';
		}
	}

	function capture() {
		if (!videoEl) return;
		const canvas = document.createElement('canvas');
		canvas.width = videoEl.videoWidth;
		canvas.height = videoEl.videoHeight;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.drawImage(videoEl, 0, 0);
		canvas.toBlob(
			(blob) => {
				if (!blob || !fileInputEl) return;
				const file = new File([blob], `id-capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
				const dt = new DataTransfer();
				dt.items.add(file);
				fileInputEl.files = dt.files;
				previewUrl = URL.createObjectURL(blob);
				phase = 'captured';
				stopStream();
			},
			'image/jpeg',
			0.9
		);
	}

	function retake() {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = null;
		if (fileInputEl) fileInputEl.value = '';
		phase = 'idle';
		startCamera();
	}

	function clear() {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = null;
		if (fileInputEl) fileInputEl.value = '';
		stopStream();
		phase = 'idle';
	}

	$effect(() => () => stopStream());
</script>

<div class="rounded-lg border border-dashed border-border p-3">
	<div class="mb-1.5 flex items-center justify-between">
		<span class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Guest ID (optional)</span>
		{#if phase === 'captured'}
			<button
				type="button"
				onclick={clear}
				class="text-xs text-ink-muted underline underline-offset-2 hover:text-danger"
			>
				Remove
			</button>
		{/if}
	</div>

	<!-- The field the form actually submits — populated only via a canvas capture above,
	     never opened as a file picker by the user. -->
	<input type="file" name={name} bind:this={fileInputEl} accept="image/jpeg" class="hidden" />

	{#if phase === 'idle'}
		<Button type="button" variant="outline" size="sm" onclick={startCamera}>
			<CameraIcon />
			Turn on camera
		</Button>
		{#if error}<p class="mt-1.5 text-xs text-danger">{error}</p>{/if}
	{:else if phase === 'live'}
		<!-- svelte-ignore a11y_media_has_caption -->
		<video bind:this={videoEl} class="mb-2 w-full rounded-md bg-black" playsinline muted></video>
		<div class="flex gap-2">
			<Button type="button" size="sm" onclick={capture}>
				<CameraIcon />
				Capture
			</Button>
			<Button type="button" variant="ghost" size="sm" onclick={clear}>
				<XIcon />
				Cancel
			</Button>
		</div>
	{:else if phase === 'captured' && previewUrl}
		<img src={previewUrl} alt="Captured guest ID" class="mb-2 max-h-40 rounded-md border border-border" />
		<Button type="button" variant="outline" size="sm" onclick={retake}>
			<RotateCcwIcon />
			Retake
		</Button>
	{/if}
</div>
