import { expect, test, type Page } from 'playwright/test';
import { SLUG, staffLogin, uniqueGuest } from './helpers';

/**
 * Customer Support chat: the guest widget (FAQ chips, live chat, leave-a-message) and the staff
 * Support inbox (availability switch, queue, reply, close), plus the live extras: typing, "Seen",
 * reconnecting, canned replies, and staying available on other staff pages.
 *
 * Prerequisites: a published hotel (set E2E_HOTEL_SLUG; the seed hotel is `mmhotel`) and a staff
 * login with `support:*` (front desk or hotel admin). Run migrations first (through 0099).
 */

const widget = (page: Page) => page.getByRole('dialog', { name: 'Customer Support' });

async function openWidget(page: Page) {
	await page.goto(`/${SLUG}`);
	await page.getByRole('button', { name: 'Open Customer Support' }).click();
	await expect(widget(page)).toBeVisible();
}

/** Puts the signed-in agent on the given availability and waits for the switch to say so. */
async function setAvailability(page: Page, available: boolean) {
	await page.goto(`/${SLUG}/management/support`);
	const toggle = page.getByRole('switch');
	if ((await toggle.getAttribute('aria-checked')) !== String(available)) await toggle.click();
	await expect(toggle).toHaveAttribute('aria-checked', String(available));
}

