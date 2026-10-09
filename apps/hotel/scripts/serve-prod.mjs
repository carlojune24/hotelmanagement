#!/usr/bin/env node
// Runs the production build (`pnpm build` -> build/) the way the ngrok test needs it.
//
// `--env-file=.env` puts ORIGIN (and the rest of .env) in the process environment BEFORE the server
// boots. adapter-node reads ORIGIN at start-up for its CSRF check on form POSTs, and the app's own
// dotenv load happens too late for that, so without this every form post through a tunnel is a 403.
// PORT defaults to 5175, matching the tunnel and PDF_RENDER_ORIGIN in .env.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

if (!existsSync(join(process.cwd(), 'build', 'index.js'))) {
	console.error('[serve-prod] build/index.js not found. Run `pnpm build` first (from apps/hotel).');
	process.exit(1);
}

const proc = spawn(process.execPath, ['--env-file=.env', 'build'], {
	stdio: 'inherit',
	env: { ...process.env, PORT: process.env.PORT ?? '5175' }
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => proc.kill(sig));
proc.on('exit', (code) => process.exit(code ?? 0));
