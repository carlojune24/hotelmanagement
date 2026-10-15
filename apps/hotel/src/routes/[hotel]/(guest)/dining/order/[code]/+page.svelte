<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import StorefrontNav from '$lib/components/storefront/storefront-nav.svelte';
	import StorefrontFooter from '$lib/components/storefront/storefront-footer.svelte';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import TicketIcon from '@lucide/svelte/icons/ticket';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import ReceiptTextIcon from '@lucide/svelte/icons/receipt-text';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The shared guest layout guarantees a hotel (it 404s otherwise); its type is just nullable.
	const hotel = $derived(page.data.hotel!);
	const o = $derived(data.order);
	const isPre = $derived(o.orderType === 'pre_order');
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const clock = (hhmm: string) => new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(`1970-01-01T${hhmm}:00Z`));
	const longDay = (d: string) => new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
	const stamp = (iso: string) => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: hotel.timezone ?? 'Asia/Manila' }).format(new Date(iso));

	const finished = $derived(o.status === 'served' || o.status === 'cancelled');
	const refundDue = $derived(o.status === 'cancelled' && o.paymentStatus === 'paid');

	const HEAD = $derived.by(() => {
		if (o.status === 'cancelled') {
			if (o.paymentStatus === 'refunded') return { title: 'Order cancelled and refunded', note: 'Your refund has been sent. Details are below.' };
			if (refundDue) return { title: 'Order cancelled', note: 'You paid for this order, so the restaurant will send your refund. You will see the details here.' };
			return { title: 'Order cancelled', note: 'No payment is due. You are welcome to order again any time.' };
		}
		if (o.status === 'pending_payment') {
			return data.returned.paid
				? { title: 'Confirming your payment', note: 'This can take a moment. This page updates on its own.' }
				: { title: 'Waiting for your payment', note: 'Your order goes to the kitchen as soon as payment is confirmed.' };
		}
		if (o.status === 'pending_acceptance') {
			return {
				title: 'Waiting for the restaurant to confirm',
				note:
					o.paymentStatus === 'paid'
						? 'Your order is paid. The kitchen starts it as soon as the restaurant confirms. This page updates on its own.'
						: `The kitchen starts it as soon as the restaurant confirms. Please pay when you ${o.fulfilment === 'delivery' ? 'receive it' : 'collect it'}.`
			};
		}
		if (o.held && (o.status === 'new' || o.status === 'accepted') && o.releaseLocal) {
			return {
				title: 'Your order is scheduled',
				note: `${o.paymentStatus === 'paid' ? 'It is paid. ' : ''}The kitchen starts it at ${clock(o.releaseLocal.time)} on ${longDay(o.releaseLocal.date)}, or as soon as you are seated, so it is fresh when you sit down.`
			};
		}
		if (o.status === 'ready') {
			if (isPre) return { title: 'Ready to serve', note: 'It will be brought to your table.' };
			if (o.fulfilment === 'delivery') {
				return o.outForDeliveryAt
					? { title: 'On its way', note: `${o.riderName ?? 'Our rider'} is bringing it to your address.` }
					: { title: 'Ready for delivery', note: 'A rider will take it to your address shortly.' };
			}
			return { title: 'Ready for pickup', note: 'Please come to the restaurant to collect it.' };
		}
		if (o.status === 'served') return { title: isPre ? 'Enjoy your meal' : o.fulfilment === 'delivery' ? 'Delivered' : 'Collected', note: 'Thank you for ordering with us.' };
		if (o.status === 'preparing' || o.status === 'accepted') return { title: 'Being prepared', note: 'The kitchen is working on your order.' };
		return {
			title: 'We have your order',
			note:
				o.paymentStatus === 'paid'
					? 'Your payment is confirmed and the kitchen has your order.'
					: `The kitchen has your order. Please pay when you ${o.fulfilment === 'delivery' ? 'receive it' : 'collect it'}.`
		};
	});

	// Progress: how far along the kitchen has got.
	const STEPS = $derived([
		{ label: 'Placed' },
		{ label: 'Preparing' },
		{ label: 'Ready' },
		{ label: isPre ? 'Served' : o.fulfilment === 'delivery' ? 'Delivered' : 'Collected' }
	]);
	const reached = $derived(({ pending_payment: -1, pending_acceptance: 0, new: 0, accepted: 0, preparing: 1, ready: 2, served: 3, cancelled: -1 } as Record<string, number>)[o.status] ?? -1);

	// Keep the page current while the order is live: every few seconds while a payment is still being confirmed (each
	// load asks PayMongo itself), gently otherwise. It never gives up on a payment.
	$effect(() => {
		if (finished && !refundDue && !o.cancelRequested) return;
		const waitingForPayment = o.status === 'pending_payment';
		const t = setInterval(() => invalidate('app:dining-order'), waitingForPayment ? 5_000 : 15_000);
		return () => clearInterval(t);
	});

	let copiedRef = $state(false);
	async function copyRef() {
		if (!data.paymentRef) return;
		try {
			await navigator.clipboard.writeText(data.paymentRef.paymentId);
			copiedRef = true;
			setTimeout(() => (copiedRef = false), 2000);
		} catch {
			// Clipboard blocked: the reference is still on screen to read.
		}
	}

	let copied = $state(false);
	async function copyCode() {
		try {
			await navigator.clipboard.writeText(o.code);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Clipboard blocked: the code is still on screen to read.
		}
	}

	let confirmCancel = $state(false);
	let askCancel = $state(false);
	let message = $state('');
	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form && 'cancelled' in form && form.cancelled) {
			toast.success('Your order was cancelled.');
			confirmCancel = false;
		}
		if (form && 'requested' in form && form.requested) {
			toast.success('Your request was sent. The restaurant will reply here.');
			askCancel = false;
		}
		if (form && 'sent' in form && form.sent) message = '';
	});

	const q = $derived(`t=${data.token}`);
	const contactPhone = $derived(page.data.branding?.contactPhone ?? null);
