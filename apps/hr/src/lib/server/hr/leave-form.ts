import { leaveTypeSchema } from './leave';

/** A leave type from the Settings form's fields. */
export function leaveTypeFromForm(fd: FormData) {
	const sex = fd.get('sexRestriction');
	return leaveTypeSchema.safeParse({
		code: fd.get('code'),
		name: fd.get('name'),
		description: fd.get('description') ?? '',
		paid: fd.get('paid') === 'on',
		daysPerYear: fd.get('daysPerYear'),
		dayCount: fd.get('dayCount'),
		minServiceMonths: fd.get('minServiceMonths') || 0,
		employmentTypes: fd.getAll('employmentTypes'),
		sexRestriction: sex === 'male' || sex === 'female' ? sex : null,
		halfDayAllowed: fd.get('halfDayAllowed') === 'on',
		carryOverDays: fd.get('carryOverDays') || 0,
		cashConvertible: fd.get('cashConvertible') === 'on',
		requiresDocument: fd.get('requiresDocument') === 'on',
		active: fd.get('active') === 'on'
	});
}
