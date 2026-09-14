<script lang="ts">
	interface Endpoint {
		method: string;
		path: string;
		desc: string;
		params: { name: string; desc: string }[];
		shape: string;
	}

	const listEndpoints: Endpoint[] = [
		{
			method: 'GET',
			path: '/api/v1/finance/accounts',
			desc: "The hotel's chart of accounts.",
			params: [],
			shape: `{
  "id": "uuid",
  "account_ref": "acct_01J9Z...",
  "hotel_id": "uuid",
  "code": "1010",
  "name": "Front Desk Drawer",
  "type": "asset",
  "subtype": "cash_on_hand",
  "normal_balance": "debit",
  "is_postable": true,
  "is_active": true,
  "updated_at": "2026-09-14T04:00:00.000Z",
  "deleted_at": null
}`
		},
		{
			method: 'GET',
			path: '/api/v1/finance/journal-entries',
			desc: 'Posted double-entry journal entries, each with its balanced lines inline.',
			params: [],
			shape: `{
  "id": "uuid",
  "hotel_id": "uuid",
  "entry_no": "JE-000123",
  "entry_date": "2026-09-14",
  "memo": "string | null",
  "source_type": "cash_movement | manual",
  "source_id": "uuid | null",
  "reversal_of_entry_id": "uuid | null",
  "lines": [
    {
      "account_id": "uuid",
      "debit_minor": 10000,
      "credit_minor": 0,
      "department": null,
      "cost_center": null,
      "project": null
    }
  ],
  "updated_at": "2026-09-14T04:00:00.000Z",
  "deleted_at": null
}`
		},
		{
			method: 'GET',
			path: '/api/v1/finance/cash-movements',
			desc: 'The cash-basis ledger — every peso in or out. A voided movement presents with deleted_at set, so a naive sync drops it automatically.',
			params: [],
			shape: `{
  "id": "uuid",
  "hotel_id": "uuid",
  "business_date": "2026-09-14",
  "direction": "in | out",
  "category": "room_revenue | hall_revenue | ... (16 values)",
  "cash_account_id": "uuid",
  "amount_minor": 10000,
  "journal_entry_id": "uuid | null",
  "source_type": "string",
  "source_id": "uuid | null",
  "updated_at": "2026-09-14T04:00:00.000Z",
  "deleted_at": "2026-09-14T05:00:00.000Z | null"
}`
		}
	];

	const reportEndpoints: Endpoint[] = [
		{
			method: 'GET',
			path: '/api/v1/finance/reports/trial-balance',
			desc: 'Debits/credits per account for the range. The grand total across every row balances.',
			params: [
				{ name: 'date_from', desc: 'YYYY-MM-DD, required' },
				{ name: 'date_to', desc: 'YYYY-MM-DD, required' }
			],
			shape: `{ "accountId", "code", "name", "type", "debitMinor", "creditMinor" }`
		},
		{
			method: 'GET',
			path: '/api/v1/finance/reports/income-statement',
			desc: 'Revenue less expense, grouped by account subtype, one column per requested hotel plus a total. This is the consolidated view.',
			params: [
				{ name: 'date_from', desc: 'YYYY-MM-DD, required' },
				{ name: 'date_to', desc: 'YYYY-MM-DD, required' }
			],
			shape: `{ "subtype", "label", "byHotel": { "<hotelId>": 123400 }, "total": 123400 }`
		},
		{
			method: 'GET',
			path: '/api/v1/finance/reports/balance-sheet',
			desc: 'Asset/liability/equity balances as of a date — a point-in-time snapshot, not a range.',
			params: [{ name: 'date_to', desc: 'YYYY-MM-DD, required' }],
			shape: `{ "accountId", "code", "name", "type", "subtype", "balanceMinor" }`
		},
		{
			method: 'GET',
			path: '/api/v1/finance/reports/ledger',
			desc: 'Opening balance + chronological movements + running balance, for one account.',
			params: [
				{ name: 'account_id', desc: 'uuid, required — from /accounts' },
				{ name: 'date_from', desc: 'YYYY-MM-DD, required' },
				{ name: 'date_to', desc: 'YYYY-MM-DD, required' }
			],
			shape: `{ "journalEntryId", "entryNo", "date", "memo", "sourceType", "sourceId", "debitMinor", "creditMinor", "runningBalanceMinor" }`
		}
	];
</script>