</script>

<svelte:head>
	<title>{HEAD.title} — {hotel.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="no-print">
	<StorefrontNav
		hotelSlug={hotel.slug}
		hotelName={hotel.name}
		logoUrl={page.data.branding.logoUrl}
		showAmenities={page.data.hotelAmenities.length > 0}
		showFunctionHall={page.data.functionHalls.length > 0}
		showDining={true}
		showReviews={page.data.reviews.length > 0}
		accent={page.data.theme.accent}
		accentDeep={page.data.theme.accentDeep}
		paper={page.data.theme.paper}
		paperDeep={page.data.theme.paperDeep}
	/>
</div>

<section class="storefront-section">
	<div class="mx-auto max-w-2xl">
		<div class="flex items-start gap-3">
			<span
				class="mt-1 inline-flex size-9 shrink-0 items-center justify-center rounded-full"
				style="background: {o.status === 'cancelled' ? 'var(--ledger-paper-2)' : 'var(--hotel-accent-light)'}; color: {o.status === 'cancelled' ? 'var(--ledger-ink-muted)' : 'var(--hotel-accent-deep)'};"
			>
				{#if o.status === 'cancelled'}<CircleXIcon class="size-5" aria-hidden="true" />{:else if o.status === 'pending_payment'}<ClockIcon class="size-5" aria-hidden="true" />{:else}<CircleCheckIcon class="size-5" aria-hidden="true" />{/if}
			</span>
			<div>
				<h1 class="ledger-display text-2xl sm:text-3xl" aria-live="polite">{HEAD.title}</h1>
				<p class="mt-1 text-[0.9375rem] text-[var(--ledger-ink-muted)]">{HEAD.note}</p>
			</div>
		</div>

		{#if data.returned.payError && o.needsPayment}
			<p role="alert" class="mt-4 border-t border-[var(--ledger-danger)] pt-3 text-sm text-[var(--ledger-danger)]">We could not open the payment page. Please try again.</p>
		{:else if data.returned.cancelled && o.needsPayment}
			<p class="mt-4 text-sm text-[var(--ledger-ink-muted)]">You left the payment page. You can pay now, or cancel the order.</p>
		{/if}

		{#if o.needsPayment}
			<form method="POST" action="?/pay&{q}" class="no-print mt-5">
				<button type="submit" class="ledger-btn-primary min-h-12 px-6">Pay {peso(o.totalCentavos)} now</button>
			</form>
		{/if}

		{#if o.status !== 'cancelled'}
			<ol class="order-progress mt-8" aria-label="Order progress">
				{#each STEPS as step, i (step.label)}
					<li class:is-done={i <= reached} class:is-current={i === reached} aria-current={i === reached ? 'step' : undefined}>
						<span class="order-progress-dot" aria-hidden="true"></span>
						<span class="order-progress-label">{step.label}</span>
					</li>
				{/each}
			</ol>
		{/if}

		<div class="ledger-ticket-frame mt-8">
			<div class="ledger-ticket">
				<div class="flex flex-wrap items-end justify-between gap-3">
					<div>
						<div class="ledger-label flex items-center gap-1.5"><TicketIcon class="size-3.5" aria-hidden="true" /> Order code</div>
						<div class="ledger-data mt-1 text-3xl font-semibold tracking-[0.12em] sm:text-4xl" aria-label="Order code {o.code.split('').join(' ')}">{o.code}</div>
					</div>
					<button type="button" onclick={copyCode} class="ledger-btn-ghost no-print inline-flex min-h-11 items-center gap-1.5 text-sm">
						{#if copied}<CheckIcon class="size-4" aria-hidden="true" /> Copied{:else}<CopyIcon class="size-4" aria-hidden="true" /> Copy code{/if}
					</button>
				</div>

				{#if data.paymentRef}
					<!-- Proof of payment: PayMongo's own reference, the same ID the restaurant sees and a refund is traced by. -->
					<div class="mt-4 border-t border-[var(--ledger-rule)] pt-3">
						<p class="ledger-label">Payment reference</p>
						<div class="mt-1 flex flex-wrap items-center justify-between gap-2">
							<span class="ledger-data text-sm font-semibold break-all" style="color: var(--hotel-accent-deep)">{data.paymentRef.paymentId}</span>
							<button type="button" class="no-print text-xs underline underline-offset-2" onclick={copyRef}>{copiedRef ? 'Copied' : 'Copy'}</button>
						</div>
						{#if data.paymentRef.intentId}<p class="ledger-data mt-0.5 text-xs break-all text-[var(--ledger-ink-muted)]">{data.paymentRef.intentId}</p>{/if}
					</div>
				{:else if data.tracking.waiting && data.tracking.code}
					<div class="mt-4 border-t border-[var(--ledger-rule)] pt-3 text-sm">
						<p class="ledger-label">Payment check code</p>
						<p class="ledger-data mt-1 font-medium">{data.tracking.code}</p>
						<p class="mt-1 text-xs text-[var(--ledger-ink-muted)]">
							We are checking your payment with PayMongo and keep checking, even if you close this page. If you already paid,
							please do not pay again. Quote this code and your order code if you contact the restaurant.
						</p>
					</div>
				{/if}

				<div class="mt-5 border-t border-[var(--ledger-rule)] pt-4">
					<div class="ledger-display text-lg">{o.guestName ?? 'Guest'}</div>
					<p class="text-sm text-[var(--ledger-ink-muted)]">{o.venueTitle}</p>
				</div>

				<dl class="mt-2 divide-y divide-[var(--ledger-rule)]">
					{#if o.pickupLocal}
						<div class="flex items-baseline justify-between gap-4 py-3">
							<dt class="ledger-label">{isPre ? 'At your table' : o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</dt>
							<dd class="ledger-data text-right">{longDay(o.pickupLocal.date)}, {clock(o.pickupLocal.time)}</dd>
						</div>
					{/if}
					{#if o.fulfilment === 'delivery' && o.deliveryAddress}
						<div class="flex items-baseline justify-between gap-4 py-3">
							<dt class="ledger-label">Deliver to</dt>
							<dd class="text-right text-sm">{o.deliveryAddress}</dd>
						</div>
					{/if}
					{#if o.fulfilment === 'delivery' && o.riderName && o.status !== 'cancelled'}
						<div class="flex items-baseline justify-between gap-4 py-3">
							<dt class="ledger-label">Rider</dt>
							<dd class="text-right text-sm">{o.riderName}{#if o.riderPhone} · <a class="underline" href="tel:{o.riderPhone}">{o.riderPhone}</a>{/if}</dd>
						</div>
					{/if}
					<div class="flex items-baseline justify-between gap-4 py-3">
						<dt class="ledger-label">Payment</dt>
						<dd class="text-right text-sm">
							{o.paymentStatus === 'paid' ? 'Paid' : o.paymentStatus === 'refunded' ? 'Refunded' : o.needsPayment ? 'Waiting for payment' : 'Pay at the restaurant'}
						</dd>
					</div>
				</dl>

				<ul class="mt-1 divide-y divide-[var(--ledger-rule)]">
					{#each o.items as i (i.id)}
						<li class="flex gap-3 py-3">
							<span class="ledger-data w-8 shrink-0 text-sm text-[var(--ledger-ink-muted)]">{i.quantity}×</span>
							<div class="min-w-0 flex-1">
								<p class="font-medium">{i.name}</p>
								{#each i.addons as a (a)}<p class="text-sm text-[var(--ledger-ink-muted)]">+ {a}</p>{/each}
								{#if i.remarks}<p class="text-sm italic text-[var(--ledger-ink-muted)]">“{i.remarks}”</p>{/if}
							</div>
							<span class="ledger-data text-sm">{peso(i.lineTotalCentavos)}</span>
						</li>
					{/each}
				</ul>
				{#if o.deliveryFeeCentavos > 0}
					<div class="flex gap-3 border-t border-[var(--ledger-rule)] py-3">
						<span class="min-w-0 flex-1 font-medium">Delivery fee</span>
						<span class="ledger-data text-sm">{peso(o.deliveryFeeCentavos)}</span>
					</div>
				{/if}
				<div class="order-total">
					<span>Total <span class="text-xs text-[var(--ledger-ink-muted)]">VAT included</span></span>
					<span class="ledger-data text-lg">{peso(o.totalCentavos)}</span>
				</div>
				{#if o.remarks}<p class="mt-3 text-sm text-[var(--ledger-ink-muted)]">Your note: {o.remarks}</p>{/if}
				{#if o.pickupNote && !isPre && o.fulfilment !== 'delivery' && o.status !== 'cancelled'}<p class="mt-3 text-sm">{o.pickupNote}</p>{/if}
			</div>
		</div>

		{#if o.refund}
			<p class="mt-4 text-sm">
				<strong class="font-medium">Refund sent:</strong>
				<span class="ledger-data">{peso(o.refund.amountCentavos)}</span>{o.refund.method ? ` via ${o.refund.method.replace('_', ' ')}` : ''}{o.refund.referenceNo ? `, reference ${o.refund.referenceNo}` : ''}.
			</p>
		{/if}

		<div class="no-print mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
			<button type="button" onclick={() => window.print()} class="ledger-btn-ghost inline-flex min-h-11 items-center gap-1.5 text-sm">
				<PrinterIcon class="size-4" aria-hidden="true" /> Print
			</button>
			{#if o.receipt}
				<a href="/{hotel.slug}/print/receipt/{o.receipt.id}?{q}" target="_blank" rel="noopener" class="ledger-btn-ghost inline-flex min-h-11 items-center gap-1.5 text-sm">
					<ReceiptTextIcon class="size-4" aria-hidden="true" /> Receipt {o.receipt.formattedNo}
				</a>
			{/if}
			{#if o.canCancel}
				<button type="button" onclick={() => (confirmCancel = true)} class="ledger-btn-ghost inline-flex min-h-11 items-center text-sm">Cancel order</button>
			{/if}
			{#if o.canRequestCancel}
				<button type="button" onclick={() => (askCancel = true)} class="ledger-btn-ghost inline-flex min-h-11 items-center text-sm">Request cancellation</button>
			{/if}
			{#if o.cancelRequested}<span class="text-sm text-[var(--ledger-ink-muted)]">Cancellation requested. The restaurant will reply below.</span>{/if}
			{#if contactPhone}
				<a href="tel:{contactPhone}" class="ledger-btn-ghost inline-flex min-h-11 items-center gap-1.5 text-sm"><PhoneIcon class="size-4" aria-hidden="true" /> {contactPhone}</a>
			{/if}
		</div>

		{#if confirmCancel}
			<div class="no-print mt-4 border-t border-[var(--ledger-rule)] pt-5" role="alertdialog" aria-labelledby="cancelTitle">
				<p id="cancelTitle" class="ledger-display text-lg">Cancel this order?</p>
				<p class="mt-1 text-sm text-[var(--ledger-ink-muted)]">Nothing has been charged. The kitchen will not prepare it.</p>
				<div class="mt-4 flex flex-wrap items-center gap-3">
					<button type="button" onclick={() => (confirmCancel = false)} class="ledger-btn-primary min-h-11 px-5">Keep my order</button>
					<form method="POST" action="?/cancel&{q}" use:enhance><button type="submit" class="ledger-btn-ghost inline-flex min-h-11 items-center text-sm">Yes, cancel it</button></form>
				</div>
			</div>
		{/if}

		{#if askCancel}
			<form method="POST" action="?/requestCancel&{q}" use:enhance class="no-print mt-4 space-y-3 border-t border-[var(--ledger-rule)] pt-5">
				<p class="ledger-display text-lg">Ask to cancel this order</p>
				<p class="text-sm text-[var(--ledger-ink-muted)]">You have paid, so the restaurant decides and will reply here. If it is cancelled, your refund is sent to you.</p>
				<div>
					<Label for="cancelNote" class="ledger-label">Reason (optional)</Label>
					<Textarea id="cancelNote" name="note" rows={2} maxlength={500} class="ledger-field mt-1" />
				</div>
				<div class="flex flex-wrap items-center gap-3">
					<button type="submit" class="ledger-btn-primary min-h-11 px-5">Send request</button>
					<button type="button" onclick={() => (askCancel = false)} class="ledger-btn-ghost inline-flex min-h-11 items-center text-sm">Never mind</button>
				</div>
			</form>
		{/if}

		<section class="no-print mt-12" aria-labelledby="msgs">
			<h2 id="msgs" class="ledger-label w-full border-b border-[var(--ledger-rule)] pb-2">Message the restaurant</h2>
			{#if o.messages.length > 0}
				<ul class="mt-2">
					{#each o.messages as m (m.id)}
						<li class="order-message" class:is-staff={m.direction === 'staff'}>
							<p class="ledger-label">{m.direction === 'staff' ? 'Restaurant' : 'You'} · {stamp(m.createdAt)}</p>
							<p class="mt-0.5 whitespace-pre-line text-[0.9375rem]">{m.body}</p>
						</li>
					{/each}
				</ul>
			{/if}
			<form method="POST" action="?/message&{q}" use:enhance class="mt-4 space-y-3">
				<Label for="msgBody" class="sr-only">Your message</Label>
				<Textarea id="msgBody" name="body" bind:value={message} rows={2} maxlength={1000} placeholder="Ask about your order" class="ledger-field" />
				<button type="submit" class="ledger-btn-primary min-h-11 px-5" disabled={!message.trim()}>Send message</button>
			</form>
		</section>

		<p class="no-print mt-10 text-sm"><a href="/{hotel.slug}/dining" class="underline underline-offset-4">Back to dining</a></p>
	</div>
</section>

<div class="no-print">
	<StorefrontFooter
		hotelSlug={hotel.slug}
		hotelName={hotel.name}
		city={hotel.city}
		showAmenities={page.data.hotelAmenities.length > 0}
		showFunctionHall={page.data.functionHalls.length > 0}
		showDining={true}
		showReviews={page.data.reviews.length > 0}
		facebookUrl={page.data.branding.facebookUrl}
		instagramUrl={page.data.branding.instagramUrl}
		tiktokUrl={page.data.branding.tiktokUrl}
	/>
</div>
