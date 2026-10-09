/** Alert sounds for staff screens (browser only). Browsers allow only a handful of audio
 *  contexts per page and keep them silent until the person has touched the page once, so one
 *  shared context is created lazily and woken by the first tap or key press. */

export type Tone = 'ticket' | 'ready' | 'stop';

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
	if (ctx) return ctx;
	try {
		ctx = new AudioContext();
	} catch {
		ctx = null;
	}
	return ctx;
}

/** Wakes the shared context. Call from a tap or key press. */
export function unlockSound(): boolean {
	const c = context();
	if (!c) return false;
	if (c.state === 'suspended') void c.resume().catch(() => {});
	return c.state === 'running';
}

/** True once a sound can actually play (the person has interacted with the page). */
export function soundReady(): boolean {
	return ctx?.state === 'running';
}

/** Unlocks on the first tap or key press anywhere; returns the cleanup. */
export function unlockOnFirstTouch(onUnlocked?: () => void): () => void {
	const handler = () => {
		if (unlockSound()) {
			onUnlocked?.();
			remove();
		}
	};
	const remove = () => {
		window.removeEventListener('pointerdown', handler);
		window.removeEventListener('keydown', handler);
	};
	window.addEventListener('pointerdown', handler);
	window.addEventListener('keydown', handler);
	return remove;
}

/** How long an alert rings. Long enough that nobody in a busy kitchen or dining room misses it. */
export const ALERT_SECONDS = 5;

interface Beep {
	freq: number;
	/** Seconds from the start of the alert. */
	at: number;
	len: number;
}

/** A pattern repeated to fill `seconds`: every `cycle` seconds the `notes` play again. */
function repeat(notes: Omit<Beep, 'at'>[], step: number, cycle: number, seconds: number): Beep[] {
	const out: Beep[] = [];
	for (let t = 0; t + cycle <= seconds + 0.001; t += cycle) {
		notes.forEach((n, i) => out.push({ freq: n.freq, len: n.len, at: t + i * step }));
	}
	return out;
}

const PATTERNS: Record<Tone, (seconds: number) => Beep[]> = {
	// a new ticket / a table order to accept: a bright two-tone "ding-dong", over and over
	ticket: (sec) => repeat([{ freq: 1175, len: 0.26 }, { freq: 880, len: 0.26 }], 0.3, 0.7, sec),
	// food is ready to carry out: three rising notes, then a pause, over and over
	ready: (sec) => repeat([{ freq: 660, len: 0.2 }, { freq: 880, len: 0.2 }, { freq: 1320, len: 0.34 }], 0.24, 1.0, sec),
	// stop cooking: an urgent falling two-tone, faster, so it sounds different from a new ticket
	stop: (sec) => repeat([{ freq: 880, len: 0.17 }, { freq: 440, len: 0.17 }], 0.2, 0.4, sec)
};

/** Peak loudness of one note, 0 to 1. Square waves are the loudest, most piercing waveform the
 *  browser offers, and a compressor keeps stacked notes from distorting. */
const VOLUME = 0.9;

let playing: { osc: OscillatorNode; gain: GainNode }[] = [];

/** Cuts off whatever alert is ringing. */
export function stopSound(): void {
	for (const { osc, gain } of playing) {
		try {
			gain.gain.cancelScheduledValues(0);
			gain.gain.value = 0;
			osc.stop();
		} catch {
			/* already finished */
		}
	}
	playing = [];
}

/**
 * Rings an alert for ALERT_SECONDS (or `seconds`, e.g. a short preview). A newer alert replaces
 * one still ringing rather than stacking on top of it. Returns false when the browser still
 * blocks audio (nobody has touched the page yet).
 */
export function playTone(tone: Tone, seconds: number = ALERT_SECONDS): boolean {
	const c = context();
	if (!c) return false;
	if (c.state === 'suspended') void c.resume().catch(() => {});
	if (c.state !== 'running') return false;

	stopSound();
	const master = c.createDynamicsCompressor();
	master.connect(c.destination);
	for (const n of PATTERNS[tone](seconds)) {
		const osc = c.createOscillator();
		const gain = c.createGain();
		const start = c.currentTime + n.at;
		osc.type = 'square';
		osc.frequency.value = n.freq;
		// a very short ramp each side stops the click a hard on/off would make
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.exponentialRampToValueAtTime(VOLUME, start + 0.01);
		gain.gain.setValueAtTime(VOLUME, start + Math.max(0.01, n.len - 0.04));
		gain.gain.exponentialRampToValueAtTime(0.0001, start + n.len);
		osc.connect(gain).connect(master);
		osc.start(start);
		osc.stop(start + n.len + 0.02);
		playing.push({ osc, gain });
	}
	return true;
}

/** A per-device on/off switch, on unless someone turned it off. */
export function readSoundPref(key: string): boolean {
	try {
		return localStorage.getItem(key) !== '0';
	} catch {
		return true;
	}
}

export function writeSoundPref(key: string, on: boolean): void {
	try {
		localStorage.setItem(key, on ? '1' : '0');
	} catch {
		/* storage blocked: the choice lasts until reload */
	}
}