<div class="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
	<a href="/admin/api-keys" class="text-sm text-brand hover:underline">&larr; API keys</a>
	<h1 class="mb-1 mt-2 text-xl font-semibold tracking-tight text-ink">Finance API</h1>
	<p class="mb-8 text-sm text-ink-muted">
		A read-only API for pulling finance data out of this hotel (or several, for a key scoped to
		more than one) — built so a central reporting tool across your businesses can consolidate
		without per-app mapping work. Every endpoint below lives under this app's own domain.
	</p>

	<section class="mb-8 space-y-3 rounded-xl border border-border bg-surface-2 p-5">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">Authentication</h2>
		<p class="text-sm text-ink">
			Send the raw key as a bearer token. Get one from
			<a href="/admin/api-keys" class="text-brand hover:underline">API keys</a>
			(spans any hotels you pick) or from a single hotel's own Finance &rarr; Settings (that hotel
			only).
		</p>
		<pre class="overflow-x-auto rounded-lg bg-ink px-3 py-2 text-xs text-white">Authorization: Bearer mmhk_live_&lt;...&gt;</pre>
		<p class="text-sm text-ink-muted">
			401 for a missing/malformed header, an unknown key, or one that's revoked or expired. 403
			if you ask for a <code class="text-xs">hotel_id</code> the key isn't scoped to &mdash; never
			silently filtered. Every response carries an
			<code class="text-xs">X-MM-Standard-Version</code> header (currently <code class="text-xs">1.0.0</code
			>); a breaking change to these shapes bumps the major version, additive changes don't.
		</p>
	</section>

	<section class="mb-8 space-y-3 rounded-xl border border-border bg-surface-2 p-5">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">Choosing hotels</h2>
		<p class="text-sm text-ink">
			Every endpoint takes a repeatable <code class="text-xs">hotel_id</code> query param. Omit it
			to get everything your key is scoped to; pass it (one or more times) to narrow to specific
			hotels within that scope.
		</p>
		<pre class="overflow-x-auto rounded-lg bg-ink px-3 py-2 text-xs text-white">GET /api/v1/finance/reports/income-statement?hotel_id=&lt;a&gt;&amp;hotel_id=&lt;b&gt;&amp;date_from=2026-09-01&amp;date_to=2026-09-30</pre>
	</section>

	<section class="mb-8 space-y-4 rounded-xl border border-border bg-surface-2 p-5">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">
			Data endpoints — cursor-paginated
		</h2>
		<p class="text-sm text-ink">
			Besides <code class="text-xs">hotel_id</code>, each takes <code class="text-xs">limit</code>
			(1&ndash;200, default 50), <code class="text-xs">cursor</code> (from the previous page's
			<code class="text-xs">next_cursor</code>), and <code class="text-xs">updated_since</code>
			(an ISO instant, for incremental sync). Response shape:
			<code class="text-xs">{'{ data: [...], next_cursor, standard_version }'}</code>.
		</p>
		{#each listEndpoints as e (e.path)}
			<div class="rounded-lg border border-border p-3">
				<p class="font-mono text-sm text-ink">
					<span class="rounded bg-brand/15 px-1.5 py-0.5 text-xs font-semibold text-brand">{e.method}</span>
					{e.path}
				</p>
				<p class="mt-1 text-sm text-ink-muted">{e.desc}</p>
				<pre class="mt-2 overflow-x-auto rounded-lg bg-ink px-3 py-2 text-xs text-white">{e.shape}</pre>
			</div>
		{/each}
	</section>

	<section class="mb-8 space-y-4 rounded-xl border border-border bg-surface-2 p-5">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">
			Report endpoints — consolidated across hotel_id
		</h2>
		<p class="text-sm text-ink">
			Not paginated &mdash; a full computed report per request. Response shape:
			<code class="text-xs">{'{ data: [...] }'}</code>, one row per item below. Pass multiple
			<code class="text-xs">hotel_id</code> values to get one consolidated report across them
			(<code class="text-xs">income-statement</code> is the one built specifically for this: one
			column per hotel, plus a total).
		</p>
		{#each reportEndpoints as e (e.path)}
			<div class="rounded-lg border border-border p-3">
				<p class="font-mono text-sm text-ink">
					<span class="rounded bg-brand/15 px-1.5 py-0.5 text-xs font-semibold text-brand">{e.method}</span>
					{e.path}
				</p>
				<p class="mt-1 text-sm text-ink-muted">{e.desc}</p>
				{#if e.params.length > 0}
					<ul class="mt-2 space-y-0.5 text-xs text-ink-muted">
						{#each e.params as p (p.name)}
							<li><code class="text-xs text-ink">{p.name}</code> — {p.desc}</li>
						{/each}
					</ul>
				{/if}
				<pre class="mt-2 overflow-x-auto rounded-lg bg-ink px-3 py-2 text-xs text-white">{e.shape}</pre>
			</div>
		{/each}
		<p class="text-xs text-ink-muted">
			Note the field-name mismatch: the three data endpoints above use
			<code class="text-xs">snake_case</code> (the cross-app <code class="text-xs">@mm/integration</code>
			convention); report rows use <code class="text-xs">camelCase</code> (the raw
			<code class="text-xs">@mm/finance-core</code> report shape). Both are stable — just different
			conventions for different reasons.
		</p>
	</section>

	<section class="mb-8 space-y-3 rounded-xl border border-border bg-surface-2 p-5">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">Errors</h2>
		<pre class="overflow-x-auto rounded-lg bg-ink px-3 py-2 text-xs text-white">{`{ "error": { "message": "..." } }`}</pre>
		<p class="text-sm text-ink-muted">
			401 (bad/missing/revoked/expired key), 403 (hotel outside the key's scope), or 400 (a bad
			query param, e.g. an unparseable date).
		</p>
	</section>

	<section class="space-y-3 rounded-xl border border-border bg-surface-2 p-5">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">Worked example</h2>
		<p class="text-sm text-ink">Pull room revenue for September, consolidated across two hotels:</p>
		<pre class="overflow-x-auto rounded-lg bg-ink px-3 py-2 text-xs text-white">{`curl "https://<your-domain>/api/v1/finance/reports/income-statement?hotel_id=<a>&hotel_id=<b>&date_from=2026-09-01&date_to=2026-09-30" \\
  -H "Authorization: Bearer mmhk_live_<...>"`}</pre>
		<p class="text-sm text-ink">Then page through every cash movement since your last sync:</p>
		<pre class="overflow-x-auto rounded-lg bg-ink px-3 py-2 text-xs text-white">{`curl "https://<your-domain>/api/v1/finance/cash-movements?updated_since=2026-09-01T00:00:00Z&limit=200" \\
  -H "Authorization: Bearer mmhk_live_<...>"
# -> follow "next_cursor" as &cursor=<value> until it's null`}</pre>
	</section>
</div>
