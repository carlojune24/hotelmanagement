#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const provider = process.argv[2] === 'ngrok' ? 'ngrok' : 'cloudflare';
const port = process.argv[3] ?? '5175';
const outFile = join(process.cwd(), '.tunnel-url');
const envFile = join(process.cwd(), '.env');

// Keeps .env's ORIGIN (used for absolute links in confirmation/guest-message
// emails) in sync with whichever tunnel URL is actually live, since a fresh
// quick tunnel gets a new random hostname every run.
function updateEnvOrigin(url) {
	if (!existsSync(envFile)) return;
	const contents = readFileSync(envFile, 'utf8');
	const line = `ORIGIN=${url}`;
	const updated = /^ORIGIN=.*$/m.test(contents)
		? contents.replace(/^ORIGIN=.*$/m, line)
		: `${contents.trimEnd()}\n${line}\n`;
	if (updated !== contents) {
		writeFileSync(envFile, updated);
		console.log(`[dev-tunnel] updated ORIGIN in ${envFile}`);
	}
}

function writeUrl(url) {
	writeFileSync(outFile, url);
	console.log(`\n[dev-tunnel] wrote ${url} to ${outFile}\n`);
	updateEnvOrigin(url);
}

function wireLifecycle(proc, extraCleanup) {
	const onSignal = () => {
		if (existsSync(outFile)) rmSync(outFile);
		extraCleanup?.();
		proc.kill();
	};
	process.on('SIGINT', onSignal);
	process.on('SIGTERM', onSignal);
	proc.on('exit', (code) => {
		if (existsSync(outFile)) rmSync(outFile);
		extraCleanup?.();
		process.exit(code ?? 0);
	});
}

function runCloudflare() {
	const urlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
	const knownPaths = [
		'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
		'C:\\Program Files\\cloudflared\\cloudflared.exe'
	];
	const bin = knownPaths.find((p) => existsSync(p)) ?? 'cloudflared';
	const proc = spawn(bin, ['tunnel', '--url', `http://localhost:${port}`]);

	function handle(chunk) {
		const text = chunk.toString();
		process.stdout.write(text);
		const match = text.match(urlPattern);
		if (match) writeUrl(match[0]);
	}

	proc.stdout.on('data', handle);
	proc.stderr.on('data', handle);
	wireLifecycle(proc);
}

function runNgrok() {
	const proc = spawn('ngrok', ['http', port, '--log=stdout']);
	proc.stdout.on('data', (chunk) => process.stdout.write(chunk));
	proc.stderr.on('data', (chunk) => process.stderr.write(chunk));

	// ngrok's TUI/log line format isn't a stable contract to regex-match, so read
	// the public URL back from its local agent API instead once the tunnel is up.
	const poll = setInterval(async () => {
		try {
			const res = await fetch('http://127.0.0.1:4040/api/tunnels');
			if (!res.ok) return;
			const { tunnels } = await res.json();
			const https = tunnels?.find((t) => t.public_url?.startsWith('https://'));
			if (https) {
				clearInterval(poll);
				writeUrl(https.public_url);
			}
		} catch {
			// agent API not up yet — keep polling
		}
	}, 500);

	wireLifecycle(proc, () => clearInterval(poll));
}

if (provider === 'ngrok') {
	runNgrok();
} else {
	runCloudflare();
}
