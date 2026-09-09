<script lang="ts">
	import StatementOfAccount from '$lib/components/print/statement-of-account.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const bill = $derived(
		data.statement.receivable.billToCompany || data.statement.receivable.billToName
	);
</script>

<svelte:head>
	<title>Statement of Account — {bill} — {data.statement.statementDate}</title>
</svelte:head>

<StatementOfAccount statement={data.statement} printedAt={data.printedAt} />
