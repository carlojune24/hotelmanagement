<script lang="ts">
	import { page, navigating } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { deserialize, enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import EraserIcon from '@lucide/svelte/icons/eraser';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import SettingsIcon from '@lucide/svelte/icons/settings-2';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import {
		addDays,
		computeRosterWarnings,
		crossesMidnight,
		breakWindowError,
		breakWindowMinutes,
		formatHours,
		netShiftMinutes,
		sameShift,
		timeToMinutes,
		type RosterWarning
	} from '$lib/roster';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Emp = PageData['employees'][number];
	type Template = PageData['templates'][number];
	type Shift = {
		isRestDay: boolean;
		startTime: string | null;
		endTime: string | null;
		breakMinutes: number;
		/** Split shift: the unpaid gap between the two parts. */
		breakStart?: string | null;
		breakEnd?: string | null;
	};
	type Cell = { employeeId: string; date: string };
	type CellState = Cell & { shift: Shift | null };

	const k = (employeeId: string, date: string) => `${employeeId}|${date}`;
	const splitKey = (key: string): Cell => {
		const [employeeId = '', date = ''] = key.split('|');
		return { employeeId, date };
	};

	// ---------------------------------------------------------------------------
	// Roster state: server data + optimistic overlay until the reload lands
	// ---------------------------------------------------------------------------

	/** key → shift, or null meaning "emptied", layered over `data.entries` while a save is in flight. */
	let overlay = $state<Map<string, Shift | null>>(new Map());
	let inFlight = 0;

	const shifts = $derived.by(() => {
		const m = new Map<string, Shift>();
		for (const e of data.entries) {
			m.set(k(e.employeeId, e.date), {
				isRestDay: e.isRestDay,
				startTime: e.startTime,
				endTime: e.endTime,
				breakMinutes: e.breakMinutes,
				breakStart: e.breakStart,
				breakEnd: e.breakEnd
			});
		}
		for (const [key, shift] of overlay) {
			if (shift === null) m.delete(key);
			else m.set(key, shift);
		}
		return m;
	});

	// Rows grouped by department (headers only when there's more than one).
	const groups = $derived.by(() => {
		const byDept = new Map<string, Emp[]>();
		for (const e of data.employees) {
			const d = e.department?.trim() || '';
			byDept.set(d, [...(byDept.get(d) ?? []), e]);
		}
		return [...byDept.entries()]
			.sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
			.map(([name, employees]) => ({ name, employees }));
	});
	const showGroupHeaders = $derived(groups.length > 1);
	const flatEmployees = $derived(groups.flatMap((g) => g.employees));
	const empById = $derived(new Map(data.employees.map((e) => [e.id, e])));

	const warnings = $derived(
		computeRosterWarnings({
			employees: data.employees.map((e) => ({ id: e.id, status: e.status })),
			entries: [...shifts].map(([key, s]) => ({ ...splitKey(key), ...s }))
		})
	);
	const warningsByCell = $derived.by(() => {
		const m = new Map<string, RosterWarning[]>();
		for (const w of warnings) {
			if (w.date === null) continue;
			const key = k(w.employeeId, w.date);
			m.set(key, [...(m.get(key) ?? []), w]);
		}
		return m;
	});
	const weeklyWarning = $derived(
		new Map(warnings.filter((w) => w.kind === 'weekly_hours').map((w) => [w.employeeId, w]))
	);
	const reviewList = $derived(warnings.filter((w) => w.severity === 'review'));

	function weekMinutes(employeeId: string): number {
		let total = 0;
		for (const d of data.days) {
			const s = shifts.get(k(employeeId, d));
			if (s) total += netShiftMinutes(s);
		}
		return total;
	}
	function headcount(date: string): number {
		let n = 0;
		for (const e of data.employees) {
			const s = shifts.get(k(e.id, date));
			if (s && !s.isRestDay) n++;
		}
		return n;
	}

	// ---------------------------------------------------------------------------
	// Formatting
	// ---------------------------------------------------------------------------

	function shortTime(t: string): string {
		const mins = timeToMinutes(t)!;
		const h24 = Math.floor(mins / 60);
		const m = mins % 60;
		const h = h24 % 12 === 0 ? 12 : h24 % 12;
		return `${h}${m ? `:${String(m).padStart(2, '0')}` : ''}${h24 < 12 ? 'a' : 'p'}`;
	}
	const range = (s: Shift) =>
		s.startTime && s.endTime
			? s.breakStart && s.breakEnd
				? `${shortTime(s.startTime)}–${shortTime(s.breakStart)} · ${shortTime(s.breakEnd)}–${shortTime(s.endTime)}`
				: `${shortTime(s.startTime)}–${shortTime(s.endTime)}`
			: '—';
	const dayName = (d: string) =>
		new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
	const dayNum = (d: string) =>
		new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});
	const fullName = (e: Emp) => `${e.firstName} ${e.lastName}`;
	const STATUS_LABEL: Record<string, string> = {
		on_leave: 'On leave',
		suspended: 'Suspended',
		separated: 'Separated'
	};

	const templateShift = (t: Template): Shift => ({
		isRestDay: t.isRestDay,
		startTime: t.startTime,
		endTime: t.endTime,
		breakMinutes: t.breakMinutes,
		breakStart: t.breakStart,
		breakEnd: t.breakEnd
	});
	const matchTemplate = (s: Shift) => data.templates.find((t) => sameShift(templateShift(t), s));

	function tagClass(tag: string | undefined): string {
		switch (tag) {
			case 'brand':
				return 'border-brand/30 bg-brand/10';
			case 'ok':
				return 'border-ok/30 bg-ok/10';
			case 'warning':
				return 'border-warning/40 bg-warning/10';
			default:
				return 'border-border bg-surface-2';
		}
	}
	const tagDot = (tag: string) =>
		tag === 'brand'
			? 'bg-brand'
			: tag === 'ok'
				? 'bg-ok'
				: tag === 'warning'
					? 'bg-warning'
					: 'bg-ink-muted';

	// ---------------------------------------------------------------------------
	// Saving
	// ---------------------------------------------------------------------------

	async function post(action: string, fields: Record<string, string>) {
		const body = new FormData();
		for (const [key, value] of Object.entries(fields)) body.set(key, value);
		const res = await fetch(`?/${action}`, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		});
		return deserialize(await res.text());
	}

	function errorText(result: Awaited<ReturnType<typeof post>>): string {
		return result.type === 'failure' && typeof result.data?.error === 'string'
			? result.data.error
			: 'Could not save. Try again.';
	}

	/** Paints `shift` onto `cells`, or empties them when `shift` is null. Optimistic; reverts on failure. */
	async function commit(cells: Cell[], shift: Shift | null) {
		if (cells.length === 0) return;
		const keys = cells.map((c) => k(c.employeeId, c.date));
		const next = new Map(overlay);
		for (const key of keys) next.set(key, shift);
		overlay = next;
		inFlight++;
		try {
			const result = await post(shift ? 'applyShift' : 'clear', {
				cells: JSON.stringify(cells),
				...(shift ? { shift: JSON.stringify(shift) } : {})
			});
			if (result.type !== 'success') {
				toast.error(errorText(result));
				return;
			}
			const d = result.data as { undo?: CellState[]; applied?: number; cleared?: number };
			await invalidateAll();
			if (d.undo && d.undo.length > 0) {
				const n = shift ? (d.applied ?? cells.length) : (d.cleared ?? d.undo.length);
				announce(
					shift
						? `Updated ${n} day${n === 1 ? '' : 's'}.`
						: `Cleared ${n} day${n === 1 ? '' : 's'}.`,
					d.undo
				);
			}
		} catch {
			toast.error('Could not save. Check your connection and try again.');
		} finally {
			inFlight--;
			// Drop only this commit's optimistic cells; the reloaded data now carries them (or, on
			// failure, the cells simply revert to what the server has).
			const cleaned = new Map(overlay);
			for (const key of keys) cleaned.delete(key);
			overlay = inFlight === 0 ? new Map() : cleaned;
		}
	}

	function announce(message: string, undo: CellState[]) {
		toast(message, {
			duration: 8000,
			action: { label: 'Undo', onClick: () => undoStates(undo) }
		});
	}

	async function undoStates(states: CellState[]) {
		try {
			const result = await post('undo', { states: JSON.stringify(states) });
			if (result.type !== 'success') return void toast.error(errorText(result));
			await invalidateAll();
			toast.success('Undone.');
		} catch {
			toast.error('Could not undo. Check your connection and try again.');
		}
	}

	let copyOpen = $state(false);
	let copyOverwrite = $state(false);
	let copying = $state(false);
	async function copyLastWeek() {
		copying = true;
		try {
			const result = await post('copyWeek', {
				from: addDays(data.weekStart, -7),
				to: data.weekStart,
				overwrite: copyOverwrite ? '1' : '0'
			});
			if (result.type !== 'success') return void toast.error(errorText(result));
			const d = result.data as { copied: number; skipped: number; undo: CellState[] };
			copyOpen = false;
			await invalidateAll();
			const left = d.skipped > 0 ? ` ${d.skipped} already filled, left as they were.` : '';
			if (d.undo.length > 0)
				announce(`Copied ${d.copied} shift${d.copied === 1 ? '' : 's'}.${left}`, d.undo);
			else toast.message(`Nothing to copy.${left}`);
		} catch {
			toast.error('Could not copy. Check your connection and try again.');
		} finally {
			copying = false;
		}
	}

	// ---------------------------------------------------------------------------
	// Interaction: arm a shift and paint, or select cells, or edit one cell
	// ---------------------------------------------------------------------------

	const ERASE = 'erase';
	let armedId = $state<string | null>(null);
	const armedTemplate = $derived(data.templates.find((t) => t.id === armedId) ?? null);
	const isArmed = $derived(armedId !== null);

	let selected = $state<Set<string>>(new Set());
	let anchor = $state<Cell | null>(null);
	let editing = $state<string | null>(null);
	let dragging = $state(false);
	let dragKeys = $state<Set<string>>(new Set());
	let focusKey = $state<string | null>(null);

	const dayIndex = (d: string) => data.days.indexOf(d);
	/** The one cell in the tab order until the user moves focus (roving tabindex). */
	const defaultFocusKey = $derived(
		flatEmployees[0] && data.days[0] ? k(flatEmployees[0].id, data.days[0]) : ''
	);

	function rectangle(from: Cell, to: Cell): Cell[] {
		const r1 = flatEmployees.findIndex((e) => e.id === from.employeeId);
		const r2 = flatEmployees.findIndex((e) => e.id === to.employeeId);
		const c1 = dayIndex(from.date);
		const c2 = dayIndex(to.date);
		if (r1 < 0 || r2 < 0 || c1 < 0 || c2 < 0) return [to];
		const out: Cell[] = [];
		for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
			for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
				const emp = flatEmployees[r];
				const date = data.days[c];
				if (emp && date) out.push({ employeeId: emp.id, date });
			}
		}
		return out;
	}

	function clearSelection() {
		selected = new Set();
	}

	function armedShift(): Shift | null {
		return armedTemplate ? templateShift(armedTemplate) : null; // null with ERASE = clear
	}

	/** A palette chip: applies to a selection if there is one, otherwise arms for painting. */
	function pickChip(id: string) {
		if (selected.size > 0) {
			const cells = [...selected].map(splitKey);
			clearSelection();
			if (id === ERASE) return void commit(cells, null);
			const t = data.templates.find((x) => x.id === id);
			if (t) void commit(cells, templateShift(t));
			return;
		}
		armedId = armedId === id ? null : id;
	}

	function onCellPointerDown(e: PointerEvent, cell: Cell) {
		if (e.button !== 0) return;
		focusKey = k(cell.employeeId, cell.date);
		if (!isArmed) return;
		e.preventDefault(); // keep the drag from selecting text
		(e.currentTarget as HTMLElement).focus();
		dragging = true;
		const cells = e.shiftKey && anchor ? rectangle(anchor, cell) : [cell];
		dragKeys = new Set(cells.map((c) => k(c.employeeId, c.date)));
		anchor = cell;
	}
	function onCellPointerEnter(cell: Cell) {
		if (!dragging) return;
		dragKeys = new Set([...dragKeys, k(cell.employeeId, cell.date)]);
	}
	function endDrag() {
		if (!dragging) return;
		dragging = false;
		const cells = [...dragKeys].map(splitKey);
		dragKeys = new Set();
		if (armedId === ERASE) void commit(cells, null);
		else if (armedTemplate) void commit(cells, templateShift(armedTemplate));
	}

	function onCellClick(e: MouseEvent, cell: Cell) {
		const key = k(cell.employeeId, cell.date);
		focusKey = key;
		if (isArmed) {
			// A mouse click was already painted by the pointer handlers; only the keyboard lands here.
			if (e.detail === 0) {
				if (armedId === ERASE) void commit([cell], null);
				else if (armedTemplate) void commit([cell], templateShift(armedTemplate));
			}
			return;
		}
		if (e.shiftKey && anchor) {
			selected = new Set(rectangle(anchor, cell).map((c) => k(c.employeeId, c.date)));
			editing = null;
			return;
		}
		anchor = cell;
		clearSelection();
		editing = key;
	}

	function focusCell(employeeId: string, date: string) {
		const key = k(employeeId, date);
		focusKey = key;
		document.querySelector<HTMLElement>(`[data-cell="${key}"]`)?.focus();
	}

	function onCellKeydown(e: KeyboardEvent, cell: Cell) {
		const r = flatEmployees.findIndex((x) => x.id === cell.employeeId);
		const c = dayIndex(cell.date);
		const move = (dr: number, dc: number) => {
			e.preventDefault();
			const nr = Math.min(flatEmployees.length - 1, Math.max(0, r + dr));
			const nc = Math.min(data.days.length - 1, Math.max(0, c + dc));
			const target = flatEmployees[nr];
			const day = data.days[nc];
			if (target && day) focusCell(target.id, day);
		};
		const key = k(cell.employeeId, cell.date);
		const targets = () => (selected.has(key) ? [...selected].map(splitKey) : [cell]);
		if (e.key === 'ArrowLeft') move(0, -1);
		else if (e.key === 'ArrowRight') move(0, 1);
		else if (e.key === 'ArrowUp') move(-1, 0);
		else if (e.key === 'ArrowDown') move(1, 0);
		else if (e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault();
			const cells = targets();
			clearSelection();
			void commit(cells, null);
		} else if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
			const t = data.templates[Number(e.key) - 1];
			if (t) {
				e.preventDefault();
				const cells = targets();
				clearSelection();
				void commit(cells, templateShift(t));
			}
		}
	}

	function onWindowKeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (editing) return; // the popover handles its own Escape
		armedId = null;
		clearSelection();
		dragging = false;
		dragKeys = new Set();
	}

	// Custom-hours editor inside the cell popover
	let customStart = $state('09:00');
	let customEnd = $state('17:00');
	let customBreak = $state(60);
	let customSplit = $state(false);
	let customBreakStart = $state('12:00');
	let customBreakEnd = $state('13:00');
	$effect(() => {
		if (!editing) return;
		const s = shifts.get(editing);
		if (s && !s.isRestDay && s.startTime && s.endTime) {
			customStart = s.startTime;
			customEnd = s.endTime;
			customBreak = s.breakMinutes;
			customSplit = Boolean(s.breakStart && s.breakEnd);
			if (s.breakStart && s.breakEnd) {
				customBreakStart = s.breakStart;
				customBreakEnd = s.breakEnd;
			}
		} else {
			customSplit = false;
		}
	});
	/** Seeds the break window with the usual noon hour, or the middle of the shift if that falls outside it. */
	function suggestBreak(start: string, end: string): [string, string] {
		const noonFits = breakWindowError(start, end, '12:00', '13:00') === null;
		if (noonFits) return ['12:00', '13:00'];
		const s = timeToMinutes(start) ?? 0;
		const e = timeToMinutes(end) ?? 0;
		const mid = Math.floor((s + e) / 2 / 5) * 5;
		const hhmm = (m: number) =>
			`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
		return [hhmm(mid - 30), hhmm(mid + 30)];
	}
	function startCustomSplit() {
		[customBreakStart, customBreakEnd] = suggestBreak(customStart, customEnd);
		customSplit = true;
	}
	const customSplitError = $derived(
		customSplit ? breakWindowError(customStart, customEnd, customBreakStart, customBreakEnd) : null
	);

	function applyFromPopover(cell: Cell, shift: Shift | null) {
		editing = null;
		void commit([cell], shift);
		focusCell(cell.employeeId, cell.date);
	}
	function applyCustom(cell: Cell) {
		if (!customStart || !customEnd || customStart === customEnd) {
			toast.error('Enter a start and end time that differ.');
			return;
		}
		if (customSplit) {
			if (customSplitError) {
				toast.error(customSplitError);
				return;
			}
			applyFromPopover(cell, {
				isRestDay: false,
				startTime: customStart,
				endTime: customEnd,
				breakMinutes: breakWindowMinutes(customBreakStart, customBreakEnd),
				breakStart: customBreakStart,
				breakEnd: customBreakEnd
			});
			return;
		}
		applyFromPopover(cell, {
			isRestDay: false,
			startTime: customStart,
			endTime: customEnd,
			breakMinutes: Number(customBreak) || 0
		});
	}

	// ---------------------------------------------------------------------------
	// Week navigation
	// ---------------------------------------------------------------------------

	function toWeek(start: string) {
		armedId = null;
		clearSelection();
		void goto(`?week=${start}`, { noScroll: true, keepFocus: true });
	}
	const isThisWeek = $derived(data.days.includes(data.today));

	/** Opens the printable roster for the week on screen (a month uses its Thursday, so a week
	 *  straddling two months prints the month most of it falls in). */
	function openPrint(view: 'week' | 'month' | 'employee', period?: 'week' | 'month') {
		const date = view === 'week' ? data.weekStart : (data.days[3] ?? data.weekStart);
		const q = new URLSearchParams({ view, date });
		if (view === 'employee' && period) q.set('period', period);
		window.open(`/${page.params.hotel}/print/schedule?${q}`, '_blank');
	}

	// ---------------------------------------------------------------------------
	// Review list + shift (template) manager
	// ---------------------------------------------------------------------------

	let reviewOpen = $state(false);
	function goToWarning(w: RosterWarning) {
		const date = w.date ?? data.days[0];
		if (date) focusCell(w.employeeId, date);
	}

	let manageOpen = $state(false);
	type TplDraft = {
		id: string | null;
		name: string;
		isRestDay: boolean;
		startTime: string;
		endTime: string;
		breakMinutes: number;
		split: boolean;
		breakStart: string;
		breakEnd: string;
		tag: string;
	};
	const blankDraft = (): TplDraft => ({
		id: null,
		name: '',
		isRestDay: false,
		startTime: '09:00',
		endTime: '17:00',
		breakMinutes: 60,
		split: false,
		breakStart: '12:00',
		breakEnd: '13:00',
		tag: 'neutral'
	});
	let draft = $state<TplDraft>(blankDraft());
	const editTemplate = (t: Template) =>
		(draft = {
			id: t.id,
			name: t.name,
			isRestDay: t.isRestDay,
			startTime: t.startTime ?? '09:00',
			endTime: t.endTime ?? '17:00',
			breakMinutes: t.breakMinutes,
			split: Boolean(t.breakStart && t.breakEnd),
			breakStart: t.breakStart ?? '12:00',
			breakEnd: t.breakEnd ?? '13:00',
			tag: t.tag
		});
	function startDraftSplit() {
		[draft.breakStart, draft.breakEnd] = suggestBreak(draft.startTime, draft.endTime);
		draft.split = true;
	}
	const draftSplitError = $derived(
		draft.split && !draft.isRestDay
			? breakWindowError(draft.startTime, draft.endTime, draft.breakStart, draft.breakEnd)
			: null
	);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.templateOk) {
			toast.success(form.templateOk);
			draft = blankDraft();
		}
	});
	// A deleted template can't stay armed.
	$effect(() => {
		if (armedId && armedId !== ERASE && !armedTemplate) armedId = null;
	});

	const TAGS = [
		{ value: 'neutral', label: 'Plain' },
		{ value: 'brand', label: 'Brand' },
		{ value: 'ok', label: 'Green' },
		{ value: 'warning', label: 'Amber' }
	];
</script>

<svelte:window onpointerup={endDrag} onkeydown={onWindowKeydown} />

<div class="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6">
	<!-- Header -->
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h2 class="text-base font-semibold text-ink">Schedule</h2>
			<p class="text-sm text-ink-muted tabular-nums">
				{dayNum(data.weekStart)} – {dayNum(data.weekEnd)}
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			{#if reviewList.length > 0}
				<Button
					variant="outline"
					size="sm"
					class="gap-1.5 text-warning"
					aria-expanded={reviewOpen}
					onclick={() => (reviewOpen = !reviewOpen)}
				>
					<TriangleAlertIcon class="size-4" />
					{reviewList.length} to review
				</Button>
			{/if}
			<Button
				variant="outline"
				size="icon"
				onclick={() => toWeek(addDays(data.weekStart, -7))}
				aria-label="Previous week"
			>
				<ChevronLeftIcon class="size-4" />
			</Button>
			<Button
				variant="outline"
				size="sm"
				disabled={isThisWeek}
				onclick={() => goto(page.url.pathname, { noScroll: true })}
			>
				Today
			</Button>
			<Button
				variant="outline"
				size="icon"
				onclick={() => toWeek(addDays(data.weekStart, 7))}
				aria-label="Next week"
			>
				<ChevronRightIcon class="size-4" />
			</Button>
		</div>
	</div>

	{#if reviewOpen && reviewList.length > 0}
		<ul
			class="mt-3 divide-y divide-border rounded-lg border border-warning/40 bg-warning/5 text-sm"
		>
			{#each reviewList as w, i (i)}
				{@const emp = empById.get(w.employeeId)}
				<li class="flex items-center justify-between gap-3 px-3 py-2">
					<span class="text-ink">
						<span class="font-medium">{emp ? fullName(emp) : 'Employee'}</span>
						{#if w.date}<span class="text-ink-muted">
								· {dayName(w.date)} {dayNum(w.date)}</span
							>{/if}
						— {w.message}
					</span>
					<Button variant="ghost" size="sm" onclick={() => goToWarning(w)}>Go to</Button>
				</li>
			{/each}
		</ul>
	{/if}

	<!-- Toolbar: shift palette -->
	<div
		class="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2.5"
	>
		{#if data.templates.length === 0}
			<p class="text-sm text-ink-muted">
				No shifts set up yet. Shifts are the quick way to fill a week.
			</p>
			<form method="POST" action="?/addStarterTemplates" use:enhance>
				<Button type="submit" size="sm" variant="outline" class="gap-1.5">
					<PlusIcon class="size-4" /> Add Morning, Afternoon, Night &amp; Rest day
				</Button>
			</form>
		{:else}
			<span class="text-xs font-semibold tracking-wide text-ink-muted uppercase">
				{selected.size > 0
					? `${selected.size} day${selected.size === 1 ? '' : 's'} selected — pick a shift`
					: 'Shift'}
			</span>
			{#each data.templates as t, i (t.id)}
				<button
					type="button"
					aria-pressed={armedId === t.id}
					onclick={() => pickChip(t.id)}
					class="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm text-ink transition-colors {tagClass(
						t.tag
					)} {armedId === t.id ? 'ring-2 ring-brand ring-offset-1' : 'hover:border-ink-muted'}"
				>
					<span class="size-2 rounded-full {tagDot(t.tag)}"></span>
					<span class="font-medium">{t.name}</span>
					{#if !t.isRestDay && t.startTime && t.endTime}
						<span class="text-xs text-ink-muted tabular-nums">{range(templateShift(t))}</span>
					{/if}
					{#if i < 9}<kbd class="hidden text-[10px] text-ink-muted sm:inline">{i + 1}</kbd>{/if}
				</button>
			{/each}
			<button
				type="button"
				aria-pressed={armedId === ERASE}
				onclick={() => pickChip(ERASE)}
				class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm text-ink transition-colors {armedId ===
				ERASE
					? 'ring-2 ring-brand ring-offset-1'
					: 'hover:border-ink-muted'}"
			>
				<EraserIcon class="size-3.5" /> Erase
			</button>
			{#if selected.size > 0}
				<Button variant="ghost" size="sm" onclick={clearSelection}>Cancel selection</Button>
			{/if}
		{/if}

		<div class="ml-auto flex items-center gap-2">
			<Popover.Root bind:open={copyOpen}>
				<Popover.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							size="sm"
							class="gap-1.5"
							disabled={data.previousWeekShiftCount === 0}
						>
							<CopyIcon class="size-4" /> Copy last week
						</Button>
					{/snippet}
				</Popover.Trigger>
				<Popover.Content align="end" class="w-72 space-y-3">
					<p class="text-sm text-ink">
						Copy the {data.previousWeekShiftCount} shift{data.previousWeekShiftCount === 1
							? ''
							: 's'} from
						{dayNum(addDays(data.weekStart, -7))} into this week.
					</p>
					<label class="flex items-start gap-2 text-sm text-ink">
						<input type="checkbox" bind:checked={copyOverwrite} class="mt-0.5 size-4" />
						<span
							>Replace days that already have a shift<br /><span class="text-xs text-ink-muted"
								>Otherwise they're left as they are.</span
							></span
						>
					</label>
					<div class="flex justify-end gap-2">
						<Button variant="ghost" size="sm" onclick={() => (copyOpen = false)}>Cancel</Button>
						<Button size="sm" disabled={copying} onclick={copyLastWeek}
							>{copying ? 'Copying…' : 'Copy'}</Button
						>
					</div>
				</Popover.Content>
			</Popover.Root>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button {...props} variant="outline" size="sm" class="gap-1.5">
							<PrinterIcon class="size-4" /> Print
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="w-60">
					<DropdownMenu.Label>Print schedule</DropdownMenu.Label>
					<DropdownMenu.Separator />
					<DropdownMenu.Item onSelect={() => openPrint('week')}>Week — everyone</DropdownMenu.Item>
					<DropdownMenu.Item onSelect={() => openPrint('month')}>
						Month — everyone
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
					<DropdownMenu.Item onSelect={() => openPrint('employee', 'week')}>
						By employee — this week
					</DropdownMenu.Item>
					<DropdownMenu.Item onSelect={() => openPrint('employee', 'month')}>
						By employee — this month
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<Button variant="outline" size="sm" class="gap-1.5" onclick={() => (manageOpen = true)}>
				<SettingsIcon class="size-4" /> Manage shifts
			</Button>
		</div>
	</div>

	{#if isArmed}
		<p class="mt-2 text-xs text-ink-muted" role="status">
			{armedId === ERASE ? 'Erase is on' : `${armedTemplate?.name} is on`} — click or drag across days.
			Shift-click extends from the last day. Esc to stop.
		</p>
	{/if}

	<!-- Grid -->
	<div
		class="mt-3 overflow-auto rounded-xl border border-border bg-surface"
		aria-busy={!!navigating.to}
	>
		{#if data.employees.length === 0}
			<div class="flex flex-col items-center gap-2 p-10 text-center">
				<CalendarDaysIcon class="size-6 text-ink-muted" />
				<p class="text-sm text-ink-muted">Add employees first — the roster is built from them.</p>
				<Button
					variant="outline"
					size="sm"
					href="{page.url.pathname.replace(/\/schedule$/, '')}/employees">Go to Employees</Button
				>
			</div>
		{:else}
			<table class="w-full min-w-[60rem] border-separate border-spacing-0 text-sm select-none">
				<thead>
					<tr>
						<th
							scope="col"
							class="sticky left-0 z-20 w-52 border-b border-r border-border bg-surface-2 px-3 py-2 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase"
						>
							Employee
						</th>
						{#each data.days as d (d)}
							<th
								scope="col"
								aria-current={d === data.today ? 'date' : undefined}
								class="border-b border-r border-border px-2 py-2 text-left text-xs font-semibold {d ===
								data.today
									? 'bg-brand/10 text-brand'
									: 'bg-surface-2 text-ink-muted'}"
							>
								<span class="uppercase">{dayName(d)}</span>
								<span class="ml-1 font-normal tabular-nums">{dayNum(d)}</span>
							</th>
						{/each}
						<th
							scope="col"
							class="w-24 border-b border-border bg-surface-2 px-3 py-2 text-right text-xs font-semibold tracking-wide text-ink-muted uppercase"
						>
							Week
						</th>
					</tr>
				</thead>
				<tbody>
					{#if navigating.to}
						{#each Array(6) as _, i (i)}
							<tr>
								<td class="sticky left-0 border-b border-r border-border bg-surface px-3 py-3"
									><Skeleton class="h-4 w-32" /></td
								>
								{#each data.days as d (d)}
									<td class="border-b border-r border-border p-1.5"
										><Skeleton class="h-11 w-full" /></td
									>
								{/each}
								<td class="border-b border-border px-3 py-3"
									><Skeleton class="ml-auto h-4 w-10" /></td
								>
							</tr>
						{/each}
					{:else}
						{#each groups as g (g.name)}
							{#if showGroupHeaders}
								<tr>
									<th
										scope="rowgroup"
										colspan={data.days.length + 2}
										class="sticky left-0 border-b border-border bg-surface-2 px-3 py-1.5 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase"
									>
										{g.name || 'No department'}
									</th>
								</tr>
							{/if}
							{#each g.employees as emp (emp.id)}
								{@const mins = weekMinutes(emp.id)}
								{@const wk = weeklyWarning.get(emp.id)}
								<tr>
									<th
										scope="row"
										class="sticky left-0 z-10 border-b border-r border-border bg-surface px-3 py-1.5 text-left font-normal"
									>
										<div class="flex items-center gap-2">
											<span class="truncate font-medium text-ink">{fullName(emp)}</span>
											{#if STATUS_LABEL[emp.status]}
												<Badge variant="outline" class="shrink-0 text-[10px]"
													>{STATUS_LABEL[emp.status]}</Badge
												>
											{/if}
										</div>
										<div class="truncate text-xs text-ink-muted">{emp.position}</div>
									</th>
									{#each data.days as d (d)}
										{@const key = k(emp.id, d)}
										{@const cell = { employeeId: emp.id, date: d }}
										{@const s = shifts.get(key)}
										{@const tpl = s ? matchTemplate(s) : undefined}
										{@const cellWarnings = warningsByCell.get(key) ?? []}
										{@const isSel = selected.has(key) || dragKeys.has(key)}
										<td
											class="border-b border-r border-border p-1 {d === data.today
												? 'bg-brand/5'
												: ''}"
										>
											{#snippet cellButton(extra: Record<string, unknown>)}
												<button
													{...extra}
													type="button"
													data-cell={key}
													tabindex={(focusKey ?? defaultFocusKey) === key ? 0 : -1}
													aria-label="{fullName(emp)}, {dayName(d)} {dayNum(d)}: {s
														? s.isRestDay
															? 'rest day'
															: `${tpl ? tpl.name + ', ' : ''}${range(s)}`
														: 'no shift'}{cellWarnings.length
														? '. ' + cellWarnings.map((w) => w.message).join(' ')
														: ''}"
													onpointerdown={(e) => onCellPointerDown(e, cell)}
													onpointerenter={() => onCellPointerEnter(cell)}
													onclick={(e) => onCellClick(e, cell)}
													onkeydown={(e) => onCellKeydown(e, cell)}
													class="group relative flex h-11 w-full min-w-28 flex-col items-start justify-center rounded-md border px-2 text-left leading-tight transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none {s
														? s.isRestDay
															? 'border-transparent text-ink-muted'
															: tagClass(tpl?.tag)
														: 'border-dashed border-border/70 hover:border-ink-muted'} {isSel
														? 'ring-2 ring-brand ring-inset'
														: ''} {isArmed ? 'cursor-crosshair' : 'cursor-pointer'}"
												>
													{#if s}
														{#if s.isRestDay}
															<span class="text-xs">Rest</span>
														{:else}
															{#if tpl}<span class="text-xs font-medium text-ink">{tpl.name}</span
																>{/if}
															<span
																class="text-ink-muted tabular-nums {tpl
																	? 'text-[11px]'
																	: 'text-xs text-ink'}">{range(s)}</span
															>
														{/if}
													{:else}
														<PlusIcon
															class="size-3.5 text-ink-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
														/>
													{/if}
													{#if cellWarnings.length > 0}
														<span
															class="absolute top-1 right-1 flex gap-0.5"
															title={cellWarnings.map((w) => w.message).join(' ')}
														>
															{#if cellWarnings.some((w) => w.severity === 'review')}
																<TriangleAlertIcon class="size-3.5 text-warning" />
															{/if}
															{#if cellWarnings.some((w) => w.kind === 'overnight')}
																<MoonIcon class="size-3.5 text-ink-muted" />
															{/if}
														</span>
													{/if}
												</button>
											{/snippet}

											{#if editing === key}
												<Popover.Root
													open
													onOpenChange={(o) => {
														if (!o) editing = null;
													}}
												>
													<Popover.Trigger>
														{#snippet child({ props })}
															{@render cellButton(props)}
														{/snippet}
													</Popover.Trigger>
													<Popover.Content align="start" class="w-72 space-y-3 p-3">
														<div>
															<p class="text-sm font-medium text-ink">{fullName(emp)}</p>
															<p class="text-xs text-ink-muted">{dayName(d)} {dayNum(d)}</p>
														</div>
														{#if cellWarnings.length > 0}
															<ul class="space-y-1 text-xs text-warning">
																{#each cellWarnings as w, wi (wi)}<li>{w.message}</li>{/each}
															</ul>
														{/if}
														{#if data.templates.length > 0}
															<div class="flex flex-wrap gap-1.5">
																{#each data.templates as t (t.id)}
																	<button
																		type="button"
																		onclick={() => applyFromPopover(cell, templateShift(t))}
																		class="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs text-ink hover:border-ink-muted {tagClass(
																			t.tag
																		)}"
																	>
																		<span class="size-1.5 rounded-full {tagDot(t.tag)}"></span>
																		{t.name}
																	</button>
																{/each}
															</div>
														{/if}
														<div class="space-y-2 border-t border-border pt-3">
															<p
																class="text-xs font-semibold tracking-wide text-ink-muted uppercase"
															>
																Custom hours
															</p>
															{#if customSplit}
																<div class="space-y-2">
																	<div>
																		<p class="text-xs font-medium text-ink">First part</p>
																		<div class="mt-1 grid grid-cols-2 gap-2">
																			<div>
																				<Label for="cs" class="text-xs text-ink-muted">Start</Label>
																				<Input id="cs" type="time" bind:value={customStart} class="mt-1 h-8 px-2 text-sm" />
																			</div>
																			<div>
																				<Label for="cbs" class="text-xs text-ink-muted">End</Label>
																				<Input id="cbs" type="time" bind:value={customBreakStart} class="mt-1 h-8 px-2 text-sm" />
																			</div>
																		</div>
																	</div>
																	<div>
																		<p class="text-xs font-medium text-ink">Second part</p>
																		<div class="mt-1 grid grid-cols-2 gap-2">
																			<div>
																				<Label for="cbe" class="text-xs text-ink-muted">Start</Label>
																				<Input id="cbe" type="time" bind:value={customBreakEnd} class="mt-1 h-8 px-2 text-sm" />
																			</div>
																			<div>
																				<Label for="ce" class="text-xs text-ink-muted">End</Label>
																				<Input id="ce" type="time" bind:value={customEnd} class="mt-1 h-8 px-2 text-sm" />
																			</div>
																		</div>
																	</div>
																	<div class="flex items-center justify-between gap-2">
																		<p class="text-xs tabular-nums {customSplitError ? 'text-danger' : 'text-ink-muted'}" aria-live="polite">
																			{customSplitError ?? `Break ${formatHours(breakWindowMinutes(customBreakStart, customBreakEnd))}, unpaid`}
																		</p>
																		<Button type="button" variant="ghost" size="sm" class="h-7 px-2" onclick={() => (customSplit = false)}>
																			<XIcon class="size-3.5" /> Single
																		</Button>
																	</div>
																</div>
															{:else}
																<div class="grid grid-cols-3 gap-2">
																	<div>
																		<Label for="cs" class="text-xs">Start</Label>
																		<Input id="cs" type="time" bind:value={customStart} class="mt-1 h-8 px-2 text-sm" />
																	</div>
																	<div>
																		<Label for="ce" class="text-xs">End</Label>
																		<Input id="ce" type="time" bind:value={customEnd} class="mt-1 h-8 px-2 text-sm" />
																	</div>
																	<div>
																		<Label for="cb" class="text-xs">Break (m)</Label>
																		<Input id="cb" type="number" min="0" max="600" bind:value={customBreak} class="mt-1 h-8 px-2 text-sm" />
																	</div>
																</div>
																{#if crossesMidnight(customStart, customEnd)}
																	<p class="text-xs text-ink-muted">Ends the next day.</p>
																{:else}
																	<Button type="button" variant="ghost" size="sm" class="h-7 px-2" onclick={() => startCustomSplit()}>
																		<PlusIcon class="size-3.5" /> Add second part
																	</Button>
																{/if}
															{/if}
														</div>
														<div class="flex items-center justify-between gap-2">
															<div class="flex gap-1.5">
																<Button
																	size="sm"
																	variant="outline"
																	onclick={() =>
																		applyFromPopover(cell, {
																			isRestDay: true,
																			startTime: null,
																			endTime: null,
																			breakMinutes: 0
																		})}>Rest day</Button
																>
																{#if s}
																	<Button
																		size="sm"
																		variant="ghost"
																		class="text-danger"
																		onclick={() => applyFromPopover(cell, null)}>Clear</Button
																	>
																{/if}
															</div>
															<Button size="sm" onclick={() => applyCustom(cell)}>Apply</Button>
														</div>
													</Popover.Content>
												</Popover.Root>
											{:else}
												{@render cellButton({})}
											{/if}
										</td>
									{/each}
									<td
										class="border-b border-border px-3 text-right tabular-nums {wk
											? 'font-semibold text-warning'
											: 'text-ink'}"
										title={wk?.message}
									>
										<span class="inline-flex items-center gap-1">
											{#if wk}<TriangleAlertIcon class="size-3.5" />{/if}
											{mins > 0 ? formatHours(mins) : '—'}
										</span>
									</td>
								</tr>
							{/each}
						{/each}
					{/if}
				</tbody>
				{#if !navigating.to}
					<tfoot>
						<tr>
							<th
								scope="row"
								class="sticky left-0 z-10 border-r border-border bg-surface-2 px-3 py-2 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase"
							>
								On duty
							</th>
							{#each data.days as d (d)}
								<td
									class="border-r border-border bg-surface-2 px-3 py-2 text-sm font-semibold text-ink tabular-nums"
									>{headcount(d)}</td
								>
							{/each}
							<td class="bg-surface-2"></td>
						</tr>
					</tfoot>
				{/if}
			</table>
		{/if}
	</div>
	<p class="mt-2 text-xs text-ink-muted">
		Click a day to set its shift. Arrow keys move, <kbd>1</kbd>–<kbd>9</kbd> apply a shift,
		<kbd>Delete</kbd> clears.
	</p>
</div>

<!-- Manage shifts -->
<Sheet.Root bind:open={manageOpen}>
	<Sheet.Content side="right" class="w-full overflow-y-auto sm:max-w-md">
		<Sheet.Header>
			<Sheet.Title>Shifts</Sheet.Title>
			<Sheet.Description>
				Editing or removing a shift never changes a roster already built from it.
			</Sheet.Description>
		</Sheet.Header>

		<div class="space-y-4 px-4 pb-4">
			{#if data.templates.length > 0}
				<ul class="divide-y divide-border rounded-lg border border-border">
					{#each data.templates as t (t.id)}
						<li class="flex items-center justify-between gap-2 px-3 py-2">
							<div class="flex min-w-0 items-center gap-2">
								<span class="size-2 shrink-0 rounded-full {tagDot(t.tag)}"></span>
								<div class="min-w-0">
									<p class="truncate text-sm font-medium text-ink">{t.name}</p>
									<p class="text-xs text-ink-muted tabular-nums">
										{t.isRestDay
											? 'Rest day'
											: `${range(templateShift(t))}${t.breakMinutes ? ` · ${t.breakMinutes}m break` : ''}`}
									</p>
								</div>
							</div>
							<div class="flex shrink-0 gap-1">
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="Edit {t.name}"
									onclick={() => editTemplate(t)}
								>
									<PencilIcon class="size-4" />
								</Button>
								<form method="POST" action="?/deleteTemplate" use:enhance>
									<input type="hidden" name="id" value={t.id} />
									<Button
										type="submit"
										variant="ghost"
										size="icon-sm"
										class="text-danger"
										aria-label="Remove {t.name}"
									>
										<Trash2Icon class="size-4" />
									</Button>
								</form>
							</div>
						</li>
					{/each}
				</ul>
			{/if}

			{#key draft.id ?? 'new'}
				<form
					method="POST"
					action="?/saveTemplate"
					use:enhance
					class="space-y-3 rounded-lg border border-border p-3"
				>
					<div class="flex items-center justify-between">
						<h3 class="text-sm font-semibold text-ink">{draft.id ? 'Edit shift' : 'New shift'}</h3>
						{#if draft.id}
							<Button
								type="button"
								variant="ghost"
								size="sm"
								class="gap-1"
								onclick={() => (draft = blankDraft())}
							>
								<XIcon class="size-3.5" /> Cancel
							</Button>
						{/if}
					</div>
					<input type="hidden" name="id" value={draft.id ?? ''} />
					<div>
						<Label for="tplName">Name</Label>
						<Input
							id="tplName"
							name="name"
							required
							maxlength={40}
							bind:value={draft.name}
							class="mt-1"
							placeholder="e.g. Morning"
						/>
					</div>
					<label class="flex items-center gap-2 text-sm text-ink">
						<input type="checkbox" name="isRestDay" bind:checked={draft.isRestDay} class="size-4" />
						Rest day
					</label>
					{#if !draft.isRestDay}
						{#if draft.split}
							<div class="space-y-3">
								<div>
									<p class="text-sm font-medium text-ink">First part</p>
									<div class="mt-1 grid grid-cols-2 gap-2">
										<div>
											<Label for="tplStart" class="text-xs text-ink-muted">Start</Label>
											<Input id="tplStart" name="startTime" type="time" required bind:value={draft.startTime} class="mt-1" />
										</div>
										<div>
											<Label for="tplBreakStart" class="text-xs text-ink-muted">End</Label>
											<Input id="tplBreakStart" name="breakStart" type="time" required bind:value={draft.breakStart} class="mt-1" />
										</div>
									</div>
								</div>
								<div>
									<p class="text-sm font-medium text-ink">Second part</p>
									<div class="mt-1 grid grid-cols-2 gap-2">
										<div>
											<Label for="tplBreakEnd" class="text-xs text-ink-muted">Start</Label>
											<Input id="tplBreakEnd" name="breakEnd" type="time" required bind:value={draft.breakEnd} class="mt-1" />
										</div>
										<div>
											<Label for="tplEnd" class="text-xs text-ink-muted">End</Label>
											<Input id="tplEnd" name="endTime" type="time" required bind:value={draft.endTime} class="mt-1" />
										</div>
									</div>
								</div>
								<div class="flex items-center justify-between gap-2">
									<p class="text-xs tabular-nums {draftSplitError ? 'text-danger' : 'text-ink-muted'}" aria-live="polite">
										{draftSplitError ?? `Break ${formatHours(breakWindowMinutes(draft.breakStart, draft.breakEnd))} (${draft.breakStart}\u2013${draft.breakEnd}), unpaid`}
									</p>
									<Button type="button" variant="ghost" size="sm" onclick={() => (draft.split = false)}>
										<XIcon class="size-3.5" /> Single shift
									</Button>
								</div>
							</div>
						{:else}
							<div class="grid grid-cols-3 gap-2">
								<div>
									<Label for="tplStart">Start</Label>
									<Input id="tplStart" name="startTime" type="time" required bind:value={draft.startTime} class="mt-1" />
								</div>
								<div>
									<Label for="tplEnd">End</Label>
									<Input id="tplEnd" name="endTime" type="time" required bind:value={draft.endTime} class="mt-1" />
								</div>
								<div>
									<Label for="tplBreak">Break (m)</Label>
									<Input id="tplBreak" name="breakMinutes" type="number" min="0" max="600" bind:value={draft.breakMinutes} class="mt-1" />
								</div>
							</div>
							{#if crossesMidnight(draft.startTime, draft.endTime)}
								<p class="text-xs text-ink-muted">Ends the next day.</p>
							{:else}
								<Button type="button" variant="ghost" size="sm" onclick={() => startDraftSplit()}>
									<PlusIcon class="size-3.5" /> Add second part
								</Button>
							{/if}
						{/if}
					{/if}
					<fieldset>
						<legend class="mb-1 text-sm font-medium text-ink">Colour</legend>
						<div class="flex flex-wrap gap-2">
							{#each TAGS as t (t.value)}
								<label class="cursor-pointer">
									<input
										type="radio"
										name="tag"
										value={t.value}
										bind:group={draft.tag}
										class="peer sr-only"
									/>
									<span
										class="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm text-ink peer-checked:ring-2 peer-checked:ring-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand {tagClass(
											t.value
										)}"
									>
										<span class="size-2 rounded-full {tagDot(t.value)}"></span>{t.label}
									</span>
								</label>
							{/each}
						</div>
					</fieldset>
					<Button type="submit" class="w-full">{draft.id ? 'Save changes' : 'Add shift'}</Button>
				</form>
			{/key}

			{#if data.templates.length === 0}
				<form method="POST" action="?/addStarterTemplates" use:enhance>
					<Button type="submit" variant="outline" class="w-full">Add the starter set instead</Button
					>
				</form>
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>
