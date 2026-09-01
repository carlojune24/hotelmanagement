/**
 * @mm/hr-core — canonical org + employee master + schedule + payroll-run models,
 * Philippine statutory tables (SSS / PhilHealth / Pag-IBIG / BIR), and payroll
 * computation.
 *
 * Phase 0: package skeleton + shared enums. Filled in by Phase 4. See
 * docs/standards/hr.md.
 */
import { z } from 'zod';

export const HR_CORE_VERSION = '0.1.0' as const;

export const employmentType = z.enum([
	'regular',
	'probationary',
	'project',
	'seasonal',
	'fixed_term',
	'casual',
	'part_time'
]);
export type EmploymentType = z.infer<typeof employmentType>;

export const payBasis = z.enum(['monthly', 'daily', 'hourly']);
export type PayBasis = z.infer<typeof payBasis>;

export const employeeStatus = z.enum(['active', 'on_leave', 'suspended', 'separated']);
export type EmployeeStatus = z.infer<typeof employeeStatus>;
