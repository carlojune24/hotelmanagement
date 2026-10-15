/**
 * Minimal Server-Sent Events response. `setup` receives a `send` function and returns a cleanup
 * that runs when the client disconnects (or the stream is cancelled). A comment line every 20s
 * keeps proxies from closing an idle connection; the browser's EventSource reconnects by itself
 * if it is dropped anyway.
 */
export function sseResponse(
	request: Request,
	setup: (send: (event: string, data: unknown) => void) => Promise<() => void> | (() => void)
): Response {
	const encoder = new TextEncoder();
	let cleanup: (() => void) | null = null;
	let ping: ReturnType<typeof setInterval> | null = null;
	let closed = false;

	const stop = () => {
		if (closed) return;
		closed = true;
		if (ping) clearInterval(ping);
		cleanup?.();
	};

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const write = (chunk: string) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					stop();
				}
			};
			const send = (event: string, data: unknown) =>
				write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

			write('retry: 3000\n\n');
			ping = setInterval(() => write(': ping\n\n'), 20_000);
			request.signal.addEventListener('abort', () => {
				stop();
				try {
					controller.close();
				} catch {
					// already closed
				}
			});
			try {
				cleanup = await setup(send);
				if (closed) cleanup();
			} catch (e) {
				console.error('[sse] setup failed', e);
				stop();
				try {
					controller.close();
				} catch {
					// already closed
				}
			}
		},
		cancel() {
			stop();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
}
