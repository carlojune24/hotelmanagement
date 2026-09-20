<script lang="ts">
	/** Booking Transaction Statement — every room's folio, the payments, the city ledger and the whole
	 *  booking's balance on one A4 sheet. Staff-only, non-accountable (no serial number). */
	interface Charge {
		id: string;
		description: string;
		quantity: number;
		totalCentavos: number;
		voided: boolean;
	}
	interface Line {
		id: string;
		title: string;
		detail: string;
		status: string;
		charges: Charge[];
		chargesCentavos: number;
		deposit: {
			status: string;
			amountCentavos: number;
			forfeitedCentavos: number | null;
			refundedCentavos: number | null;
		} | null;
		depositAppliedCentavos: number;
		paymentsCentavos: number;
		cityLedgerMovedCentavos: number;
		balanceCentavos: number;
	}
	interface Payment {
		id: string;
		method: string;
		purpose: string;
		amountCentavos: number;
		paidAt: string | null;
		voidedAt: string | null;
		referenceNo: string | null;
		lineTitle: string | null;
		allocations: { title: string; amountCentavos: number }[];
	}
	interface Data {
		hotel: { name: string; legalName: string | null; address: string | null };
		order: { code: string; status: string };
		guest: { fullName: string; email: string; phone: string | null };
		lines: Line[];
		payments: Payment[];
		ledger: {
			chargesTotalCentavos: number;
			balanceCentavos: number;
			depositAppliedTotalCentavos: number;
			cityLedgerTotalCentavos: number;
			paymentsReceivedCentavos: number;
		};
		cityLedgerAccount: {
			billToName: string;
			billToCompany: string | null;
			originalCentavos: number;
			outstandingCentavos: number;
		} | null;
	}

	let { data, printedAt }: { data: Data; printedAt: string } = $props();
	const d = $derived(data);

	const peso = (c: number) =>
		`${c < 0 ? '−' : ''}₱${(Math.abs(c) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const label = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
	const METHOD: Record<string, string> = {
		cash: 'Cash',
		card: 'Card',
		gcash: 'GCash',
		maya: 'Maya',
		bank_transfer: 'Bank transfer',
		cheque: 'Cheque',
		paymongo: 'Online (PayMongo)',
		house_use: 'City ledger',
		security_deposit: 'Security deposit'
	};
	const when = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
	const balance = $derived(d.ledger.balanceCentavos);
</script>

<div class="ts-page">
	<div class="ts-frame">
		<header class="ts-head">
			<div>
				<div class="ts-name">{d.hotel.legalName || d.hotel.name}</div>
				{#if d.hotel.legalName && d.hotel.legalName !== d.hotel.name}
					<div class="ts-soft">operating as {d.hotel.name}</div>
				{/if}
				{#if d.hotel.address}<div class="ts-soft">{d.hotel.address}</div>{/if}
			</div>
			<div class="ts-title">
				<div class="ts-title-word">Booking Transaction Statement</div>
				<div class="ts-mono ts-ref">Booking {d.order.code}</div>
				<div class="ts-soft">Printed {printedAt}</div>
			</div>
		</header>
		<div class="ts-rule"></div>

		<section class="ts-guest">
			<div><span class="ts-k">Guest</span> {d.guest.fullName}</div>
			<div><span class="ts-k">Email</span> {d.guest.email}</div>
			{#if d.guest.phone}<div><span class="ts-k">Phone</span> {d.guest.phone}</div>{/if}
			<div><span class="ts-k">Booking status</span> {label(d.order.status)}</div>
		</section>

		<div class="ts-label">Each room</div>
		{#each d.lines as l (l.id)}
			<section class="ts-room">
				<div class="ts-room-head">
					<strong>{l.title}</strong>
					<span class="ts-soft">{l.detail} · {label(l.status)}</span>
				</div>
				<table>
					<tbody>
						{#each l.charges as c (c.id)}
							<tr class:ts-void={c.voided}>
								<td>{c.description}{c.quantity > 1 ? ` × ${c.quantity}` : ''}{c.voided ? ' (voided)' : ''}</td>
								<td class="ts-num">{peso(c.totalCentavos)}</td>
							</tr>
						{/each}
						{#if l.deposit}
							<tr class="ts-note">
								<td colspan="2">
									Security deposit {peso(l.deposit.amountCentavos)} —
									{#if l.deposit.status === 'held'}held (not part of the bill)
									{:else if l.deposit.status === 'voided'}voided
									{:else}settled: {peso(l.deposit.forfeitedCentavos ?? 0)} kept for damage, {peso(l.deposit.refundedCentavos ?? 0)} refunded{/if}
								</td>
							</tr>
						{/if}
						{#if l.depositAppliedCentavos > 0}
							<tr><td>Less: security deposit applied to damage</td><td class="ts-num">−{peso(l.depositAppliedCentavos)}</td></tr>
						{/if}
						<tr><td>Less: payments received on this room</td><td class="ts-num">−{peso(l.paymentsCentavos)}</td></tr>
						{#if l.cityLedgerMovedCentavos > 0}
							<tr><td>Less: moved to the city ledger</td><td class="ts-num">−{peso(l.cityLedgerMovedCentavos)}</td></tr>
						{/if}
						<tr class="ts-total">
							<td>{l.balanceCentavos < 0 ? 'Room credit' : 'Room balance'}</td>
							<td class="ts-num">{l.balanceCentavos === 0 ? 'Settled' : peso(Math.abs(l.balanceCentavos))}</td>
						</tr>
					</tbody>
				</table>
			</section>
		{/each}

		<div class="ts-label">Payments received</div>
		{#if d.payments.length === 0}
			<p class="ts-soft">No payment recorded.</p>
		{:else}
			<table class="ts-pay">
				<tbody>
					{#each d.payments as p (p.id)}
						<tr class:ts-void={!!p.voidedAt}>
							<td>
								{METHOD[p.method] ?? p.method}{p.purpose === 'refund' ? ' (refund)' : ''}{p.voidedAt ? ' — voided' : ''}
								<div class="ts-soft">
									{when(p.paidAt)}{p.referenceNo ? ` · Ref ${p.referenceNo}` : ''}{p.lineTitle ? ` · ${p.lineTitle}` : ''}
									{#if p.allocations.length}
										· Split: {p.allocations.map((a) => `${a.title} ${peso(a.amountCentavos)}`).join(' · ')}
									{/if}
								</div>
							</td>
							<td class="ts-num">{peso(p.amountCentavos)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}

		{#if d.cityLedgerAccount}
			<div class="ts-label">City ledger account</div>
			<p>
				Bill to <strong>{d.cityLedgerAccount.billToName}</strong>{d.cityLedgerAccount.billToCompany ? ` · ${d.cityLedgerAccount.billToCompany}` : ''}
				— moved from the rooms {peso(d.cityLedgerAccount.originalCentavos)}, still to collect
				<strong>{peso(d.cityLedgerAccount.outstandingCentavos)}</strong>.
			</p>
		{/if}

		<div class="ts-label">Whole booking</div>
		<table class="ts-sum">
			<tbody>
				{#each d.lines as l (l.id)}
					<tr>
						<td>{l.title}</td>
						<td class="ts-num">{peso(l.chargesCentavos)}</td>
					</tr>
				{/each}
				<tr class="ts-sub"><td>Total charges</td><td class="ts-num">{peso(d.ledger.chargesTotalCentavos)}</td></tr>
				{#if d.ledger.depositAppliedTotalCentavos > 0}
					<tr><td>Less: security deposits applied to damage</td><td class="ts-num">−{peso(d.ledger.depositAppliedTotalCentavos)}</td></tr>
				{/if}
				<tr><td>Less: payments received</td><td class="ts-num">−{peso(d.ledger.paymentsReceivedCentavos)}</td></tr>
				{#if d.ledger.cityLedgerTotalCentavos > 0}
					<tr><td>Less: moved to the city ledger</td><td class="ts-num">−{peso(d.ledger.cityLedgerTotalCentavos)}</td></tr>
				{/if}
				<tr class="ts-grand">
					<td>{balance < 0 ? 'Credit owed to guest' : balance === 0 ? 'Balance' : 'BALANCE STILL OWED BY THE GUEST'}</td>
					<td class="ts-num">{balance === 0 ? 'SETTLED' : peso(Math.abs(balance))}</td>
				</tr>
			</tbody>
		</table>

		<div class="ts-sign">
			<div><span>Prepared by</span></div>
			<div><span>Guest signature</span></div>
		</div>
		<p class="ts-foot ts-soft">
			This statement is not an official receipt or invoice. Official Receipts and Invoices are issued separately.
		</p>
	</div>
</div>

<style>
	.ts-page {
		--ink: #1a1a1a;
		--soft: #55524c;
		--rule: #b7b2a8;
		box-sizing: border-box;
		width: 210mm;
		margin: 0 auto;
		padding: 10mm;
		background: #fff;
		color: var(--ink);
		font-family: 'Inter Variable', 'Inter', system-ui, sans-serif;
		font-size: 9.5pt;
		line-height: 1.4;
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}
	.ts-page :global(*) {
		box-sizing: border-box;
	}
	.ts-frame {
		border: 3px double var(--ink);
		padding: 6mm;
	}
	.ts-mono,
	.ts-num {
		font-family: 'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
	}
	.ts-soft {
		font-size: 8.5pt;
		color: var(--soft);
	}
	.ts-head {
		display: flex;
		justify-content: space-between;
		gap: 10mm;
	}
	.ts-name {
		font-size: 15pt;
		font-weight: 700;
		text-transform: uppercase;
	}
	.ts-title {
		text-align: right;
	}
	.ts-title-word {
		font-size: 12pt;
		font-weight: 700;
		text-transform: uppercase;
	}
	.ts-ref {
		font-size: 11pt;
	}
	.ts-rule {
		border-top: 1px solid var(--ink);
		margin: 4mm 0;
	}
	.ts-guest {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1mm 6mm;
		margin-bottom: 4mm;
	}
	.ts-k {
		display: inline-block;
		min-width: 24mm;
		color: var(--soft);
		font-size: 8.5pt;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.ts-label {
		margin: 5mm 0 1.5mm;
		font-size: 8.5pt;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		border-bottom: 1px solid var(--rule);
		padding-bottom: 1mm;
	}
	.ts-room {
		margin-bottom: 3mm;
		break-inside: avoid;
	}
	.ts-room-head {
		display: flex;
		justify-content: space-between;
		gap: 4mm;
		padding: 1mm 0;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	td {
		padding: 0.8mm 0;
		border-bottom: 1px solid #e6e2d9;
		vertical-align: top;
	}
	.ts-num {
		text-align: right;
		white-space: nowrap;
		padding-left: 4mm;
	}
	.ts-void td {
		text-decoration: line-through;
		color: var(--soft);
	}
	.ts-note td {
		font-size: 8.5pt;
		color: var(--soft);
	}
	.ts-total td {
		font-weight: 700;
		border-top: 1px solid var(--ink);
		border-bottom: none;
	}
	.ts-sub td {
		font-weight: 600;
		border-top: 1px solid var(--rule);
	}
	.ts-grand td {
		font-size: 11pt;
		font-weight: 700;
		border-top: 2px solid var(--ink);
		border-bottom: 3px double var(--ink);
		padding: 1.5mm 0;
	}
	.ts-sign {
		display: flex;
		gap: 12mm;
		margin-top: 12mm;
	}
	.ts-sign div {
		flex: 1;
		border-top: 1px solid var(--ink);
		padding-top: 1mm;
		font-size: 8.5pt;
		color: var(--soft);
	}
	.ts-foot {
		margin-top: 4mm;
	}
	@media print {
		.ts-page {
			padding: 0;
		}
	}
	@page {
		size: A4;
		margin: 10mm;
	}
</style>
