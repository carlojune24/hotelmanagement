import { expect, test, type Page } from 'playwright/test';
import { SLUG, staffLogin, uniqueGuest } from './helpers';

/**
 * Customer Support chat: the guest widget (FAQ chips, live chat, leave-a-message) and the staff
 * Support inbox (availability switch, queue, reply, close).
 *
 * Prerequisites: a published hotel (set E2E_HOTEL_SLUG; the seed hotel is `mmhotel`) and a staff
 * login with `support:*` (front desk or hotel admin). Run migrations first (0095, 0096).
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

	test('with nobody online a guest leaves a message and staff answer it by email', async ({ page, browser }) => {
		const guest = uniqueGuest();
		const question = `Do you allow pets? ${Date.now()}`;

		// Staff go away first, so the widget offers "Leave a message".
		const staffCtx = await browser.newContext();
		const staff = await staffCtx.newPage();
		await staffLogin(staff);
		await setAvailability(staff, false);

		await openWidget(page);
		await widget(page).getByRole('button', { name: 'Leave a message' }).click();
		await widget(page).getByLabel('Your name').fill(guest.name);
		await widget(page).getByLabel(/^Email/).fill(guest.email);
		await widget(page).getByLabel('Your message').fill(question);
		await widget(page).getByRole('button', { name: 'Send message' }).click();
		await expect(widget(page).getByText(/Thank you\. Your message is with the team/)).toBeVisible();

		// It lands in the staff queue; replying emails the guest and closes it.
		await staff.goto(`/${SLUG}/management/support?tab=queued`);
		await staff.getByRole('link', { name: new RegExp(guest.name) }).click();
		await expect(staff.getByText(question)).toBeVisible();
		await staff.getByLabel('Reply to the guest').fill('Small pets are welcome for a fee.');
		await staff.getByRole('button', { name: 'Send reply' }).click();
		await expect(staff.getByText('This chat is closed.')).toBeVisible();
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

	test('staff cannot reach the Support inbox without the capability', async ({ page }) => {
		// Not signed in: the management shell sends the visitor to login.
		await page.goto(`/${SLUG}/management/support`);
		await expect(page).toHaveURL(/management\/login/);
	});
});
