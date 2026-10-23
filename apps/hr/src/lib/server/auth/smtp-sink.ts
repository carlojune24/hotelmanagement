import net from 'node:net';

/**
 * A throwaway SMTP server for tests and local checks: it accepts any message and keeps it, so the
 * real sending code can be exercised without a mailbox. Speaks just enough SMTP for nodemailer
 * (no TLS, no auth). Never used by the app itself.
 */
export function startSmtpSink(port = 0): Promise<{ port: number; mails: string[]; close: () => Promise<void> }> {
	const mails: string[] = [];
	const server = net.createServer((socket) => {
		let buffer = '';
		let inData = false;
		let current = '';
		socket.write('220 sink ESMTP\r\n');
		socket.on('data', (chunk) => {
			buffer += chunk.toString();
			let at: number;
			while ((at = buffer.indexOf('\r\n')) >= 0) {
				const line = buffer.slice(0, at);
				buffer = buffer.slice(at + 2);
				if (inData) {
					if (line === '.') {
						inData = false;
						mails.push(current);
						current = '';
						socket.write('250 OK queued\r\n');
					} else current += line + '\n';
					continue;
				}
				const cmd = line.toUpperCase();
				if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) socket.write('250 sink\r\n');
				else if (cmd.startsWith('DATA')) {
					inData = true;
					socket.write('354 go ahead\r\n');
				} else if (cmd.startsWith('QUIT')) {
					socket.write('221 bye\r\n');
					socket.end();
				} else socket.write('250 OK\r\n');
			}
		});
		socket.on('error', () => {});
	});
	return new Promise((resolve) => {
		server.listen(port, '127.0.0.1', () => {
			const address = server.address() as net.AddressInfo;
			resolve({
				port: address.port,
				mails,
				close: () => new Promise<void>((done) => server.close(() => done()))
			});
		});
	});
}

/** The 6-digit code in the subject of the most recent sign-in email the sink received. */
export function lastCode(mails: string[]): string | null {
	for (let i = mails.length - 1; i >= 0; i--) {
		const m = mails[i]!.match(/^Subject: (\d{6}) is your/m);
		if (m) return m[1]!;
	}
	return null;
}
