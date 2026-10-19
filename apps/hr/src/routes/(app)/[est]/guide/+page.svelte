<script lang="ts">
	import ChevronIcon from '@lucide/svelte/icons/chevron-right';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { GROUP_TITLES, SCENARIOS, SCHEDULES, evaluate, type Scenario } from '$lib/dtr-scenarios';

	const hm = (m: number) => {
		if (m === 0) return '0';
		const h = Math.floor(m / 60);
		const r = m % 60;
		return h === 0 ? `${r}m` : r === 0 ? `${h}h` : `${h}h ${r}m`;
	};
	/** `13:05` / `02:00+1` → `1:05 PM` / `2:00 AM (+1)` */
	const clock = (t: string) => {
		const next = t.endsWith('+1');
		const [h = 0, m = 0] = (next ? t.slice(0, -2) : t).split(':').map(Number);
		const hh = h % 12 === 0 ? 12 : h % 12;
		return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}${next ? ' (+1)' : ''}`;
	};
	const PAY: Record<string, string> = {
		full: 'Paid in full',
		late_undertime: 'Late / undertime deducted',
		absent: 'Day deducted',
		covered: 'Covered by leave / holiday',
		none: 'Nothing to pay or deduct'
	};

	const groups = (Object.keys(GROUP_TITLES) as Scenario['group'][]).map((g) => ({
		key: g,
		...GROUP_TITLES[g],
		items: SCENARIOS.filter((s) => s.group === g).map((sc) => ({ sc, r: evaluate(sc) }))
	}));

	const RULES: Array<[string, string]> = [
		['The punches', 'The first punch of the day is "in" and the last is "out". On a split shift the punches in between are read by where they fall: before the middle of the break is a break-out, then a break-in; one an hour or more after coming back is the clock-out. Two taps within 2 minutes are one punch. A long day with only in and out taps (up to 16h) stays one shift; a silence that ends at the next rostered start begins a new one, so overtime until 9 PM and an 8 AM clock-in are two days.'],
		['The break', 'The unpaid break is only taken off time that actually spans it. Arriving after lunch, or leaving before it, costs no break. On a schedule with a break window the break has to be punched. No break-out: the morning cannot be proven, so the whole first part is undertime. No break-in: the afternoon cannot be proven, so the whole second part is late. Neither: the day is absent. HR can add the missing tap to restore the time.'],
		['Late and undertime', 'Late = minutes after the scheduled start (and after returning late from lunch). Undertime = minutes before the scheduled end. Neither includes the unpaid break, so worked + late + undertime always equals the paid day.'],
		['Missing punches', 'One lone punch is never "late": worked is 0 and the rostered day is treated as absent until HR adds the missing punch. After lunch with no clock-out, only the morning is paid and the afternoon is undertime. Every case is flagged so it shows in the remarks.'],
		['Overtime', 'Only time punched after the scheduled end, and only the part an approved application covers, is paid. The rest is flagged as unapproved and not paid. Time before the shift is not overtime.'],
		['Leave, holiday, memo', 'Approved leave and holiday/memo days cover the schedule and win over "absent". A half-day leave excuses late and undertime up to half the shift. A memo credits the day (or set hours) and can waive late and undertime.'],
		['What it means for pay', 'A monthly-paid person is deducted for absent days and for late and undertime minutes. A day with worked 0 on a rostered day is an absence. Everything flagged can be fixed by adding the missing punch under Biometric data; the DTR then recalculates.']
	];
	type Doc = { id: string; title: string; intro: string; items: Array<[string, string]>; limits?: string[] };
	// Plain text only (no markup). Each entry answers a question someone is likely to ask.
	const DOCS: Doc[] = [
		{
			id: 'dashboard',
			title: 'Dashboard',
			intro: `The company-wide overview for Main HR. It only reads: every row is a link to the page where the thing is done.`,
			items: [
				[`Needs attention`, `Ordered overdue, then due soon, then to do. It draws from approvals waiting, remittances due in 7 days or overdue, the December 24 13th-month deadline, loans behind schedule, loans owed by people who left, separations in process, and setup gaps (no working-day factor, no remittance due days, statutory rates not confirmed for the open run). A source with nothing to report adds no row.`],
				[`Cutoff status`, `The newest payroll run that is not fully released: how many establishments have their DTR received, payroll generated, locked and released.`],
				[`Coming up`, `The next 30 days: the open run's pay date, remittance due dates, the 13th-month deadline and approved holidays.`],
				[`Establishments`, `Per establishment: staff today, on leave today, rosters waiting for approval, this month's DTR status and the payroll batch in the open run. The name opens that establishment's own dashboard.`],
				[`Who sees it`, `Anyone who can run payroll. The approvals row also needs permission to decide approvals.`]
			]
		},
		{
			id: 'payroll',
			title: 'Payroll',
			intro: `What a payroll run does with the DTR, in the order it happens. Every amount is whole centavos and each component is rounded as it is computed, so a payslip always adds up.`,
			items: [
				[`Run, cutoff and pay date`, `A run is one cutoff (from, to) with a pay date and a frequency: twice a month or monthly. Two runs cannot cover the same dates. Creating a run needs the working-day factor to be set first (Settings → Payroll).`],
				[`Batches: one per establishment`, `A run has one batch for each active establishment. A batch is built only from that establishment's received DTR, for every month the cutoff touches. If a DTR has not been received the batch says so and cannot be generated.`],
				[`Who is on a batch`, `A person is paid once, in their home establishment's batch: the one flagged primary, otherwise where they logged the most time. Someone who worked at several establishments has their cost split by time worked at each, and is held until every establishment they worked at has been received. A person with no DTR in the cutoff gets no line and is listed as "no DTR".`],
				[`Daily and hourly rate`, `A monthly rate becomes a daily one as rate × 12 ÷ the working-day factor (261: 5-day week, rest days unpaid; 313: 6-day week, rest day unpaid; 365: every day paid), and hourly as daily ÷ 8. The factor is a company policy, so there is no default. It is frozen on each run when the run is created.`],
				[`Basic pay`, `Monthly basis: half the month in each cutoff on a twice-a-month run (the whole month on a monthly run), less one full daily rate for each rostered day with nothing worked. Daily basis: the regular minutes worked ÷ 480 × the daily rate. Hourly basis: the regular minutes × the hourly rate. A rate that changes inside the cutoff is paid by day at each day's own rate.`],
				[`Late and undertime`, `Monthly basis only: deducted at the hourly rate for the minutes the DTR shows. A day that is absent takes the whole daily rate and nothing extra for late or undertime. Daily and hourly staff simply have fewer paid minutes.`],
				[`Overtime`, `Only overtime covered by an approved application is paid; the rest shows on the DTR as unapproved and is not paid. Pay per overtime hour is the hourly rate × 1.25 on an ordinary day, 1.69 on a rest day or special holiday, 1.95 on a special holiday that is also a rest day, 2.60 on a regular holiday and 3.38 on a regular holiday that is also a rest day.`],
				[`Rest days and holidays`, `Hours actually punched on a rest day or holiday (up to 8) get a premium on top of basic: rest day or special holiday +30%, special holiday on a rest day +50%, regular holiday +100%, regular holiday on a rest day +160%. Paid leave or holiday credit is not premium-paid, only punched hours are. A locally declared holiday is treated as a special holiday. A memo changes nothing here.`],
				[`Night differential`, `The establishment's night-differential percentage is paid on the hours inside its night window, at that day's rate and multiplier. It does not separate regular hours from overtime hours.`],
				[`SSS, PhilHealth and Pag-IBIG`, `Each is worked out on the person's monthly rate, not on what they earned in the cutoff, and split equally over the cutoffs of the month. A person an agency does not cover is charged nothing by it, employee or employer. The employer shares and SSS EC are recorded on the line but are not deducted from the employee.`],
				[`Withholding tax`, `The per-period TRAIN table applied to gross less the three employee contributions. There is no year-end true-up. A figure typed on the line replaces the computed tax and survives regenerating.`],
				[`Pay items, loans and net pay`, `Pay items filed for the cutoff are added to earnings or deductions (see Pay items). Loans are taken after everything else from what the pay can cover, so net pay never goes below zero (see Loans). Net pay = gross − all deductions.`],
				[`13th-month accrual`, `Each line also records one twelfth of the basic actually earned (after late and undertime). It is a running figure for the 13th-month batches and is not paid out on the payslip.`],
				[`Generate, adjust, confirm, lock, release`, `Generate builds the lines from the DTR and pay items, and can be repeated while the batch is a draft. Adjust a line where needed. Before a batch can be locked, confirm the statutory rates for the period. Locking makes the batch final: it counts toward loan balances, the 13th month and remittances. Release makes the payslips visible to the establishment's managers.`],
				[`Can I change a locked batch?`, `Unlock it, as long as it is not released and its month's remittance is not marked as paid (reopen the remittance first). Unlocking can make a loan that was paid off owe again. A released batch cannot be unlocked.`],
				[`Year-end tax (annualization)`, `Payroll → Year-end tax works out each person's income tax for the whole year and compares it with what was withheld cutoff by cutoff. Taxable pay is gross pay less exempt earnings and the employee SSS, PhilHealth and Pag-IBIG shares, plus any 13th month and other benefits above ₱90,000, plus taxable pay from a previous employer for the year. The TRAIN annual table gives the tax due. The difference is applied to the year's last draft batch: extra tax is added to withholding, and a refund is paid back as a tax-exempt earning. Regenerating a batch keeps the last settlement figure, which may then be out of date, so apply again after regenerating or after anything else changes in the year. Settle in the last payroll of December, before locking.`],
				[`Tax-exempt pay items`, `An earning can be marked exempt from income tax when it is filed (de minimis benefits and similar). It is paid in full and counted in gross, but left out of the taxable pay that withholding and year-end tax use.`],
				[`Previous employer and address`, `On a person's record, Tax records holds their home address (printed on the 2316) and, for someone who joined this year, the previous employer's year, taxable pay and tax withheld. Those are added to this year's annualization.`],
				[`BIR 2316 and 1604-C`, `Reports → BIR 2316 data lists each person's compensation, non-taxable pay, taxable pay, tax due and withheld, and prints a data sheet per person. Reports → BIR 1604-C alphalist is the yearly list with a CSV. Both are the company's own layouts, not the official BIR forms, so copy the figures to the current form or the eBIRForms and alphalist data entry package, and check them with your accountant before filing.`],
				[`Rates in force`, `SSS 15% of the Monthly Salary Credit (₱5,000–₱35,000, ₱500 steps): employee 5%, employer 10%, plus employer EC ₱10 or ₱30. PhilHealth 5% of monthly basic (₱10,000 floor, ₱100,000 ceiling), split 50/50. Pag-IBIG 2% employee and 2% employer on up to ₱10,000 (max ₱200 each), 1% employee at ₱1,500 and below. Withholding per the TRAIN table. Premiums per the DOLE handbook.`]
			],
			limits: [
				`Statutory rates are encoded from published tables and are not fetched live. Check them against current SSS, PhilHealth, Pag-IBIG and BIR issuances before locking.`,
				`Withholding is per period; the year-end settlement closes the gap, but only for payslips in this system. A person's pay from other employers counts only if entered under Tax records.`,
				`A minimum-wage exemption has to be set on the person, it is not detected.`,
				`Scheduled hours beyond 8 on a day are paid at the straight rate.`,
				`Contributions follow the rate on the cutoff's last day, even when the rate changed inside it.`
			]
		},
		{
			id: 'pay-items',
			title: 'Pay items',
			intro: `One-off or recurring earnings and deductions filed for a person and picked up when payroll is generated.`,
			items: [
				[`Kinds`, `Earnings: allowance, incentive, other. Deductions: cash advance, other. Each has a label that prints on the payslip.`],
				[`When it applies`, `A single-cutoff item applies to the one cutoff that holds its date. A ranged item applies to every cutoff that overlaps its dates, and one with no end date runs until it is voided.`],
				[`Effect on pay`, `Every earning adds to gross and therefore to taxable pay for withholding. Contributions do not change, because they follow the monthly rate. Allowances, incentives and other earnings are not part of the 13th month, which is basic only.`],
				[`Statuses`, `Waiting (not yet in a payslip), on a draft payslip, on a locked payslip, or voided.`],
				[`Editing one`, `Edit changes the name, type, amount, tax treatment, dates and note. A draft payslip follows at once. The person and whether it is an earning or a deduction stay as filed: void it and add a new one for that.`],
				[`When it is locked`, `Once payroll for a cutoff the item covers is locked or released, the item cannot be edited, because the payslip never changes after the fact. A one-cutoff item then cannot be edited, archived or voided, and a new one cannot be filed for that cutoff. A recurring item that has been paid cannot be edited either; archive it to stop it and file a new one from the next cutoff.`],
				[`Archive and restore`, `Archive is for an item that has run its course. Payroll stops picking it up, it leaves the Active list and shows under Archived, and Restore brings it back. It needs no reason and is not a mistake like a void. Archiving takes it off any draft payslip.`],
				[`Void`, `Void is for an item filed by mistake. It needs a reason and is only possible while its payslip is still a draft, or for a recurring item that is not on a locked payslip.`],
				[`Does regenerating lose them?`, `No. Regenerating rebuilds the line from the pay items that apply, so they are always reapplied. A typed withholding override is kept.`]
			]
		},
		{
			id: 'loans',
			title: 'Loans',
			intro: `SSS, Pag-IBIG and company loans taken out of pay, with the balance tracked from payroll and from money received outside payroll.`,
			items: [
				[`How a loan is deducted`, `Each month the agreed monthly amount is taken, half in each cutoff on a twice-a-month run and all of it on a monthly run, starting from the loan's first month. Only a loan with status Active is deducted.`],
				[`When pay cannot cover it`, `Loans are taken after tax and contributions, government loans first, from what is left, and net pay never goes below zero. Whatever could not be taken is carried into the next cutoff, capped at the remaining balance.`],
				[`Balance`, `Principal − already paid before this system − deducted by locked or released payslips − payments received outside payroll. Draft payslips do not count until locked.`],
				[`Already paid`, `Amount paid before the system took over, entered when the loan is recorded. It counts against the principal like a deduction but is not on any payslip.`],
				[`Payments received directly`, `Cash or transfers the employee paid straight to the lender or the company. They reduce the balance, never appear on an agency schedule, and can be voided.`],
				[`Skipping a month`, `A skipped month is not due and pushes the end date out. A month that a locked payslip already covers cannot be skipped.`],
				[`Behind schedule`, `Months due before this month × the monthly amount (capped at what is owed), less what was paid since the system started. A month still in progress is not behind, and skipped months are not due. Only an active loan can be behind.`],
				[`Ending soon`, `Active loans expected to finish within the next three months if the monthly amount keeps being taken.`],
				[`Closing`, `A loan closes itself when a locked batch takes the balance to zero ("Fully deducted through payroll"). Unlocking that batch reopens it. A person can also pause it, cancel it, or close it early with a reason. A closed loan cannot be edited.`],
				[`Editing`, `The reference, monthly amount and notes can be corrected. The principal and the start month can only be changed until a locked payslip has deducted the loan.`],
				[`Employee who left`, `A separated employee with a balance is flagged in the list. Settle it from their final pay on the Separations page, or record a payment received.`],
				[`Printing`, `Print statement (inside a loan) lists what was owed, every amount taken or received and the balance after each. Print (on the list) prints every loan matching the current search and filters.`]
			]
		},
		{
			id: 'bonuses',
			title: 'Bonuses',
			intro: `13th month and other bonuses are batches of their own, outside payroll. They do not appear on a payslip or change a run.`,
			items: [
				[`Kinds`, `13th month mid-year installment, 13th month year-end balance, and Other (an amount you type per person). One batch per establishment and year. A batch starts as a draft and is issued when final.`],
				[`How the 13th month is computed`, `(Basic pay earned − late and undertime) ÷ 12, from locked or released payslips of the year. Draft payslips are not counted, so lock the payroll first and press Refresh. Overtime, premiums, allowances and night differential are not basic.`],
				[`Mid-year and year-end`, `Mid-year counts payslips from January 1 up to the batch cut-off date (June 30 unless changed). The year-end batch counts the whole year and subtracts what was already issued, so the two together never exceed a twelfth of the year's basic.`],
				[`Who gets it`, `Rank-and-file employees with at least 30 days of service in the year. Managerial staff and anyone marked not covered get zero, as does someone with no basic pay yet. A person whose 13th month went out in their final pay is not paid again.`],
				[`Other bonuses`, `Not computed. Type the amount for each person and issue. They count toward the tax-exemption watch like the 13th month.`],
				[`Tax on bonuses`, `The 13th month and other benefits are tax-exempt up to ₱90,000 a year combined. The system adds up what a person has been issued this year (issued batches, plus 13th month paid with final pay, plus the batch being viewed). When that passes ₱90,000 the line is flagged and shows the taxable portion: the part of that payment above ₱90,000, never more than the payment itself.`],
				[`Is the tax withheld?`, `No. The taxable portion is shown on the batch, the register and the slip, but nothing is withheld or added to payroll. HR or the accountant handles the excess, for example by filing the taxable part as a pay item in a payroll run.`],
				[`Which batch carries the excess`, `The portion is worked out as if this payment came after everything already issued. When an earlier batch is viewed after later ones were issued, its portion can look higher than the strict order of payment would give, but it is never more than that payment.`],
				[`December 24 due date`, `The 13th month must be paid on or before December 24. From 60 days before, the Bonuses page shows a notice listing the establishments whose year-end batch is not issued yet, and it turns red once the date has passed.`],
				[`13th-month report`, `Reports → 13th month pay (also the "13th-month report" button on the Bonuses page) shows the year for the whole company, and prints or exports to CSV: per person the basic earned, 13th month due, what was paid mid-year, year-end and in final pay, and who was not paid and why, with totals. Use it for the DOLE report (generally due January 15). Check the current form and date with DOLE. Only issued batches and final pay count as paid; drafts are shown as not yet issued.`],
				[`Issue and reopen`, `A batch with nothing to pay cannot be issued. A year-end batch cannot be issued while a mid-year draft for the same year is open. An issued mid-year batch cannot be reopened once the year-end balance was computed from it. Only a draft can be deleted.`]
			]
		},
		{
			id: 'remittances',
			title: 'Remittances',
			intro: `The monthly amounts owed to SSS, PhilHealth, Pag-IBIG and BIR, and the loan collections for SSS and Pag-IBIG.`,
			items: [
				[`What a schedule holds`, `One schedule per agency and month, built from locked or released batches whose pay date falls in that month. It lists each person with the employee and employer shares. Draft batches are not counted, and the page says how many are still draft.`],
				[`Six schedules`, `SSS, PhilHealth, Pag-IBIG, BIR (withholding tax), SSS loans and Pag-IBIG loans. Loans are collected separately from contributions, using the contribution employer number.`],
				[`Due dates`, `Each agency's deadline is "day N of the month after the pay month", set in Settings → Employer numbers. A blank day means no due date is shown. None is assumed, and a day past the end of a short month falls on its last day.`],
				[`Year-end tax in the BIR schedule`, `Extra tax from the year-end settlement is part of the person's withholding on the December payslip, so it is in the BIR schedule once that batch is locked. Tax the settlement returned to an employee is paid out of what was withheld, so the BIR schedule takes it off and says how much at the top. A person's row can be negative that month, and the total is what you remit. If refunds are larger than the month's withholding, the total is negative and there is nothing to remit.`],
				[`Marking it remitted`, `Record the date paid and a reference. The amount and number of people are frozen at that moment. Main HR can undo it, which keeps the row so the due date survives.`],
				[`Effect on payroll`, `While a month's agency is marked remitted, the batches in that month cannot be unlocked, so the filed figure cannot drift.`]
			]
		},
		{
			id: 'separations',
			title: 'Separations and final pay',
			intro: `Someone leaving: why, the last day, a clearance checklist and a statement of what they are owed or owe.`,
			items: [
				[`Starting one`, `Pick the person, why they are leaving (resigned, terminated, end of contract, retired) and the last day. The person is marked separated once the last day has passed.`],
				[`Clearance`, `A checklist the company defines in Settings (the defaults are ID and access, uniform and equipment, keys and locker, cash accountability, exit interview). A change only applies to separations started afterwards, and items can be added to a single separation.`],
				[`The statement`, `Four kinds of line: owed to the employee (credits), charged to the employee, cash received from the employee, and written off. Final pay covers the charges first, then whatever HR applies to loans, and what is left goes to the employee.`],
				[`13th month`, `A pro-rated 13th month can be added as a credit, computed from locked payslips up to the last day and net of anything paid mid-year. It is refused when the person is not covered, served under a month, or has no basic pay on locked payslips yet. Anyone paid this way is not paid again in a bonus batch.`],
				[`Loans`, `Part of the final pay can be applied to the person's loans, which records a payment received. It cannot exceed the final pay left.`],
				[`Still owed`, `Charges that the pay cannot cover stay owed until received or written off. Unpaid loans stay owed too. Once nothing is left the separation can be cleared.`],
				[`Printing`, `The statement prints from the separation page.`]
			]
		},
		{
			id: 'leave',
			title: 'Leave, overtime and approvals',
			intro: `How requests are filed and decided, and what leave does to pay.`,
			items: [
				[`Leave types`, `Defined once for the company in Settings. The statutory ones start with the legal defaults: Service Incentive Leave 5 days, Maternity 105, Paternity 7, Solo Parent 7, VAWC 10, Special Leave for Women 60. The company's own (vacation, sick, emergency, bereavement, birthday) start switched off. The statutory defaults follow the law as commonly summarised, so verify them with DOLE or counsel.`],
				[`Who can take it`, `A leave can require minimum months of service, certain employment types, or one sex, can allow half days, carry days over, be cash-convertible, or need a supporting document.`],
				[`Days counted`, `A leave counts either working days (only the dates the person is rostered) or calendar days. A half day is 0.5 and needs a single date. Two requests for one person cannot overlap, except opposite half days on the same date.`],
				[`Filing and approval`, `A manager files, and Main HR approves or rejects under Approvals. When Main HR files, it is filed and approved in one step. A manager can withdraw a request still waiting; cancelling an approved one is Main HR's decision.`],
				[`Effect on the DTR and pay`, `Approved leave covers the scheduled day and wins over absent. A paid leave credits the paid day; an unpaid leave covers the day without crediting it. A half day covers late and undertime up to half the shift.`],
				[`Overtime applications`, `Overtime is filed for a date and a time range (at most 12 hours) and approved the same way. Only the part of punched overtime inside an approved range is paid.`],
				[`Memos and holidays`, `Holidays and memos are set only by Main HR (Holidays & memos in the sidebar), for the whole company or for chosen establishments. They show on the roster and DTR automatically. A holiday or memo credits the day, or a set number of hours, and can waive late and undertime.`],
				[`Approvals page`, `One queue for submitted rosters, leave, overtime and DTR submissions, with a count in the sidebar.`]
			]
		},
		{
			id: 'contracts',
			title: 'Contracts',
			intro: `Employment contracts generated in HR from your templates, kept with their dates and the signed copy. Main HR only.`,
			items: [
				[`Templates`, `Settings → Contract templates holds the wording for each employment type (probationary, regular, fixed-term, project, seasonal, casual, part-time). It uses fields such as the employee's name, position, pay and dates. The default wording is a starting point: have your lawyer review it. A change applies to contracts issued from then on.`],
				[`Generating a contract`, `Contracts → New contract: pick the employee and the type, the start date and, where it applies, the end date. The position and pay come from the employee's record and the wording is filled in and frozen. A fixed-term, project, seasonal or casual contract must have an end date; probation needs an end date and cannot be longer than six months.`],
				[`What is kept`, `The wording, position, pay and dates as issued. A later raise, promotion or template edit does not rewrite an issued contract.`],
				[`Printing and signing`, `Print the contract, have it signed, then upload the scan or photo (PDF, JPEG, PNG or WebP, up to 8 MB). The contract becomes Signed and the file is only available to Main HR.`],
				[`Checking a printed copy`, `Every printed contract carries a QR code, the address it leads to and a document fingerprint. Scanning it opens a public page that says whether the contract is genuine, who issued it, to whom (the first name and last initial only), the position, type and term, and whether it is signed or void. It never shows pay or address. Compare the fingerprint on the page with the one printed on your copy. A voided contract is clearly marked VOID.`],
				[`Changing a term`, `A contract is not edited. Void it with a reason and issue a new one. The newer contract replaces the older one in the due list.`],
				[`Probation and ending contracts`, `Contracts and probations ending within 30 days show on the Dashboard and under Contracts and probation due in Reports, and an ended one that has no replacement is flagged. An employee kept on probation past six months becomes regular by law, so decide before the date.`]
			]
		},
		{
			id: 'reports',
			title: 'Reports',
			intro: `Reports built from payslips and the other records, each with a filter, Print and CSV.`,
			items: [
				[`Employee data completeness`, `Current staff missing a TIN, an agency number they are covered by, an address, or a bank account where pay is not cash. Fix these before the 2316, the alphalist and the remittances.`],
				[`Contributions year to date`, `Per person for a year: SSS, PhilHealth and Pag-IBIG employee and employer shares, with the employer EC, from locked and released payslips.`],
				[`Payroll variance`, `Gross pay for a month against the month before, per person. A change of more than 15%, a person paid in only one of the two months, or someone new is flagged. Tick "Include draft payslips" to review a batch before locking.`],
				[`Loans outstanding`, `Active and paused loans with balance, behind schedule, end month, and who left owing.`],
				[`BIR 1601-C monthly data`, `Per month: people, compensation, non-taxable, taxable, tax withheld, tax returned at year-end and what to remit, with the due date and whether it is remitted. These are the figures for the return, not the form.`],
				[`Year-end tax, BIR 2316 and 1604-C`, `The year-end settlement, the per-employee 2316 data with printable sheets, and the alphalist. See Payroll.`],
				[`13th month pay`, `Per person for a year: 13th month due, paid mid-year, year-end and in final pay, and who was not paid and why. For the DOLE report.`]
			]
		},
		{
			id: 'settings',
			title: 'Settings',
			intro: `Company-wide policy lives in Settings, so everyone follows the same rules.`,
			items: [
				[`Payroll`, `The working-day factor (261, 313 or 365). It applies to runs created after you change it.`],
				[`Establishment types`, `The kinds of establishment you run. Only a type marked as linking to the hotel app carries a hotel reference, and that cannot change later.`],
				[`Leave types`, `The leave rules for the whole company. A change applies to new requests only; approved leave keeps what it was filed with.`],
				[`Loan types`, `The kinds of loan you can record, each with where its deductions are remitted (SSS, Pag-IBIG, or not remitted).`],
				[`Employer numbers`, `Your SSS, PhilHealth and Pag-IBIG employer numbers and the due day for each remittance.`],
				[`Clearance items`, `The default checklist for new separations.`],
				[`Cost centers`, `What a person's pay is charged to, one per employee, used for cost reports. A cost center in use is deactivated rather than deleted.`],
				[`Company logo`, `Shown in the sidebar, the sign-in page and printed documents.`]
			]
		}
	];
	const LIMITS = [
		'Overtime approved before the shift (e.g. 7:00–8:00 AM) is not credited: overtime only counts after the scheduled end.',
		'A memo that waives lateness waives late and undertime together; there is no setting for "early dismissal only" or an excused-from time yet.',
		'On a straight shift (no break window) the break is assumed to sit in the middle of the shift.',
		'A lone punch is always treated as an incomplete day. Whether it was an in or an out is shown in the remarks, but it is not paid until HR adds the other punch.'
	];
