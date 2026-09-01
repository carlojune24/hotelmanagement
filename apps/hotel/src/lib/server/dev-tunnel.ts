import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Written by scripts/dev-tunnel.mjs while the cloudflared quick tunnel is running.
export function getDevTunnelUrl(): string | null {
	const path = join(process.cwd(), '.tunnel-url');
	if (!existsSync(path)) return null;
	return readFileSync(path, 'utf8').trim() || null;
}