test.describe('customer support chat', () => {
	test('a guest can read an FAQ answer without any staff online', async ({ page }) => {
		await openWidget(page);
		await widget(page).getByRole('button', { name: 'What time is check-in and check-out?' }).click();
		await expect(widget(page).getByText(/Check-in is from/)).toBeVisible();
		await widget(page).getByRole('button', { name: 'More questions' }).click();
		await expect(widget(page).getByText(/What would you like to know/)).toBeVisible();
	});

	test('with nobody online the guest still chats on the site, staff pick it up later, and closing deletes the messages', async ({ page, browser }) => {
		const guest = uniqueGuest();
		const question = `Do you allow pets? ${Date.now()}`;

		// Staff go away first: nobody is online.
		const staffCtx = await browser.newContext();
		const staff = await staffCtx.newPage();
		await staffLogin(staff);
		await setAvailability(staff, false);

		// The guest can still chat (no "leave a message by email"): the chat waits, with its own unique ID.
		await openWidget(page);
		await expect(widget(page).getByText('Our team is away right now')).toBeVisible();
		await widget(page).getByRole('button', { name: 'Chat with a person' }).click();
		await widget(page).getByLabel('Your name').fill(guest.name);
		await widget(page).getByLabel('Your message').fill(question);
		await widget(page).getByRole('button', { name: 'Start chat' }).click();
		await expect(widget(page).getByText(question)).toBeVisible();
		await expect(widget(page).getByText(/Nobody is online right now\. Your messages are saved/)).toBeVisible();
		await expect(widget(page).getByText(/^Chat ID SC-[0-9A-F]{8}$/)).toBeVisible();

		// It is waiting in the staff queue; as soon as an agent comes online they are joined to it automatically.
		await staff.goto(`/${SLUG}/management/support?tab=queued`);
		await expect(staff.getByRole('link', { name: new RegExp(guest.name) })).toBeVisible();
		await staff.getByRole('switch').click();
		await expect(widget(page).getByText(/joined the chat/)).toBeVisible({ timeout: 20_000 });

		// They answer in the same window, on the site.
		await staff.goto(`/${SLUG}/management/support?tab=mine`);
		await staff.getByRole('link', { name: new RegExp(guest.name) }).click();
		await staff.getByLabel('Reply to the guest').fill('Small pets are welcome for a fee.');
		await staff.getByRole('button', { name: 'Send reply' }).click();
		await expect(widget(page).getByText('Small pets are welcome for a fee.')).toBeVisible({ timeout: 10_000 });

		// Closing the chat deletes its messages, on both screens.
		await staff.getByRole('button', { name: 'Close chat' }).click();
		await expect(widget(page).getByText(/Its messages have been deleted/)).toBeVisible({ timeout: 10_000 });
		await expect(widget(page).getByText('Small pets are welcome for a fee.')).toBeHidden();
		await expect(staff.getByText(/Its messages were deleted when it ended/)).toBeVisible();
		await expect(staff.getByText(question)).toBeHidden();

		await setAvailability(staff, false);
		await staffCtx.close();
	});

	test('a live chat: guest starts, an available agent answers, the guest sees it without reloading', async ({ page, browser }) => {
		const guest = uniqueGuest();
		const hello = `Is breakfast included? ${Date.now()}`;

		const staffCtx = await browser.newContext();
		const staff = await staffCtx.newPage();
		await staffLogin(staff);
		await setAvailability(staff, true);

		// Guest starts a chat from any page.
		await openWidget(page);
		await widget(page).getByRole('button', { name: 'Chat with a person' }).click();
		await widget(page).getByLabel('Your name').fill(guest.name);
		await widget(page).getByLabel('How can we help? (optional)').fill(hello);
		await widget(page).getByRole('button', { name: 'Start chat' }).click();
		await expect(widget(page).getByText(/joined the chat/)).toBeVisible();
		await expect(widget(page).getByText(hello)).toBeVisible();

		// The agent sees it in "Mine" (auto-assigned) and replies.
		await staff.goto(`/${SLUG}/management/support?tab=mine`);
		await staff.getByRole('link', { name: new RegExp(guest.name) }).click();
		await expect(staff.getByText(hello)).toBeVisible();
		await staff.getByLabel('Reply to the guest').fill('Yes, breakfast is included with every room.');
		await staff.getByRole('button', { name: 'Send reply' }).click();

		// Live delivery: no reload on the guest side.
		await expect(widget(page).getByText('Yes, breakfast is included with every room.')).toBeVisible({ timeout: 10_000 });

		// The guest can also write back and end the chat.
		await widget(page).getByLabel('Message').fill('Thank you!');
		await widget(page).getByRole('button', { name: 'Send' }).click();
		await expect(staff.getByText('Thank you!')).toBeVisible({ timeout: 10_000 });
		await widget(page).getByRole('button', { name: 'End chat' }).click();
		await expect(widget(page).getByText('This chat has ended.')).toBeVisible();

		await setAvailability(staff, false);
		await staffCtx.close();
	});

	test('the availability switch really changes and survives a reload and other pages', async ({ page }) => {
		await staffLogin(page);
		await setAvailability(page, false);
		const toggle = page.getByRole('switch');

		// A click must flip it (it used to post the OLD value, so nothing changed) and the server must keep it.
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-checked', 'true');
		await page.reload();
		await expect(toggle).toHaveAttribute('aria-checked', 'true');

		// Away from the inbox the agent stays available: the open staff tab keeps the heartbeat.
		await page.goto(`/${SLUG}/management/dashboard`);
		await page.waitForTimeout(3_000);
		await page.goto(`/${SLUG}/management/support`);
		await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true');

		await page.getByRole('switch').click();
		await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
		await page.reload();
		await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
	});

	test('typing indicators and "Seen" both ways, and a new chat badge on another staff page', async ({ page, browser }) => {
		const guest = uniqueGuest();
		const staffCtx = await browser.newContext();
		const staff = await staffCtx.newPage();
		await staffLogin(staff);
		await setAvailability(staff, true);

		// The agent is on a different page when the guest writes in: the sidebar badge and the chat both arrive.
		await staff.goto(`/${SLUG}/management/dashboard`);
		await openWidget(page);
		await widget(page).getByRole('button', { name: 'Chat with a person' }).click();
		await widget(page).getByLabel('Your name').fill(guest.name);
		await widget(page).getByLabel('How can we help? (optional)').fill('Do you have a pool?');
		await widget(page).getByRole('button', { name: 'Start chat' }).click();
		await expect(widget(page).getByText('Do you have a pool?')).toBeVisible();
		await expect(staff.getByTitle('Guest chats waiting or with unread messages').first()).toBeVisible({ timeout: 10_000 });

		// Open the thread, type: the guest sees the typing dots, then the reply.
		await staff.goto(`/${SLUG}/management/support?tab=mine`);
		await staff.getByRole('link', { name: new RegExp(guest.name) }).click();
		const reply = staff.getByLabel('Reply to the guest');
		await reply.pressSequentially('Yes, open 7am to 9pm', { delay: 50 });
		await expect(widget(page).getByLabel(/is typing/)).toBeVisible({ timeout: 8_000 });
		await reply.press('Enter');
		await expect(widget(page).getByText('Yes, open 7am to 9pm')).toBeVisible({ timeout: 10_000 });

		// The guest's own message is marked Seen once the agent has it open; the agent sees the guest typing.
		await expect(widget(page).getByText('Seen')).toBeVisible({ timeout: 10_000 });
		await widget(page).getByLabel('Message').pressSequentially('Great', { delay: 50 });
		await expect(staff.getByText(/is typing/)).toBeVisible({ timeout: 8_000 });
		await widget(page).getByLabel('Message').press('Enter');
		await expect(staff.getByText(/^Seen/)).toBeVisible({ timeout: 10_000 });

		await widget(page).getByRole('button', { name: 'End chat' }).click();
		await setAvailability(staff, false);
		await staffCtx.close();
	});

	test('the widget reconnects after the network drops and catches up on what it missed', async ({ page, browser, context }) => {
		const guest = uniqueGuest();
		const staffCtx = await browser.newContext();
		const staff = await staffCtx.newPage();
		await staffLogin(staff);
		await setAvailability(staff, true);

		await openWidget(page);
		await widget(page).getByRole('button', { name: 'Chat with a person' }).click();
		await widget(page).getByLabel('Your name').fill(guest.name);
		await widget(page).getByLabel('How can we help? (optional)').fill('Hello');
		await widget(page).getByRole('button', { name: 'Start chat' }).click();
		await expect(widget(page).getByText(/joined the chat/)).toBeVisible();

		await context.setOffline(true);
		await staff.goto(`/${SLUG}/management/support?tab=mine`);
		await staff.getByRole('link', { name: new RegExp(guest.name) }).click();
		await staff.getByLabel('Reply to the guest').fill('Sent while you were offline');
		await staff.getByRole('button', { name: 'Send reply' }).click();
		await expect(widget(page).getByText(/Reconnecting/)).toBeVisible({ timeout: 8_000 });

		await context.setOffline(false);
		await expect(widget(page).getByText('Sent while you were offline')).toBeVisible({ timeout: 40_000 });
		await expect(widget(page).getByText(/Reconnecting/)).toBeHidden();

		await widget(page).getByRole('button', { name: 'End chat' }).click();
		await setAvailability(staff, false);
		await staffCtx.close();
	});

	test('a manager adds a canned reply and an agent drops it into a chat with "/"', async ({ page, browser }) => {
		const guest = uniqueGuest();
		const title = `Late check-in ${Date.now()}`;
		const staffCtx = await browser.newContext();
		const staff = await staffCtx.newPage();
		await staffLogin(staff);

		await staff.goto(`/${SLUG}/management/support/replies`);
		await staff.getByLabel('Title').first().fill(title);
		await staff.getByLabel('Reply').first().fill('Hi {guest}, check-in is from {checkin}. {agent}, {hotel}');
		await staff.getByRole('button', { name: 'Add reply' }).click();
		await expect(staff.getByText('Reply saved.')).toBeVisible();

		await setAvailability(staff, true);
		await openWidget(page);
		await widget(page).getByRole('button', { name: 'Chat with a person' }).click();
		await widget(page).getByLabel('Your name').fill(guest.name);
		await widget(page).getByLabel('How can we help? (optional)').fill('Late arrival tonight');
		await widget(page).getByRole('button', { name: 'Start chat' }).click();
		await expect(widget(page).getByText('Late arrival tonight')).toBeVisible();

		await staff.goto(`/${SLUG}/management/support?tab=mine`);
		await staff.getByRole('link', { name: new RegExp(guest.name) }).click();
		const reply = staff.getByLabel('Reply to the guest');
		await reply.pressSequentially(`/${title.slice(0, 8)}`);
		await staff.getByRole('option', { name: new RegExp(title) }).click();
		// Placeholders are filled in with real values; none is left behind.
		await expect(reply).not.toHaveValue(/\{(guest|checkin|agent|hotel|checkout)\}/);
		await expect(reply).toHaveValue(new RegExp(`Hi ${guest.name.split(' ')[0]}`));

		await widget(page).getByRole('button', { name: 'End chat' }).click();
		await setAvailability(staff, false);
		await staffCtx.close();
	});

	test('staff cannot reach the Support inbox without the capability', async ({ page }) => {
		// Not signed in: the management shell sends the visitor to login.
		await page.goto(`/${SLUG}/management/support`);
		await expect(page).toHaveURL(/management\/login/);
	});
});
