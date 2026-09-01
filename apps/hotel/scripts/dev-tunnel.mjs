#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const port = process.argv[2] ?? '5175';
const outFile = join(process.cwd(), '.tunnel-url');
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
	if (match) {
		writeFileSync(outFile, match[0]);
		console.log(`\n[dev-tunnel] wrote ${match[0]} to ${outFile}\n`);
	}
}

proc.stdout.on('data', handle);
proc.stderr.on('data', handle);

function cleanup() {
	if (existsSync(outFile)) rmSync(outFile);
	proc.kill();
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
proc.on('exit', (code) => {
	if (existsSync(outFile)) rmSync(outFile);
	process.exit(code ?? 0);
});
