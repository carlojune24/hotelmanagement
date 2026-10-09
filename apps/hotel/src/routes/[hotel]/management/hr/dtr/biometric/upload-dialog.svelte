<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { parseWallDateTime, type DateFormat } from '$lib/hr-import';

	type Template = {
		id: string;
		name: string;
		idColumn: number;
		datetimeColumn: number;
		hasHeader: boolean;
		dateFormat: string;
	};

	let {
		open = $bindable(false),
		templates,
		month
	}: { open: boolean; templates: Template[]; month: string } = $props();

	const monthLabel = $derived(
		new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', {
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		})
	);

	const NEW_TEMPLATE = 'new';
	const FORMAT_LABELS: Record<DateFormat, string> = {
		auto: 'Auto-detect',
		ymd: 'Year-month-day',
		mdy: 'Month/day/year',
		dmy: 'Day/month/year'
	};

	let step = $state<'file' | 'map'>('file');
	let busy = $state(false);
	let error = $state('');
	let fileInput: HTMLInputElement | undefined = $state();
	let fileName = $state('');
	let dragging = $state(false);

	let templateId = $state(NEW_TEMPLATE);
	let sample = $state<string[][]>([]);
	let totalRows = $state(0);
	let columnCount = $state(0);
	let roles = $state<Record<number, 'id' | 'datetime'>>({});
	let hasHeader = $state(true);
	let dateFormat = $state<DateFormat>('auto');
	let saveName = $state('');

	const idColumn = $derived(Number(Object.keys(roles).find((k) => roles[Number(k)] === 'id') ?? -1));
	const datetimeColumn = $derived(
		Number(Object.keys(roles).find((k) => roles[Number(k)] === 'datetime') ?? -1)
	);
	const dataRows = $derived(hasHeader ? sample.slice(1) : sample);
	const parsedSample = $derived.by(() => {
		const row = dataRows[0];
		if (!row || idColumn < 0 || datetimeColumn < 0) return null;
		const wall = parseWallDateTime(row[datetimeColumn] ?? '', dateFormat);
		return { id: row[idColumn] ?? '', raw: row[datetimeColumn] ?? '', wall };
	});
	const canImport = $derived(
		idColumn >= 0 && datetimeColumn >= 0 && (parsedSample === null || parsedSample.wall !== null)
	);
	const templateLabel = $derived(
		templateId === NEW_TEMPLATE
			? 'New template (map columns)'
			: (templates.find((t) => t.id === templateId)?.name ?? 'Choose a template')
	);

	$effect(() => {
		if (open) return;
		// Reset once the dialog closes so the next import starts clean.
		step = 'file';
		error = '';
		fileName = '';
		sample = [];
		roles = {};
		saveName = '';
		templateId = templates[0]?.id ?? NEW_TEMPLATE;
		if (fileInput) fileInput.value = '';
	});

	function setRole(col: number, role: string) {
		const next = { ...roles };
		for (const k of Object.keys(next)) {
			if (Number(k) === col || next[Number(k)] === role) delete next[Number(k)];
		}
		if (role === 'id' || role === 'datetime') next[col] = role;
		roles = next;
	}

	function guessMapping() {
		const first = sample[0] ?? [];
		const looksLikeData = first.some((c) => parseWallDateTime(c, dateFormat) !== null);
		hasHeader = !looksLikeData;
		const row = (hasHeader ? sample[1] : sample[0]) ?? [];
		const dt = row.findIndex((c) => parseWallDateTime(c, 'auto') !== null);
		const next: Record<number, 'id' | 'datetime'> = {};
		if (dt >= 0) next[dt] = 'datetime';
		const id = row.findIndex((c, i) => i !== dt && /^\d+(\.0+)?$/.test(c));
		if (id >= 0) next[id] = 'id';
		roles = next;
	}

	function onFile(file: File | undefined) {
		error = '';
		fileName = file?.name ?? '';
	}
	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		const file = e.dataTransfer?.files?.[0];
		if (file && fileInput) {
			const dt = new DataTransfer();
			dt.items.add(file);
			fileInput.files = dt.files;
			onFile(file);
		}
	}

	const submit: SubmitFunction = ({ action, cancel }) => {
		const kind = action.search.replace('?/', '');
		if (kind !== 'importTemplateDelete' && !fileInput?.files?.length) {
			error = 'Choose a file to import.';
			cancel();
			return;
		}
		busy = true;
		error = '';
		return async ({ result }) => {
			busy = false;
			if (result.type === 'failure') {
				error = (result.data?.importError as string) ?? 'Something went wrong.';
				return;
			}
			if (result.type !== 'success' || !result.data) return;
			const data = result.data as Record<string, any>;
			if (data.importStep === 'inspect') {
				sample = data.sample;
				totalRows = data.totalRows;
				columnCount = data.columnCount;
				dateFormat = 'auto';
				guessMapping();
				step = 'map';
			} else if (data.importStep === 'stored') {
				const r = data.result;
					if (data.savedTemplate) toast.success(`Template “${data.savedTemplate.name}” saved.`);
					toast.success(
						r.inserted === 0
							? `Read ${r.total} punches — all already stored, nothing new.`
							: `Read ${r.total} punches · ${r.inserted} new${r.duplicates ? ` · ${r.duplicates} already stored` : ''}.`
					);
					open = false;
					await invalidateAll();
				} else if (data.importStep === 'templateDeleted') {
				toast.success(data.ok);
				templateId = NEW_TEMPLATE;
				await invalidateAll();
			}
		};
	};
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[90vh] w-full flex-col sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title>Upload biometric file · {monthLabel}</Dialog.Title>
			<Dialog.Description>
				Every punch in the file is stored exactly as read, for everyone in it. Nothing is matched to
				employees here.
			</Dialog.Description>
		</Dialog.Header>

		<form
			method="POST"
			enctype="multipart/form-data"
			use:enhance={submit}
			class="flex min-h-0 flex-1 flex-col gap-4"
		>
			<input
				bind:this={fileInput}
				id="importFile"
				name="file"
				type="file"
				accept=".txt,.csv,.xls,.xlsx,.xlsm,.dat"
				class="sr-only"
				onchange={(e) => onFile(e.currentTarget.files?.[0])}
			/>
			<input type="hidden" name="period" value={month} />
			<input
				type="hidden"
				name="templateId"
				value={step === 'map' || templateId === NEW_TEMPLATE ? '' : templateId}
			/>
			{#if step === 'map'}
				<input type="hidden" name="idColumn" value={idColumn} />
				<input type="hidden" name="datetimeColumn" value={datetimeColumn} />
				<input type="hidden" name="hasHeader" value={hasHeader} />
				<input type="hidden" name="dateFormat" value={dateFormat} />
			{/if}

			<div class="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
				{#if error}
					<p
						role="alert"
						class="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
					>
						{error}
					</p>
				{/if}

				{#if step === 'file'}
					<label
						for="importFile"
						ondragover={(e) => {
							e.preventDefault();
							dragging = true;
						}}
						ondragleave={() => (dragging = false)}
						ondrop={onDrop}
						class="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center transition-colors hover:bg-muted/50 {dragging
							? 'bg-muted/50'
							: ''}"
					>
						<UploadIcon class="size-6 text-ink-muted" />
						{#if fileName}
							<span class="text-sm font-medium text-ink">{fileName}</span>
							<span class="text-xs text-ink-muted">Click to choose a different file</span>
						{:else}
							<span class="text-sm font-medium text-ink">Drop the export here or click to choose</span>
							<span class="text-xs text-ink-muted">.txt, .dat, .csv, .xls or .xlsx · up to 5 MB</span>
						{/if}
					</label>

					<div>
						<Label for="importTemplate">Template</Label>
						<Select.Root type="single" bind:value={templateId}>
							<Select.Trigger id="importTemplate" class="mt-1 w-full">{templateLabel}</Select.Trigger>
							<Select.Content>
								<Select.Item value={NEW_TEMPLATE} label="New template (map columns)" />
								{#each templates as t (t.id)}
									<Select.Item value={t.id} label={t.name} />
								{/each}
							</Select.Content>
						</Select.Root>
						<p class="mt-1 text-xs text-ink-muted">
							A template remembers which columns hold the biometric ID and the date/time for one
							device's export.
						</p>
					</div>

					{#if templates.length > 0}
						<ul class="divide-y divide-border rounded-lg border border-border text-sm">
							{#each templates as t (t.id)}
								<li class="flex items-center justify-between gap-2 px-3 py-2">
									<span class="text-ink">{t.name}</span>
									<Button
										type="submit"
										formaction="?/importTemplateDelete"
										name="id"
										value={t.id}
										variant="ghost"
										size="icon"
										aria-label="Delete template {t.name}"
										disabled={busy}
									>
										<Trash2Icon class="size-4" />
									</Button>
								</li>
							{/each}
						</ul>
					{/if}
				{:else}
					<p class="text-sm text-ink-muted">
						Choose which column is the <strong class="text-ink">Biometric ID</strong> and which is the
						<strong class="text-ink">Date/time</strong>. {totalRows} rows in this file.
					</p>
					<div class="overflow-x-auto rounded-lg border border-border">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									{#each { length: columnCount } as _, i (i)}
										<Table.Head class="min-w-36">
											<Select.Root
												type="single"
												value={roles[i] ?? 'none'}
												onValueChange={(v) => setRole(i, v)}
											>
												<Select.Trigger class="w-full" aria-label="Role of column {i + 1}">
													{roles[i] === 'id'
														? 'Biometric ID'
														: roles[i] === 'datetime'
															? 'Date/time'
															: `Column ${i + 1}`}
												</Select.Trigger>
												<Select.Content>
													<Select.Item value="none" label="Ignore" />
													<Select.Item value="id" label="Biometric ID" />
													<Select.Item value="datetime" label="Date/time" />
												</Select.Content>
											</Select.Root>
										</Table.Head>
									{/each}
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each sample as row, r (r)}
									<Table.Row class={hasHeader && r === 0 ? 'bg-muted/40 text-ink-muted' : ''}>
										{#each { length: columnCount } as _, c (c)}
											<Table.Cell
												class={roles[c] ? 'bg-primary/5 font-medium text-ink' : 'text-ink-muted'}
											>
												{row[c] ?? ''}
											</Table.Cell>
										{/each}
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>

					<div class="grid gap-3 sm:grid-cols-2">
						<div class="flex items-center gap-2">
							<Switch id="hasHeader" bind:checked={hasHeader} />
							<Label for="hasHeader">First row is a header</Label>
						</div>
						<div>
							<Label for="dateFormat">Date format</Label>
							<Select.Root type="single" bind:value={dateFormat}>
								<Select.Trigger id="dateFormat" class="mt-1 w-full">
									{FORMAT_LABELS[dateFormat]}
								</Select.Trigger>
								<Select.Content>
									{#each Object.entries(FORMAT_LABELS) as [value, label] (value)}
										<Select.Item {value} {label} />
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					</div>

					<p class="text-sm" aria-live="polite">
						{#if parsedSample === null}
							<span class="text-ink-muted">Pick both columns to see how the first row reads.</span>
						{:else if parsedSample.wall}
							<span class="text-ink-muted">First row reads as</span>
							<span class="font-medium text-ink">
								ID {parsedSample.id} → {parsedSample.wall.date}
								{parsedSample.wall.time.slice(0, 5)}
							</span>
						{:else}
							<span class="text-danger">
								“{parsedSample.raw}” isn't a date/time I can read — check the column or the date
								format.
							</span>
						{/if}
					</p>

					<div>
						<Label for="saveName">Save as template (optional)</Label>
						<Input
							id="saveName"
							name="saveName"
							bind:value={saveName}
							placeholder="e.g. Front office ZKTeco"
							class="mt-1"
						/>
					</div>
				{/if}
			</div>

			<Dialog.Footer class="gap-2">
				{#if step === 'file'}
					<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
					{#if templateId !== NEW_TEMPLATE}
						<Button type="submit" formaction="?/importStore" disabled={busy || !fileName}>
							{busy ? 'Uploading…' : 'Upload'}
						</Button>
					{:else}
						<Button type="submit" formaction="?/importInspect" disabled={busy || !fileName}>
							{busy ? 'Reading…' : 'Continue'}
						</Button>
					{/if}
				{:else}
					<Button type="button" variant="outline" onclick={() => (step = 'file')}>Back</Button>
					<Button type="submit" formaction="?/importStore" disabled={busy || !canImport}>
						{busy ? 'Uploading…' : 'Upload'}
					</Button>
				{/if}
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