</script>

<svelte:head><title>Guide · HR</title></svelte:head>

<div class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
	<aside class="lg:sticky lg:top-4 lg:self-start">
		<p class="text-xs font-medium tracking-wide text-ink-muted uppercase">On this page</p>
		<nav class="mt-2" aria-label="Guide sections">
			<details class="group" name="guide-group" open>
				<summary
					class="flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium hover:bg-ink/10 [&::-webkit-details-marker]:hidden"
				>
					<ChevronIcon class="size-4 transition-transform group-open:rotate-90" />
					DTR
				</summary>
				<div class="mt-0.5 ml-4 flex flex-col gap-0.5 border-l border-ink/20 pl-2">
					<a href="#rules" class="rounded-lg px-2 py-1 text-sm hover:bg-ink/10">How a day is worked out</a>
					{#each groups as g (g.key)}
						<a href="#g-{g.key}" class="rounded-lg px-2 py-1 text-sm hover:bg-ink/10">
							{g.title}
							<span class="text-xs text-ink-muted tabular-nums">{g.items.length}</span>
						</a>
					{/each}
					<a href="#limits" class="rounded-lg px-2 py-1 text-sm hover:bg-ink/10">Known limits</a>
				</div>
			</details>
			{#each DOCS as d (d.id)}
				<details class="group mt-1" name="guide-group">
					<summary
						class="flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium hover:bg-ink/10 [&::-webkit-details-marker]:hidden"
					>
						<ChevronIcon class="size-4 shrink-0 transition-transform group-open:rotate-90" />
						{d.title}
					</summary>
					<div class="mt-0.5 ml-4 flex flex-col gap-0.5 border-l border-ink/20 pl-2">
						<a href="#doc-{d.id}" class="rounded-lg px-2 py-1 text-sm text-ink-muted hover:bg-ink/10">Overview</a>
						{#each d.items as [term], i (term)}
							<a href="#doc-{d.id}-{i}" class="rounded-lg px-2 py-1 text-sm hover:bg-ink/10">{term}</a>
						{/each}
					</div>
				</details>
			{/each}
		</nav>
	</aside>

	<!-- The guide is long, so it scrolls inside its own panel and the index stays in view. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div class="panel max-h-[calc(100vh-9rem)] min-w-0 space-y-8 overflow-y-auto p-5 md:p-6" tabindex="0" aria-label="DTR and payroll guide">
		<header>
			<h1 class="text-3xl font-light tracking-tight">Guide</h1>
			<p class="mt-1 max-w-2xl text-sm text-ink-muted">
				Every punch situation the DTR handles, with the minutes it produces. These figures are produced by the same
				code that builds the DTR, and a test checks each row, so this page matches how it really works.
			</p>
		</header>

		<section id="rules" class="space-y-3">
			<h2 class="text-xl font-light">How a day is worked out</h2>
			<dl class="space-y-3">
				{#each RULES as [term, text] (term)}
					<div>
						<dt class="text-sm font-medium">{term}</dt>
						<dd class="text-sm text-ink-muted">{text}</dd>
					</div>
				{/each}
			</dl>
		</section>

		{#each groups as g (g.key)}
			<section id="g-{g.key}" class="space-y-3">
				<div>
					<h2 class="text-xl font-light">{g.title}</h2>
					<p class="text-sm text-ink-muted">{g.blurb}</p>
				</div>
				<ol class="divide-y divide-dotted divide-ink/25 rounded-2xl bg-white/60">
					{#each g.items as { sc, r } (sc.id)}
						<li class="space-y-2 px-4 py-3">
							<div class="flex flex-wrap items-start gap-x-3 gap-y-1">
								<span class="rounded-md bg-ink px-1.5 py-0.5 font-mono text-xs text-white">{sc.id}</span>
								<h3 class="min-w-0 flex-1 text-sm font-medium">{sc.title}</h3>
								<span class="text-xs text-ink-muted">{SCHEDULES[sc.schedule].short}</span>
							</div>

							<p class="flex flex-wrap items-center gap-1.5 text-xs">
								<span class="text-ink-muted">Punches</span>
								{#each sc.punches as t, i (i)}
									<span class="rounded bg-ink/10 px-1.5 py-0.5 tabular-nums">{clock(t)}</span>
								{:else}
									<span class="text-ink-muted">none</span>
								{/each}
								{#if sc.approvedOt?.length}
									<span class="text-ink-muted">· OT approved</span>
									{#each sc.approvedOt as o (o)}
										<span class="rounded bg-gold-soft px-1.5 py-0.5 tabular-nums">{o.split('-').map(clock).join(' – ')}</span>
									{/each}
								{/if}
								{#if sc.leave}
									<Badge variant="muted">
										{sc.leave.paid ? 'Paid' : 'Unpaid'} leave{sc.leave.halfDay ? ` · half day ${sc.leave.halfDay.toUpperCase()}` : ' · whole day'}
									</Badge>
								{/if}
								{#if sc.memo}
									<Badge variant="muted">
										Holiday / memo · {sc.memo.creditHours === null ? 'full day credit' : `${sc.memo.creditHours}h credit`}{sc.memo.waiveLateness ? ' · waives late/undertime' : ''}
									</Badge>
								{/if}
							</p>

							<p class="flex flex-wrap items-center gap-1.5 text-xs tabular-nums">
								<span class="rounded-full bg-ink px-2 py-0.5 font-medium text-white">Worked {hm(r.worked)}</span>
								{#if r.late > 0}<span class="rounded-full bg-gold px-2 py-0.5 font-medium text-ink">Late {hm(r.late)}</span>{/if}
								{#if r.under > 0}<span class="rounded-full bg-gold px-2 py-0.5 font-medium text-ink">Undertime {hm(r.under)}</span>{/if}
								{#if r.ot > 0}<span class="rounded-full bg-ok/20 px-2 py-0.5 font-medium">Overtime {hm(r.ot)}</span>{/if}
								{#if r.unapprovedOt > 0}<span class="rounded-full bg-danger/15 px-2 py-0.5 font-medium text-danger">Unapproved OT {hm(r.unapprovedOt)}</span>{/if}
								{#if r.night > 0}<span class="rounded-full bg-ink/10 px-2 py-0.5">Night diff {hm(r.night)}</span>{/if}
								{#if r.leaveCredit > 0}<span class="rounded-full bg-ink/10 px-2 py-0.5">Leave credit {hm(r.leaveCredit)}</span>{/if}
								{#if r.absent}<span class="rounded-full bg-danger/15 px-2 py-0.5 font-medium text-danger">Absent</span>{/if}
								<span class="text-ink-muted">· {PAY[r.pay]}</span>
							</p>

							{#if r.remarks}
								<p class="text-xs text-ink-muted">Remarks on the DTR: <span class="text-ink">{r.remarks}</span></p>
							{/if}
							<p class="text-sm text-ink-muted">{sc.note}</p>
						</li>
					{/each}
				</ol>
			</section>
		{/each}

		<section id="limits" class="space-y-2">
			<h2 class="text-xl font-light">Known limits</h2>
			<ul class="list-disc space-y-1 pl-5 text-sm text-ink-muted">
				{#each LIMITS as l (l)}<li>{l}</li>{/each}
			</ul>
		</section>

		{#each DOCS as d (d.id)}
			<section id="doc-{d.id}" class="space-y-3 border-t border-dotted border-ink/25 pt-8">
				<div>
					<h2 class="text-xl font-light">{d.title}</h2>
					<p class="max-w-2xl text-sm text-ink-muted">{d.intro}</p>
				</div>
				<dl class="space-y-3">
					{#each d.items as [term, text], i (term)}
						<div id="doc-{d.id}-{i}" class="scroll-mt-4">
							<dt class="text-sm font-medium">{term}</dt>
							<dd class="text-sm text-ink-muted">{text}</dd>
						</div>
					{/each}
				</dl>
				{#if d.limits?.length}
					<div>
						<h3 class="text-sm font-medium">Known limits</h3>
						<ul class="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-muted">
							{#each d.limits as l (l)}<li>{l}</li>{/each}
						</ul>
					</div>
				{/if}
			</section>
		{/each}
	</div>
</div>
