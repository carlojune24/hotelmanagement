<script lang="ts">
	interface RegistrationCardData {
		hotel: { name: string; legalName: string | null; address: string | null };
		guest: { fullName: string; email: string; phone: string | null };
		checkIn: string;
		checkOut: string;
		occupancy: number;
		roomTypeName: string;
		ratePlanName: string;
		assignedRoomNumbers: string[];
		bookingRef: string;
		guestIdPhotoUrl: string | null;
	}

	let { data, printedAt }: { data: RegistrationCardData; printedAt: string } = $props();
	const d = $derived(data);
</script>

<div class="rc-page">
	<div class="rc-frame">
		<header class="rc-head">
			<div class="rc-issuer">
				<div class="rc-name">{d.hotel.legalName || d.hotel.name}</div>
				{#if d.hotel.legalName && d.hotel.legalName !== d.hotel.name}
					<div class="rc-soft">operating as {d.hotel.name}</div>
				{/if}
				{#if d.hotel.address}<div class="rc-soft">{d.hotel.address}</div>{/if}
			</div>
			<div class="rc-title">
				<div class="rc-title-word">Guest Registration Card</div>
				<div class="rc-mono rc-title-ref">Booking {d.bookingRef}</div>
			</div>
		</header>

		<div class="rc-rule"></div>

		<div class="rc-body">
			<div class="rc-main">
				<section class="rc-section">
					<div class="rc-label">On file</div>
					<dl class="rc-facts">
						<div><dt>Guest name</dt><dd>{d.guest.fullName}</dd></div>
						<div><dt>Email</dt><dd>{d.guest.email}</dd></div>
						{#if d.guest.phone}<div><dt>Phone</dt><dd>{d.guest.phone}</dd></div>{/if}
						<div><dt>Room</dt><dd>{d.roomTypeName} · {d.assignedRoomNumbers.join(', ') || '—'}</dd></div>
						<div><dt>Rate plan</dt><dd>{d.ratePlanName}</dd></div>
						<div><dt>Check-in</dt><dd class="rc-mono">{d.checkIn}</dd></div>
						<div><dt>Check-out</dt><dd class="rc-mono">{d.checkOut}</dd></div>
						<div><dt>Occupancy</dt><dd>{d.occupancy} guest{d.occupancy === 1 ? '' : 's'}</dd></div>
					</dl>
				</section>

				<section class="rc-section">
					<div class="rc-label">To be completed at the counter</div>
					<div class="rc-blank-grid">
						<div class="rc-blank rc-blank-wide"><span>Complete address</span></div>
						<div class="rc-blank"><span>Valid ID type</span></div>
						<div class="rc-blank"><span>ID number</span></div>
						<div class="rc-blank"><span>Nationality</span></div>
						<div class="rc-blank"><span>Vehicle plate (if any)</span></div>
						<div class="rc-blank rc-blank-wide"><span>Purpose of visit</span></div>
					</div>
				</section>
			</div>

			<div class="rc-photo">
				{#if d.guestIdPhotoUrl}
					<img src={d.guestIdPhotoUrl} alt="Captured guest ID" />
				{:else}
					<div class="rc-photo-empty">No ID photo on file</div>
				{/if}
			</div>
		</div>

		<div class="rc-fill"></div>

		<section class="rc-signatures">
			<div><div class="rc-sign-line"></div>Guest signature &amp; date</div>
			<div><div class="rc-sign-line"></div>Front desk — checked in by</div>
		</section>

		<p class="rc-legal">
			This card records who occupied this room for the hotel's own guest-registration file. It is
			not an accountable form and carries no serial number.
			<span class="rc-mono">Printed {printedAt}.</span>
		</p>
	</div>
</div>

<style>
	.rc-page {
		--af-ink: #1a1a1a;
		--af-ink-soft: #55524c;
		--af-rule: #b7b2a8;
		box-sizing: border-box;
		width: 210mm;
		min-height: 297mm;
		margin: 0 auto;
		padding: 10mm;
		background: #fff;
		color: var(--af-ink);
		font-family: 'Inter Variable', 'Inter', system-ui, sans-serif;
		font-size: 10pt;
		line-height: 1.4;
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}
	.rc-page :global(*) {
		box-sizing: border-box;
	}
	.rc-frame {
		display: flex;
		flex-direction: column;
		border: 3px double var(--af-ink);
		padding: 6mm;
		min-height: calc(297mm - 20mm);
	}
	.rc-mono {
		font-family: 'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
	}
	.rc-soft {
		font-size: 8.5pt;
		color: var(--af-ink-soft);
	}
	.rc-head {
		display: flex;
		justify-content: space-between;
		gap: 10mm;
	}
	.rc-name {
		font-size: 15pt;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.01em;
	}
	.rc-title {
		text-align: right;
		min-width: 62mm;
	}
	.rc-title-word {
		font-size: 13pt;
		font-weight: 700;
		letter-spacing: 0.04em;
	}
	.rc-title-ref {
		font-size: 9pt;
		color: var(--af-ink-soft);
		margin-top: 1mm;
	}
	.rc-rule {
		height: 2px;
		background: var(--af-ink);
		margin: 4mm 0;
	}
	.rc-label {
		font-size: 7.5pt;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--af-ink-soft);
		margin-bottom: 2mm;
	}
	.rc-body {
		display: flex;
		gap: 8mm;
	}
	.rc-main {
		flex: 1;
		min-width: 0;
	}
	.rc-section + .rc-section {
		margin-top: 6mm;
	}
	.rc-facts {
		margin: 0;
		font-size: 9.5pt;
	}
	.rc-facts div {
		display: flex;
		justify-content: space-between;
		gap: 4mm;
		padding: 1mm 0;
		border-bottom: 1px solid var(--af-rule);
	}
	.rc-facts dt {
		color: var(--af-ink-soft);
	}
	.rc-facts dd {
		margin: 0;
		text-align: right;
		font-weight: 500;
	}
	.rc-blank-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4mm 6mm;
	}
	.rc-blank {
		border-bottom: 1px solid var(--af-ink);
		padding-bottom: 6mm;
		position: relative;
	}
	.rc-blank-wide {
		grid-column: 1 / -1;
	}
	.rc-blank span {
		position: absolute;
		bottom: 1mm;
		left: 0;
		font-size: 7pt;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--af-ink-soft);
	}
	.rc-photo {
		width: 42mm;
		flex-shrink: 0;
	}
	.rc-photo img {
		width: 100%;
		height: 52mm;
		object-fit: cover;
		border: 1px solid var(--af-ink);
	}
	.rc-photo-empty {
		width: 100%;
		height: 52mm;
		border: 1px dashed var(--af-rule);
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 3mm;
		font-size: 7.5pt;
		color: var(--af-ink-soft);
	}
	.rc-fill {
		flex: 1;
		min-height: 6mm;
	}
	.rc-signatures {
		display: flex;
		gap: 14mm;
		margin-top: 10mm;
		font-size: 7.5pt;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--af-ink-soft);
		break-inside: avoid;
	}
	.rc-signatures div {
		flex: 1;
	}
	.rc-sign-line {
		border-top: 1px solid var(--af-ink);
		margin-bottom: 1mm;
		height: 10mm;
	}
	.rc-legal {
		margin-top: 6mm;
		padding-top: 3mm;
		border-top: 1px solid var(--af-rule);
		font-size: 7.5pt;
		line-height: 1.5;
		color: var(--af-ink-soft);
		break-inside: avoid;
	}

	@media screen {
		.rc-page {
			margin: 24px auto;
			border: 1px solid var(--af-rule);
		}
	}
	@page {
		size: A4;
		margin: 10mm;
	}
	@media print {
		.rc-page {
			margin: 0;
			padding: 0;
			width: auto;
			min-height: auto;
		}
	}
</style>
