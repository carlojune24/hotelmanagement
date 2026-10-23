export interface SigninCodeEmail {
	subject: string;
	text: string;
	html: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The email that carries a sign-in code. Plain on purpose: the code is the message. Pure; unit-tested. */
export function renderSigninCodeEmail(input: { orgName: string; code: string; minutes: number }): SigninCodeEmail {
	const { orgName, code, minutes } = input;
	const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
	const subject = `${code} is your ${orgName} sign-in code`;
	const text = [
		`Your sign-in code for ${orgName} is:`,
		'',
		`    ${spaced}`,
		'',
		`It works for ${minutes} minutes and only once. Enter it on the sign-in page.`,
		'',
		'If you did not just try to sign in, someone may know your password. Do not share this code; change your password and tell Main HR.'
	].join('\n');
	const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#2b2620">
<div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px">
<p style="margin:0 0 4px;font-size:13px;color:#6b6155">${esc(orgName)}</p>
<p style="margin:0 0 16px;font-size:16px">Your sign-in code is</p>
<p style="margin:0 0 16px;font-size:34px;letter-spacing:6px;font-weight:600;font-family:ui-monospace,Menlo,Consolas,monospace">${esc(spaced)}</p>
<p style="margin:0 0 12px;font-size:14px;color:#4a4238">It works for ${minutes} minutes and only once. Enter it on the sign-in page.</p>
<p style="margin:0;font-size:13px;color:#6b6155">If you did not just try to sign in, someone may know your password. Do not share this code; change your password and tell Main HR.</p>
</div></body></html>`;
	return { subject, text, html };
}
